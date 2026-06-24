/**
 * svgPreRasterizer.test.ts — Tests for out-of-engine SVG pre-rasterization
 *
 * Verifies that:
 *   1. Eligible large inline SVGs are pre-rasterized and removed from the
 *      element list as far as the engine is concerned (svg field cleared).
 *   2. Small SVGs, SVGs with stroke, rotated/scaled SVGs, and group
 *      children fall through unchanged so the engine handles them.
 *   3. The pre-raster cache returns the same Buffer for repeat lookups.
 *   4. The compositor writes pixels onto the canvas at the resolved
 *      element position with the same dither / threshold output the
 *      frozen engine's `drawSvg` would have produced.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Canvas } from "../src/engine/canvas";
import { createDataContext } from "@zb/expressions";
import {
  preRasterizeLargeSvgs,
  compositePreRasteredOnto,
  _clearPreRasterCacheForTesting,
} from "../src/data/svgPreRasterizer";

const LARGE_THRESHOLD = 50 * 1024;

/** Build an SVG payload longer than the pre-raster threshold. */
function buildLargeSvg(): string {
  // A handful of non-trivial paths, padded with comments to push the byte
  // length over the 50 KB threshold without making the test slow to parse.
  const filler = `<!-- ${"x".repeat(60_000)} -->`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ` +
    `width="100" height="100">` +
    `<rect x="10" y="10" width="80" height="80" fill="black"/>` +
    `${filler}` +
    `</svg>`
  );
}

const SMALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
  '<path d="M0 0h24v24H0z" fill="black"/></svg>';

function defaultSvgEl(overrides: Record<string, unknown> = {}) {
  return {
    type: "svg",
    pos: { x: 0, y: 0 },
    rotationDeg: 0,
    scale: { x: 1, y: 1 },
    origin: { x: 0, y: 0 },
    sizeX: 100,
    sizeY: 100,
    enableFill: true,
    fill: 100,
    enableStroke: false,
    strokeDither: 100,
    strokeWidth: 0,
    strokePosition: "center",
    bwMode: "threshold",
    bwLevel: 50,
    opacity: 100,
    visible: true,
    svg: buildLargeSvg(),
    ...overrides,
  };
}

describe("preRasterizeLargeSvgs", () => {
  beforeEach(() => {
    _clearPreRasterCacheForTesting();
  });

  it("pre-rasterizes a large inline SVG and clears its svg field", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl()];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.elements[0].svg).toBe("");
    expect(result.elements[0].src).toBe("");

    const entry = result.preRastered.get(0)!;
    expect(entry.width).toBe(100);
    expect(entry.height).toBe(100);
    expect(entry.pixels.length).toBe(100 * 100);
  });

  it("leaves small SVGs untouched (engine handles them well)", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl({ svg: SMALL_SVG })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
    expect(result.elements[0]).toBe(els[0]); // unchanged reference
  });

  it("skips SVGs with rotation", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl({ rotationDeg: 45 })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
    expect(result.elements[0].svg.length).toBeGreaterThan(LARGE_THRESHOLD);
  });

  it("skips SVGs with non-unit scale", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl({ scale: { x: 2, y: 1 } })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
    expect(result.elements[0].svg.length).toBeGreaterThan(LARGE_THRESHOLD);
  });

  it("skips SVGs with stroke (engine path retains exact morphology)", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl({ enableStroke: true, strokeWidth: 2 })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
  });

  it("does not recurse into group children (out of scope)", async () => {
    const ctx = createDataContext();
    const els = [
      {
        type: "group",
        pos: { x: 0, y: 0 },
        children: [defaultSvgEl()],
      },
    ];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
  });

  it("ignores non-svg element types", async () => {
    const ctx = createDataContext();
    const els = [
      {
        type: "rect",
        pos: { x: 0, y: 0 },
        sizeX: 10,
        sizeY: 10,
        enableFill: true,
        fill: 100,
      },
    ];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
  });

  it("returns the same cached Buffer for a repeated identical SVG (LRU cache hit)", async () => {
    const ctx = createDataContext();

    const first = await preRasterizeLargeSvgs([defaultSvgEl()], ctx);
    const entry1 = first.preRastered.get(0)!;

    // A second call with byte-identical SVG must hit the LRU cache and hand
    // back the *same* pixel Buffer by reference — a re-rasterization would
    // allocate a fresh Buffer. This pins the cache contract deterministically,
    // replacing the old wall-clock "second call is faster" comparison, which
    // was flaky AND passed even when the cache was bypassed (sharp/JIT warmup
    // alone can make a second identical call faster).
    const second = await preRasterizeLargeSvgs([defaultSvgEl()], ctx);
    const entry2 = second.preRastered.get(0)!;

    expect(second.preRastered.size).toBe(1);
    expect(entry2.pixels).toBe(entry1.pixels); // same reference ⇒ cache hit
    expect(entry2.width).toBe(entry1.width);
    expect(entry2.height).toBe(entry1.height);
  });
});

describe("preRasterizeLargeSvgs — security hardening", () => {
  beforeEach(() => {
    _clearPreRasterCacheForTesting();
  });

  it("strips <image href='file://...'> before passing to sharp", async () => {
    // Embed a file:// reference in an otherwise-valid large SVG. If the
    // sanitizer is not invoked on this code path, librsvg may attempt to
    // load /etc/hostname and bake its bytes into the output bitmap.
    // Sanitization removes the href attribute, leaving an inert <image/>.
    const filler = `<!-- ${"x".repeat(60_000)} -->`;
    const malicious =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="0 0 100 100" width="100" height="100">` +
      `<image x="0" y="0" width="100" height="100" ` +
      `xlink:href="file:///etc/hostname"/>` +
      `<rect x="10" y="10" width="80" height="80" fill="black"/>` +
      filler +
      `</svg>`;

    const ctx = createDataContext();
    const els = [defaultSvgEl({ svg: malicious })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    // Pre-raster must succeed (sanitizer strips href, sharp renders the rect).
    expect(result.preRastered.size).toBe(1);
    expect(result.errors).toEqual([]);
    // The central black rect is still drawn — proving sanitization left
    // the rest of the SVG intact rather than rejecting outright.
    const entry = result.preRastered.get(0)!;
    const centerGray = entry.pixels[50 * entry.width + 50];
    expect(centerGray).toBeLessThan(128);
  });

  it("rejects inline SVGs over MAX_INLINE_SVG_BYTES (1 MiB)", async () => {
    const oversized =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 100 100" width="100" height="100">` +
      `<rect x="10" y="10" width="80" height="80" fill="black"/>` +
      `<!-- ${"x".repeat(2 * 1024 * 1024)} -->` +
      `</svg>`;

    const ctx = createDataContext();
    const els = [defaultSvgEl({ svg: oversized })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    expect(result.preRastered.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/exceeds inline SVG size limit/);
    // Element must be left unchanged so the engine's own size check
    // surfaces the same error through meta.renderErrors.
    expect(result.elements[0].svg).toBe(oversized);
  });

  it("clamps oversized output dimensions to MAX_RASTER_AXIS", async () => {
    // Request a 10000×10000 raster (100 MP). Without clamping this would
    // allocate ~100 MB before any timeout could fire.
    const ctx = createDataContext();
    const els = [defaultSvgEl({ sizeX: 10_000, sizeY: 10_000 })];
    const result = await preRasterizeLargeSvgs(els, ctx);

    // Either skipped (pixel budget exceeded) or clamped to <= MAX_RASTER_AXIS.
    if (result.preRastered.size === 0) {
      expect(result.errors[0]).toMatch(/pixel budget/);
    } else {
      const entry = result.preRastered.get(0)!;
      expect(entry.width).toBeLessThanOrEqual(4096);
      expect(entry.height).toBeLessThanOrEqual(4096);
    }
  });
});

