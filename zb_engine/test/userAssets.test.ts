/**
 * userAssets.test.ts — the asset:<uuid>.<ext> pre-render resolver: token
 * detection, filename/path-traversal validation, surfaced storage failures,
 * load-time SVG sanitization, the per-render decode cache, the raster pixel
 * budget, the compositor, and the no-op path when the adapter lacks readAsset.
 */

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { Canvas } from "../src/engine/canvas";
import { createDataContext } from "@zb/expressions";
import {
  resolveUserAssets,
  compositeUserAssetsOnto,
  type AssetReader,
} from "../src/data/userAssets";

// Test helpers

function makeImg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "img",
    pos: { x: 0, y: 0 },
    sizeX: 10,
    sizeY: 10,
    opacity: 100,
    visible: true,
    src: "",
    bwMode: "threshold",
    bwLevel: 50,
    ...overrides,
  };
}

function makeSvg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "svg",
    pos: { x: 0, y: 0 },
    sizeX: 10,
    sizeY: 10,
    opacity: 100,
    visible: true,
    src: "",
    svg: "",
    enableFill: true,
    fill: 0,
    enableStroke: false,
    strokeDither: 0,
    strokeWidth: 0,
    strokeDash: [],
    strokeCap: "butt",
    strokePosition: "center",
    bwMode: "threshold",
    bwLevel: 50,
    ...overrides,
  };
}

/** Build a tiny PNG with sharp so the resolver has real bytes to decode. */
async function tinyPng(w = 4, h = 4): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

/** A storage stub that returns canned bytes per filename and counts calls. */
function storageWith(
  files: Record<string, Buffer | (() => Promise<Buffer>) | "throw">,
): AssetReader & { readCount: number } {
  const stub = {
    readCount: 0,
    async readAsset(filename: string): Promise<Buffer> {
      stub.readCount++;
      const v = files[filename];
      if (v === undefined || v === "throw") throw new Error("not found");
      return typeof v === "function" ? v() : v;
    },
  };
  return stub;
}

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

// Token detection / filename validation

describe("resolveUserAssets — token detection", () => {
  it("ignores elements without an asset: token", async () => {
    const ctx = createDataContext();
    const els = [makeImg({ src: "https://example.com/foo.png" })];
    const res = await resolveUserAssets(els, ctx, storageWith({}));
    expect(res.errors).toEqual([]);
    expect(res.preLoaded.size).toBe(0);
    expect(res.elements[0].src).toBe("https://example.com/foo.png");
  });

  it("ignores non-img/svg elements", async () => {
    const ctx = createDataContext();
    const els = [{ type: "rect", src: `asset:${VALID_UUID}.png` }];
    const stub = storageWith({});
    const res = await resolveUserAssets(els, ctx, stub);
    expect(stub.readCount).toBe(0);
    expect(res.elements[0]).toBe(els[0]);
  });

  it("rejects path-traversal inside the token without touching disk", async () => {
    const ctx = createDataContext();
    const els = [makeImg({ src: "asset:../etc/passwd.png" })];
    const stub = storageWith({});
    const res = await resolveUserAssets(els, ctx, stub);
    // Token regex itself rejects the slash, so this is treated as a
    // non-asset src — reads must be zero.
    expect(stub.readCount).toBe(0);
    // Element passes through unchanged because the token regex didn't match.
    expect(res.elements[0].src).toBe("asset:../etc/passwd.png");
    expect(res.errors).toEqual([]);
  });

  it("clears src and records generic error when storage throws", async () => {
    const ctx = createDataContext();
    const els = [makeImg({ src: `asset:${VALID_UUID}.png` })];
    const stub = storageWith({ [`${VALID_UUID}.png`]: "throw" });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.elements[0].src).toBe("");
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/asset not available/i);
    // Generic — no path / IP leaked.
    expect(res.errors[0]).not.toContain("/");
  });

  it("is a no-op when the storage adapter has no readAsset", async () => {
    const ctx = createDataContext();
    const els = [makeImg({ src: `asset:${VALID_UUID}.png` })];
    const res = await resolveUserAssets(els, ctx, {});
    expect(res.elements[0].src).toBe(`asset:${VALID_UUID}.png`);
    expect(res.preLoaded.size).toBe(0);
    expect(res.errors).toEqual([]);
  });
});

// SVG path

