/**
 * geometryClamp.test.ts — unit + integration tests for the out-of-engine
 * geometry clamp. Runtime-resolved sizes / strokeWidth / pos / line points must
 * be bounded to canvas scale (MAX_RASTER_AXIS = 4096) before the frozen draw
 * loops consume them, while in-bounds elements (literals AND bindings) keep
 * their object identity and bindings are never replaced with resolved literals.
 */

import { describe, it, expect } from "vitest";
import { createDataContext, type DataContext } from "@zb/expressions";
import { clampElementGeometry } from "../src/data/geometryClamp";
import { expandPipeline } from "../src/core/renderService";

function ctxWith(features: Record<string, unknown>): DataContext {
  const ctx = createDataContext();
  ctx.features = features;
  return ctx;
}

describe("clampElementGeometry", () => {
  const ctx = ctxWith({});

  it("clamps a size binding that resolves above the raster axis", () => {
    const [el] = clampElementGeometry(
      [{ type: "rect", sizeX: { $: "features.big" }, sizeY: 10 }],
      ctxWith({ big: 1e9 }),
    );
    expect(el.sizeX).toBe(4096);
    expect(el.sizeY).toBe(10);
  });

  it("maps a size resolving to Infinity down to 0", () => {
    const [el] = clampElementGeometry(
      [{ type: "rect", sizeX: { $: "features.inf" } }],
      ctxWith({ inf: Infinity }),
    );
    expect(el.sizeX).toBe(0);
  });

  it("clamps pos coordinates (Infinity -> 0, 1e9 -> 4096)", () => {
    const [a] = clampElementGeometry([{ type: "rect", pos: { x: Infinity, y: 0 } }], ctx);
    expect(a.pos).toEqual({ x: 0, y: 0 });
    const [b] = clampElementGeometry([{ type: "rect", pos: { x: 1e9, y: 0 } }], ctx);
    expect(b.pos).toEqual({ x: 4096, y: 0 });
  });

  it("clamps line point coordinates to +/- the raster axis", () => {
    const [el] = clampElementGeometry(
      [{ type: "line", points: [[1e9, 0], [Infinity, -1e9]] }],
      ctx,
    );
    expect(el.points).toEqual([[4096, 0], [0, -4096]]);
  });

  it("clamps strokeWidth above the raster axis", () => {
    const [el] = clampElementGeometry([{ type: "rect", strokeWidth: 1e9 }], ctx);
    expect(el.strokeWidth).toBe(4096);
  });

  it("recurses into group children", () => {
    const [group] = clampElementGeometry(
      [{ type: "group", children: [{ type: "rect", sizeX: 1e9 }] }],
      ctx,
    );
    const children = group.children as Record<string, unknown>[];
    expect(children[0].sizeX).toBe(4096);
  });

  it("returns the same element reference when nothing is out of bounds", () => {
    const rect = { type: "rect", sizeX: 100, sizeY: 50, pos: { x: 10, y: 10 } };
    const out = clampElementGeometry([rect], ctx);
    expect(out[0]).toBe(rect);
  });

  it("leaves an in-bounds binding untouched (no literal write-back, same reference)", () => {
    const rect = { type: "rect", sizeX: { $: "features.w" } };
    const out = clampElementGeometry([rect], ctxWith({ w: 800 }));
    expect(out[0]).toBe(rect);
    expect(out[0].sizeX).toEqual({ $: "features.w" });
  });

  it("clamps binding-resolved size end-to-end via expandPipeline", async () => {
    const payload = {
      misc: { size: { width: 100, height: 100 }, format: "png", gridSize: "1x1" },
      features: { w: 1e9, h: 1e9 },
      sources: [],
      elements: [{ type: "rect", sizeX: { $: "features.w" }, sizeY: { $: "features.h" } }],
    };
    const result = await expandPipeline(payload, null, null);
    expect(result.elements[0].sizeX).toBe(4096);
    expect(result.elements[0].sizeY).toBe(4096);
  });

  it("bounds a line whose points reach opposite extremes (via expandPipeline)", async () => {
    const payload = {
      misc: { size: { width: 100, height: 100 }, format: "png", gridSize: "1x1" },
      features: {},
      sources: [],
      // Within the schema cap (+/-100000) but beyond canvas scale (+/-4096);
      // the pre-render clamp bounds the frozen line's coordinate-span loop.
      elements: [{ type: "line", points: [[-50000, -50000], [50000, 50000]] }],
    };
    const result = await expandPipeline(payload, null, null);
    const pts = result.elements[0].points as number[][];
    for (const [x, y] of pts) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(4096);
      expect(Math.abs(y)).toBeLessThanOrEqual(4096);
    }
  });
});