describe("compositePreRasteredOnto", () => {
  beforeEach(() => {
    _clearPreRasterCacheForTesting();
  });

  it("writes black pixels for the dark region of the bitmap", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl()]; // 100×100, central 80×80 black square
    const result = await preRasterizeLargeSvgs(els, ctx);
    const canvas = new Canvas(120, 120);

    compositePreRasteredOnto(canvas, result.preRastered);

    // A pixel inside the central black square must be set.
    expect(canvas.getPixel(50, 50)).toBe(1);
    // A pixel in the corner (outside the inner rect, white background) must be 0.
    expect(canvas.getPixel(2, 2)).toBe(0);
  });

  it("skips elements with visible=false", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl({ visible: false })];
    const result = await preRasterizeLargeSvgs(els, ctx);
    const canvas = new Canvas(120, 120);

    compositePreRasteredOnto(canvas, result.preRastered);

    expect(canvas.getPixel(50, 50)).toBe(0);
  });

  it("respects the element pos offset", async () => {
    const ctx = createDataContext();
    const els = [defaultSvgEl({ pos: { x: 50, y: 50 } })];
    const result = await preRasterizeLargeSvgs(els, ctx);
    const canvas = new Canvas(200, 200);

    compositePreRasteredOnto(canvas, result.preRastered);

    // The 100×100 SVG with central 80×80 black square is now drawn at
    // canvas (50,50)..(150,150). The center of the black square is at
    // SVG (50,50) → canvas (100,100).
    expect(canvas.getPixel(100, 100)).toBe(1);
    // A point well outside the offset SVG bounds must remain white.
    expect(canvas.getPixel(10, 10)).toBe(0);
  });
});