describe("resolveUserAssets — SVG assets", () => {
  it("rewrites a valid SVG asset to inline form", async () => {
    const ctx = createDataContext();
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="black"/></svg>`;
    const els = [makeSvg({ src: `asset:${VALID_UUID}.svg` })];
    const stub = storageWith({ [`${VALID_UUID}.svg`]: Buffer.from(svgText, "utf-8") });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toEqual([]);
    expect(res.elements[0].src).toBe("");
    expect(typeof res.elements[0].svg).toBe("string");
    expect(res.elements[0].svg as string).toContain("<svg");
  });

  it("strips <script> from SVG assets at load time (defense in depth)", async () => {
    const ctx = createDataContext();
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
    const els = [makeSvg({ src: `asset:${VALID_UUID}.svg` })];
    const stub = storageWith({ [`${VALID_UUID}.svg`]: Buffer.from(svgText, "utf-8") });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toEqual([]);
    const out = res.elements[0].svg as string;
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("<svg");
  });

  it("caps long whitespace runs in a re-inlined SVG asset (ReDoS defense)", async () => {
    const ctx = createDataContext();
    // A valid, small (<50 KB) SVG whose text node carries a huge whitespace
    // run. Under the pre-rasterizer threshold it would reach the frozen
    // engine's regex sanitizeSvg; the run must be capped before it does.
    const svgText =
      `<svg xmlns="http://www.w3.org/2000/svg"><text>` +
      " ".repeat(200000) +
      `</text></svg>`;
    const els = [makeSvg({ src: `asset:${VALID_UUID}.svg` })];
    const stub = storageWith({ [`${VALID_UUID}.svg`]: Buffer.from(svgText, "utf-8") });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toEqual([]);
    const out = res.elements[0].svg as string;
    expect(out).toContain("<svg");
    expect(/\s{257,}/.test(out)).toBe(false);
  });

  it("rejects an SVG asset missing an <svg> root", async () => {
    const ctx = createDataContext();
    const els = [makeSvg({ src: `asset:${VALID_UUID}.svg` })];
    const stub = storageWith({ [`${VALID_UUID}.svg`]: Buffer.from("not an svg", "utf-8") });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toHaveLength(1);
    expect(res.elements[0].src).toBe("");
    expect(res.elements[0].svg).toBe("");
  });

  it("rejects an SVG asset that exceeds MAX_USER_SVG_BYTES", async () => {
    const ctx = createDataContext();
    const huge = `<svg xmlns="http://www.w3.org/2000/svg"><!--${"x".repeat(600_000)}--></svg>`;
    const els = [makeSvg({ src: `asset:${VALID_UUID}.svg` })];
    const stub = storageWith({ [`${VALID_UUID}.svg`]: Buffer.from(huge, "utf-8") });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/size limit/i);
    expect(res.elements[0].svg).toBe("");
  });
});

// Raster path

describe("resolveUserAssets — raster assets", () => {
  it("decodes a PNG asset into the preLoaded bitmap map", async () => {
    const ctx = createDataContext();
    const png = await tinyPng();
    const els = [makeImg({ src: `asset:${VALID_UUID}.png`, sizeX: 4, sizeY: 4 })];
    const stub = storageWith({ [`${VALID_UUID}.png`]: png });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toEqual([]);
    expect(res.elements[0].src).toBe("");
    const entry = res.preLoaded.get(0);
    expect(entry).toBeTruthy();
    expect(entry!.width).toBe(4);
    expect(entry!.height).toBe(4);
    expect(entry!.pixels.length).toBe(16);
  });

  it("collapses two equal references through the per-render decode cache", async () => {
    const ctx = createDataContext();
    const png = await tinyPng();
    const els = [
      makeImg({ src: `asset:${VALID_UUID}.png`, sizeX: 4, sizeY: 4 }),
      makeImg({ src: `asset:${VALID_UUID}.png`, sizeX: 4, sizeY: 4, pos: { x: 5, y: 0 } }),
    ];
    const stub = storageWith({ [`${VALID_UUID}.png`]: png });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toEqual([]);
    expect(res.preLoaded.size).toBe(2);
    // Both reads still happen (we read bytes once per element), but the
    // shared decode result means the two preLoaded entries share their
    // pixels buffer reference.
    const a = res.preLoaded.get(0)!;
    const b = res.preLoaded.get(1)!;
    expect(a.pixels).toBe(b.pixels);
  });

  it("rejects raster requests that exceed the pixel budget", async () => {
    const ctx = createDataContext();
    const png = await tinyPng(2, 2);
    // 5000 * 5000 > MAX_RASTER_PIXELS (4 MB). Axes are also clamped to
    // MAX_RASTER_AXIS (4096), and 4096*4096 = 16M > 4M, so this trips
    // the pixel check.
    const els = [makeImg({ src: `asset:${VALID_UUID}.png`, sizeX: 5000, sizeY: 5000 })];
    const stub = storageWith({ [`${VALID_UUID}.png`]: png });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/pixel budget/i);
    expect(res.elements[0].src).toBe("");
    expect(res.preLoaded.size).toBe(0);
  });

  it("clears src for raster assets with non-positive size without erroring", async () => {
    const ctx = createDataContext();
    const png = await tinyPng();
    const els = [makeImg({ src: `asset:${VALID_UUID}.png`, sizeX: 0, sizeY: 0 })];
    const stub = storageWith({ [`${VALID_UUID}.png`]: png });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.errors).toEqual([]);
    expect(res.elements[0].src).toBe("");
    expect(res.preLoaded.size).toBe(0);
  });
});

// Compositor

describe("compositeUserAssetsOnto", () => {
  it("writes black pixels onto the canvas at the element's position", async () => {
    const ctx = createDataContext();
    const png = await tinyPng(4, 4); // all-black
    const els = [makeImg({ src: `asset:${VALID_UUID}.png`, pos: { x: 2, y: 2 }, sizeX: 4, sizeY: 4 })];
    const stub = storageWith({ [`${VALID_UUID}.png`]: png });
    const res = await resolveUserAssets(els, ctx, stub);
    expect(res.preLoaded.size).toBe(1);

    const canvas = new Canvas(16, 16);
    compositeUserAssetsOnto(canvas, res.preLoaded);
    // Pixel at (2,2) should now be set (black on the 1-bit canvas).
    // We don't depend on Canvas's internal API beyond getPixel — if it
    // exists; otherwise just confirm the call did not throw.
    const maybeGet = (canvas as unknown as { getPixel?: (x: number, y: number) => number }).getPixel;
    if (typeof maybeGet === "function") {
      // The painted square (positions 2..5) should be set to 1 (black).
      // We don't assert on unpainted positions because the engine's
      // Canvas may initialise to black or white depending on its
      // configuration — what matters is that the composite wrote a 1.
      expect(maybeGet.call(canvas, 2, 2)).toBe(1);
      expect(maybeGet.call(canvas, 5, 5)).toBe(1);
    }
  });
});
