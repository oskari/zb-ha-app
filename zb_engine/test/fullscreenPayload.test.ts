/**
 * fullscreenPayload.test.ts — Schema tests for the fullscreen companion payload.
 *
 * The companion is a regular payload with one extra constraint:
 *   misc.gridSize MUST be "3x2".
 *
 * The pixel size itself is bounded by the existing miscSchema (≤ 4096 px on
 * each axis) — the server intentionally has no display-mode awareness.
 */

import { describe, it, expect } from "vitest";
import { fullscreenPayloadSchema } from "../src/schema/payloadSchema";

const validFullscreen = {
  misc: { size: { width: 800, height: 480 }, gridSize: "3x2" },
  features: {},
  sources: [],
  elements: [],
};

describe("fullscreenPayloadSchema", () => {
  it("accepts a valid fullscreen payload (gridSize === '3x2')", () => {
    const result = fullscreenPayloadSchema.safeParse(validFullscreen);
    expect(result.success).toBe(true);
  });

  it("rejects a payload whose misc.gridSize is missing", () => {
    const { misc, ...rest } = validFullscreen;
    const noGrid = { ...rest, misc: { size: misc.size } };
    const result = fullscreenPayloadSchema.safeParse(noGrid);
    expect(result.success).toBe(false);
  });

  it("rejects a payload with a non-3x2 grid size", () => {
    for (const gridSize of ["1x1", "2x2", "3x1", "4x2", "fullscreen", ""]) {
      const result = fullscreenPayloadSchema.safeParse({
        ...validFullscreen,
        misc: { ...validFullscreen.misc, gridSize },
      });
      expect(result.success, `gridSize=${gridSize} should be rejected`).toBe(false);
    }
  });

  it("inherits the canvas-dimension cap from miscSchema (rejects > 4096px)", () => {
    const result = fullscreenPayloadSchema.safeParse({
      ...validFullscreen,
      misc: { size: { width: 5000, height: 480 }, gridSize: "3x2" },
    });
    expect(result.success).toBe(false);
  });

  it("does not require any specific pixel size as long as gridSize is '3x2'", () => {
    // Different display modes produce different pixel sizes for the same
    // 3x2 grid; the schema MUST accept any valid in-range size.
    const sizes = [
      { width: 240, height: 240 },
      { width: 480, height: 320 },
      { width: 800, height: 480 },
      { width: 1024, height: 600 },
    ];
    for (const size of sizes) {
      const result = fullscreenPayloadSchema.safeParse({
        ...validFullscreen,
        misc: { size, gridSize: "3x2" },
      });
      expect(result.success, `size ${size.width}x${size.height} should be accepted`).toBe(true);
    }
  });
});
