/**
 * rotatedSvgRasterizer.test.ts — out-of-engine rotated-SVG pre-rasterization.
 * A rotated inline SVG near a canvas edge loses pixels in the frozen engine
 * (it rotates within a canvas-sized temp buffer); this pass rasterizes into a
 * local bbox-sized buffer and composites the rotated result onto the canvas.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  preRasterizeRotatedSvgs,
  compositeRotatedSvgs,
  _clearRotatedSvgCacheForTesting,
} from "../src/data/rotatedSvgRasterizer";
import { Canvas } from "../src/engine/canvas";
import { createDataContext } from "@zb/expressions";

// A minimal but solid SVG — a black-filled rectangle that fully covers
// the viewBox. Sharp rasterizes this to an entirely opaque region so
// every pixel of the un-rotated bbox samples as "ink", which makes the
// rotated output trivial to assert on.
const SOLID_BLACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
  'width="24" height="24" preserveAspectRatio="none">' +
  '<rect x="0" y="0" width="24" height="24" fill="black"/></svg>';

function defaultSvgEl(overrides: Record<string, unknown> = {}) {
  return {
    type: "svg",
    pos: { x: 0, y: 0 },
    rotationDeg: 0,
    scale: { x: 1, y: 1 },
    origin: { x: 0, y: 0 },
    sizeX: 50,
    sizeY: 50,
    enableFill: true,
    fill: 100,
    enableStroke: false,
    strokeDither: 100,
    strokeWidth: 0,
    strokeDash: [],
    strokeCap: "butt",
    strokePosition: "center",
    strokeRadius: 0,
    bwMode: "threshold",
    bwLevel: 50,
    opacity: 100,
    visible: true,
    svg: SOLID_BLACK_SVG,
    src: "",
    ...overrides,
  };
}

function countBlackPixels(canvas: Canvas): number {
  let n = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (canvas.getPixel(x, y) === 1) n++;
    }
  }
  return n;
}

describe("preRasterizeRotatedSvgs", () => {
  beforeEach(() => {
    _clearRotatedSvgCacheForTesting();
  });

  it("leaves non-svg elements untouched", async () => {
    const els = [{ type: "rect", sizeX: 10, sizeY: 10 }];
    const { elements: out, preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(out).toEqual(els);
    expect(preRendered.size).toBe(0);
  });

  it("leaves un-rotated SVGs to the engine path", async () => {
    const els = [defaultSvgEl({ pos: { x: 100, y: 100 } })];
    const { preRendered, elements: out } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(preRendered.size).toBe(0);
    expect(out[0]).toBe(els[0]); // unchanged reference
  });

  it("leaves rotated SVGs wholly inside the canvas to the engine path", async () => {
    // pos.x + sizeX = 100 + 50 = 150, well inside 320×240.
    const els = [
      defaultSvgEl({ pos: { x: 100, y: 100 }, rotationDeg: 45 }),
    ];
    const { preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(preRendered.size).toBe(0);
  });

  it("intercepts rotated SVGs whose un-rotated bounds exceed the canvas", async () => {
    // pos.x + sizeX = 300 + 50 = 350 ≫ canvas width (320). The engine
    // path would render the icon partially clipped; rotation around
    // (300, 100) would then sample empty positions for everything past
    // the canvas right edge, producing visible clipping that worsens
    // with rotation magnitude — exactly the user-reported symptom.
    const els = [
      defaultSvgEl({
        pos: { x: 300, y: 100 },
        sizeX: 50,
        sizeY: 50,
        rotationDeg: 90,
      }),
    ];
    const { elements: out, preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );

    expect(preRendered.size).toBe(1);
    const muted = out[0] as Record<string, unknown>;
    expect(muted.svg).toBe("");
    expect(muted.src).toBe("");
    expect(muted.rotationDeg).toBe(0);
    expect(muted.scale).toEqual({ x: 1, y: 1 });

    const canvas = new Canvas(320, 240);
    compositeRotatedSvgs(canvas, preRendered);
    // A 50×50 solid icon rotated 90° about its top-left corner
    // (300, 100) lands in [(250, 100), (300, 150)] — fully inside the
    // canvas. Expect a substantial number of black pixels.
    expect(countBlackPixels(canvas)).toBeGreaterThan(1500);
  });

  it("places composited rotated SVGs in the rotated bbox region", async () => {
    // 50×50 icon at (300, 100), rotated 90° CW around its corner
    // (origin 0,0). The rotated bbox is roughly (250, 100)-(300, 150).
    const els = [
      defaultSvgEl({
        pos: { x: 300, y: 100 },
        sizeX: 50,
        sizeY: 50,
        rotationDeg: 90,
      }),
    ];
    const { preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    const canvas = new Canvas(320, 240);
    compositeRotatedSvgs(canvas, preRendered);

    // Confirm ink lands inside the expected rotated-bbox window and
    // none lands far away from it.
    let inRotatedBbox = 0;
    let strayFarAway = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (canvas.getPixel(x, y) !== 1) continue;
        if (x >= 245 && x <= 305 && y >= 95 && y <= 155) inRotatedBbox++;
        else if (x < 200 || x > 320 || y < 50 || y > 200) strayFarAway++;
      }
    }
    expect(inRotatedBbox).toBeGreaterThan(1500);
    expect(strayFarAway).toBe(0);
  });

  it("skips invisible SVGs", async () => {
    const els = [
      defaultSvgEl({
        pos: { x: 300, y: 100 },
        rotationDeg: 90,
        visible: false,
      }),
    ];
    const { preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(preRendered.size).toBe(0);
  });

  it("falls through to engine for stroked rotated SVGs", async () => {
    // The engine's morphological stroke path cannot be reproduced
    // without copying frozen code; rotated stroked icons are rare.
    const els = [
      defaultSvgEl({
        pos: { x: 300, y: 100 },
        rotationDeg: 90,
        enableStroke: true,
        strokeWidth: 1,
      }),
    ];
    const { preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(preRendered.size).toBe(0);
  });

  it("falls through for SVGs with no inline content", async () => {
    // URL-only SVGs (`src` set, no `svg` body) are handled by the
    // engine's fetch+rasterize path — out of scope here.
    const els = [
      defaultSvgEl({
        pos: { x: 300, y: 100 },
        rotationDeg: 90,
        svg: "",
        src: "https://example.invalid/icon.svg",
      }),
    ];
    const { preRendered, elements: out } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(preRendered.size).toBe(0);
    expect(out[0]).toBe(els[0]);
  });

  it("intercepts non-unit scale even at zero rotation when bbox exceeds canvas", async () => {
    // Scale alone also routes through drawWithTransform's broken
    // temp-canvas path, so it must be intercepted on the same terms.
    const els = [
      defaultSvgEl({
        pos: { x: 300, y: 100 },
        sizeX: 50,
        sizeY: 50,
        scale: { x: 1.5, y: 1.5 },
      }),
    ];
    const { preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(preRendered.size).toBe(1);
  });

  it("preserves z-order via insertion order in the preRendered Map", async () => {
    // Two affected icons interleaved with an unaffected rect. The
    // pre-rendered Map's iteration order must equal element index
    // order so the post-render compositor lays them down low-index
    // first / high-index on top.
    const els = [
      defaultSvgEl({ pos: { x: 300, y: 50 }, rotationDeg: 30 }),
      { type: "rect", pos: { x: 0, y: 0 }, sizeX: 10, sizeY: 10 },
      defaultSvgEl({ pos: { x: 300, y: 150 }, rotationDeg: 60 }),
    ];
    const { preRendered } = await preRasterizeRotatedSvgs(
      els,
      createDataContext(),
      320,
      240,
    );
    expect(Array.from(preRendered.keys())).toEqual([0, 2]);
  });
});
