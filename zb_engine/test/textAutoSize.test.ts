/**
 * textAutoSize.test.ts — Tests for server-side text bounding box expansion
 *
 * Verifies that expandTextBounds() grows sizeX/sizeY when the resolved
 * text is wider/taller than the stored dimensions, and leaves them
 * unchanged (never shrinks) when the stored box is already large enough.
 */

import { describe, it, expect } from "vitest";
import { expandTextBounds } from "../src/data/textAutoSize";
import type { DataContext } from "@zb/expressions";

function makeCtx(overrides: Record<string, unknown> = {}): DataContext {
  return {
    misc: {},
    features: {},
    ...overrides,
  };
}

describe("expandTextBounds", () => {
  it("returns non-text elements unchanged", async () => {
    const elements = [
      { type: "rect", sizeX: 10, sizeY: 10 },
      { type: "circle", sizeX: 20, sizeY: 20 },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    expect(result).toEqual(elements);
  });

  it("does not shrink a text element with an oversized bounding box", async () => {
    const elements = [
      {
        type: "text",
        text: "Hi",
        sizeX: 500,
        sizeY: 500,
        fontSize: 16,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    expect(result[0].sizeX).toBe(500);
    expect(result[0].sizeY).toBe(500);
  });

  it("expands sizeX when resolved text is wider than stored value", async () => {
    // Use a tiny sizeX that can't fit any reasonable text at 20px
    const elements = [
      {
        type: "text",
        text: "123456789",
        sizeX: 5,
        sizeY: 200,
        fontSize: 20,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    expect(result[0].sizeX).toBeGreaterThan(5);
    // sizeY should stay because 200 is large enough for one line
    expect(result[0].sizeY).toBe(200);
  });

  it("expands sizeY for multi-line text", async () => {
    const elements = [
      {
        type: "text",
        text: "Line 1\nLine 2\nLine 3",
        sizeX: 500,
        sizeY: 5,
        fontSize: 20,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    expect(result[0].sizeY).toBeGreaterThan(5);
    expect(result[0].sizeX).toBe(500);
  });

  it("resolves bindings before measuring", async () => {
    const ctx = makeCtx({
      sensor_temp: { state: "31.32" },
    });
    const elements = [
      {
        type: "text",
        text: { $: "sensor_temp.state" },
        sizeX: 5,
        sizeY: 200,
        fontSize: 34,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, ctx);
    // With the binding resolved to "31.32" at 34px, sizeX=5 must expand
    expect(result[0].sizeX).toBeGreaterThan(5);
  });

  it("uses fallbackText when text binding resolves to empty", async () => {
    const elements = [
      {
        type: "text",
        text: { $: "missing.path" },
        fallbackText: "N/A",
        sizeX: 5,
        sizeY: 200,
        fontSize: 20,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    // "N/A" at 20px should need more than 5px
    expect(result[0].sizeX).toBeGreaterThan(5);
  });

  it("returns element unchanged when text is empty", async () => {
    const elements = [
      {
        type: "text",
        text: "",
        sizeX: 50,
        sizeY: 50,
        fontSize: 20,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    expect(result[0]).toEqual(elements[0]);
  });

  it("preserves other element properties when expanding", async () => {
    const elements = [
      {
        type: "text",
        text: "A long string of text that needs more room",
        sizeX: 5,
        sizeY: 5,
        fontSize: 20,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
        pos: { x: 10, y: 20 },
        textAlign: "center",
        fill: 100,
        visible: true,
      },
    ];
    const result = await expandTextBounds(elements, makeCtx());
    const el = result[0] as Record<string, unknown>;
    expect(el.pos).toEqual({ x: 10, y: 20 });
    expect(el.textAlign).toBe("center");
    expect(el.fill).toBe(100);
    expect(el.visible).toBe(true);
    expect(el.type).toBe("text");
  });

  it("handles template interpolation in text", async () => {
    const ctx = makeCtx({
      weather: { temperature: 31.32 },
    });
    const elements = [
      {
        type: "text",
        text: "Temp: {{weather.temperature}}°C",
        sizeX: 5,
        sizeY: 200,
        fontSize: 20,
        fontWeight: 400,
        fontFamily: "Sora",
        lineHeight: 1.2,
      },
    ];
    const result = await expandTextBounds(elements, ctx);
    // "Temp: 31.32°C" at 20px should need more than 5px
    expect(result[0].sizeX).toBeGreaterThan(5);
  });
});
