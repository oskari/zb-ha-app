/**
 * rotatedTextRasterizer.ts — Out-of-engine rasterization for rotated/scaled
 * text whose un-rotated bounding box extends beyond the canvas.
 *
 * Problem
 * ───────
 * The frozen draw engine renders rotated/scaled elements via
 * `engine/transform.ts#drawWithTransform`, which:
 *
 *   1. Allocates a temporary 1-bit canvas the same size as the main
 *      canvas (`new TransformCanvas(canvas.width, canvas.height)`).
 *   2. Calls the element's primitive (e.g. `drawText`) on the temp
 *      canvas at the element's *un-rotated* world position.
 *   3. Inverse-maps every destination pixel in the rotated bounding box
 *      back to the temp canvas to sample the un-rotated source.
 *
 * For text, `drawText` clips glyph blits to the canvas extents
 * (`glyphRenderer.ts#blitGlyphClipped` checks `px < 0 || px >= canvas.width`).
 * If `expandTextBounds` has grown the box so that the un-rotated form
 * extends past the canvas edge — which happens whenever the user picks a
 * large font and places the rotated text near a canvas border — the
 * glyphs landing outside the canvas are silently dropped from the temp.
 * The inverse-mapping step then samples those positions and finds
 * nothing, so the deployed image shows clipped or missing text even
 * though the un-rotated bounding box, the rotated bounding box, and the
 * builder's Konva preview (which renders text into its own bbox-sized
 * offscreen canvas, not the artboard) all look correct.
 *
 * Per `ENGINEERING_CONSTRAINTS.md` §1 the engine is frozen, so the temp-canvas
 * sizing cannot be widened. The fix lives outside the engine, mirroring
 * the established pattern of `svgPreRasterizer`, `userAssets`, and
 * `expandTextBounds`: detect the affected elements, render them into a
 * local buffer the bounding box's actual size, mute the original element
 * so the engine skips it, and composite the result onto the canvas after
 * `render()` returns.
 *
 * Scope
 * ─────
 * Only triggered when:
 *   - `type === "text"`
 *   - element is `visible` and has non-empty resolved text
 *   - rotation OR non-unit scale is applied (engine path otherwise works)
 *   - the un-rotated bounding box extends past the canvas in any direction
 *
 * Anything else falls through to the engine unchanged. The preserved-
 * z-order property of in-bounds rotated text therefore is unaffected;
 * only the broken case is rerouted, and rerouted elements are composited
 * after the engine render (i.e. on top of all other geometry). For the
 * single text element per layout that this typically affects — a label
 * intentionally placed at the canvas edge — being on top is consistent
 * with how users actually use rotated text.
 */

import type { Canvas } from "../engine/canvas";
import { resolveElement } from "../engine/elementResolver";
import { MAX_RASTER_AXIS, MAX_RASTER_PIXELS } from "./rasterLimits";
import type { TextProps } from "../engine/types";
import type { DataContext } from "@zb/expressions";
import { getFontForFamily, fontsReady } from "../engine/fonts/fontManager";
import { shouldDitherPixel } from "../engine/dither";
import type { DecodedGlyph, FontPack } from "../engine/fonts/fontTypes";

// ── Types ──────────────────────────────────────────────────────

/**
 * Pre-rendered un-rotated text, ready for rotated compositing.
 * `pixels[row * srcW + col] === 1` marks an inked pixel that the engine
 * would have written to its temp canvas at world position
 * `(srcX + col, srcY + row)`.
 */
interface PreRenderedRotatedText {
  readonly pixels: Uint8Array;
  readonly srcX: number;
  readonly srcY: number;
  readonly srcW: number;
  readonly srcH: number;
  readonly centerX: number;
  readonly centerY: number;
  /** Rotation in radians (positive = clockwise on top-left-origin canvas). */
  readonly angle: number;
  readonly sx: number;
  readonly sy: number;
  /** World bounds of the rotated output (the iteration window for compositing). */
  readonly dstX: number;
  readonly dstY: number;
  readonly dstW: number;
  readonly dstH: number;
}

export interface RotatedTextResult {
  /**
   * Element list with affected text elements muted (`text: ""`,
   * `rotationDeg: 0`, identity scale). Mutation keeps every other
   * field intact so that the engine still accounts for the element's
   * z-order slot but `drawText` early-returns at its
   * `if (!text || sizeX <= 0 || sizeY <= 0) return;` guard.
   */
  readonly elements: Record<string, unknown>[];

  /** Pre-rendered entries keyed by element index, composited after render(). */
  readonly preRendered: Map<number, PreRenderedRotatedText>;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Walk the element list, pre-render every rotated/scaled text element
 * whose un-rotated bounds exceed the canvas, and return the rewritten
 * element list together with a map of pre-rendered bitmaps.
 *
 * Must run AFTER `expandTextBounds` (so we see the grown sizeX/sizeY)
 * and BEFORE the engine `render()` call.
 */
export async function preRasterizeRotatedText(
  elements: Record<string, unknown>[],
  ctx: DataContext,
  canvasWidth: number,
  canvasHeight: number,
  signal?: AbortSignal,
): Promise<RotatedTextResult> {
  await fontsReady;

  const out = elements.slice();
  const preRendered = new Map<number, PreRenderedRotatedText>();

  for (let i = 0; i < out.length; i++) {
    // Cooperative cancellation: a render-level timeout fires its
    // AbortController; check between elements so a long element list
    // bails out promptly instead of running to completion under a
    // RenderGuard the route has already released.
    if (signal?.aborted) throw new Error("RENDER_ABORTED");
    const raw = out[i];
    if (!raw || raw.type !== "text") continue;

    let resolved: TextProps;
    try {
      const r = resolveElement(raw, ctx);
      if (r.type !== "text") continue;
      resolved = r;
    } catch {
      // Binding failure: leave the element to the engine, which will
      // surface the error through `meta.renderErrors`.
      continue;
    }

    if (!resolved.visible) continue;
    if (!resolved.text) continue;
    if (resolved.sizeX <= 0 || resolved.sizeY <= 0) continue;

    const hasTransform =
      resolved.rotationDeg !== 0 ||
      resolved.scale.x !== 1 ||
      resolved.scale.y !== 1;
    if (!hasTransform) continue;

    // Engine path is correct whenever the un-rotated draw fits inside
    // the canvas — `blitGlyphClipped` only drops pixels at the canvas
    // boundary, and within-canvas pixels rotate correctly. Skip these
    // to preserve z-order behaviour for the common case.
    const x0 = Math.round(resolved.pos.x);
    const y0 = Math.round(resolved.pos.y);
    const w = Math.round(resolved.sizeX);
    const h = Math.round(resolved.sizeY);
    const insideCanvas =
      x0 >= 0 && y0 >= 0 && x0 + w <= canvasWidth && y0 + h <= canvasHeight;
    if (insideCanvas) continue;

    // Clamp the local-buffer dimensions defensively — `sizeX`/`sizeY` come
    // from payload data, so an attacker-supplied widget could otherwise drive
    // an unbounded `new Uint8Array(w * h)` allocation in
    // `renderTextToLocalBuffer` (a synchronous alloc the render-timeout
    // AbortSignal cannot interrupt) and OOM the container. Mirrors the sibling
    // raster passes (rotatedSvgRasterizer / svgPreRasterizer / userAssets).
    // Over the pixel budget we fall back to the engine, which clips text to
    // the canvas bounds and therefore cannot over-allocate.
    const targetW = Math.min(w, MAX_RASTER_AXIS);
    const targetH = Math.min(h, MAX_RASTER_AXIS);
    if (targetW <= 0 || targetH <= 0) continue;
    if (targetW * targetH > MAX_RASTER_PIXELS) continue;

    const font = getFontForFamily(
      resolved.fontFamily,
      resolved.fontSize,
      resolved.fontWeight,
    );
    if (!font) continue;

    const pixels = renderTextToLocalBuffer(resolved, font, x0, y0, targetW, targetH);

    const centerX = resolved.pos.x + resolved.origin.x;
    const centerY = resolved.pos.y + resolved.origin.y;
    const angle = (resolved.rotationDeg * Math.PI) / 180;
    // Match the engine's div-by-zero guard exactly so the inverse-map
    // math stays equivalent for degenerate scales.
    const sx = resolved.scale.x || 1e-10;
    const sy = resolved.scale.y || 1e-10;

    const { dstX, dstY, dstW, dstH } = computeRotatedBounds(
      x0,
      y0,
      targetW,
      targetH,
      centerX,
      centerY,
      angle,
      sx,
      sy,
    );

    preRendered.set(i, {
      pixels,
      srcX: x0,
      srcY: y0,
      srcW: targetW,
      srcH: targetH,
      centerX,
      centerY,
      angle,
      sx,
      sy,
      dstX,
      dstY,
      dstW,
      dstH,
    });

    // Mute the element so the engine skips it entirely. We must also
    // clear `fallbackText`, because the engine's `resolveText` swaps in
    // the fallback string whenever `text` is empty — which would cause
    // the engine to draw the fallback (default `"(no data)"`) at the
    // original un-rotated position. Setting both `text` and
    // `fallbackText` to "" guarantees `drawText` early-returns at its
    // `if (!text || ...) return;` guard. Resetting the transform fields
    // additionally avoids a wasted full-canvas temp allocation in
    // `drawWithTransform` for an element that produces no output.
    out[i] = {
      ...raw,
      text: "",
      fallbackText: "",
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
    };
  }

  return { elements: out, preRendered };
}

/**
 * Composite every pre-rendered rotated-text bitmap onto the engine's
 * 1-bit canvas using inverse-mapping that mirrors
 * `engine/transform.ts#drawWithTransform`.
 *
 * Called by `runPipeline` after `render()` finishes.
 */
export function compositeRotatedText(
  canvas: Canvas,
  entries: Map<number, PreRenderedRotatedText>,
): void {
  // Map iteration order is insertion order, which matches element
  // index order. This is the same z-order policy used by the SVG and
  // user-asset compositors — within the post-render pass, lower indices
  // are written first and higher indices on top.
  for (const entry of entries.values()) {
    compositeOne(canvas, entry);
  }
}

// ── Internal: text rendering ───────────────────────────────────

/**
 * Render the text glyphs into a tightly-sized local 1-bit buffer.
 * Mirrors `engine/primitives/text.ts#drawText` exactly, except that
 * pixel writes go to a local buffer indexed by `(localX, localY)`
 * instead of the engine canvas. Dither is computed at WORLD pixel
 * coordinates (`px`, `py`) so the output is byte-identical to what
 * the engine would have produced into its temp canvas.
 */
function renderTextToLocalBuffer(
  props: TextProps,
  font: FontPack,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Uint8Array {
  const buffer = new Uint8Array(w * h);
  const { text, fontSize, textAlign, lineHeight, fill, opacity } = props;

  const sampleGlyph = font.glyphs.values().next().value as
    | DecodedGlyph
    | undefined;
  const baseline = sampleGlyph?.baseline ?? Math.round(fontSize * 0.75);

  const lines = text.split("\n");
  const lineSpacing = Math.round(fontSize * lineHeight);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineY = y0 + lineIdx * lineSpacing;
    if (lineY >= y0 + h) break;

    let lineWidth = 0;
    for (const char of line) {
      const glyph = font.glyphs.get(char);
      if (glyph) {
        lineWidth += glyph.xAdvance + font.meta.letterSpacing;
      }
    }
    if (line.length > 0) lineWidth -= font.meta.letterSpacing;

    let cursorX: number;
    if (textAlign === "center") {
      cursorX = x0 + Math.round((w - lineWidth) / 2);
    } else if (textAlign === "right") {
      cursorX = x0 + w - lineWidth;
    } else {
      cursorX = x0;
    }

    for (const char of line) {
      const glyph = font.glyphs.get(char);
      if (!glyph) {
        const spaceGlyph = font.glyphs.get(" ");
        cursorX += spaceGlyph?.xAdvance ?? Math.round(fontSize * 0.3);
        continue;
      }
      if (cursorX >= x0 + w) break;

      blitGlyphLocal(
        buffer,
        w,
        h,
        x0,
        y0,
        glyph,
        cursorX,
        lineY + baseline - glyph.baseline,
        fill,
        opacity,
        x0,
        y0,
        w,
        h,
      );
      cursorX += glyph.xAdvance + font.meta.letterSpacing;
    }
  }

  return buffer;
}

/**
 * Local-buffer port of `engine/fonts/glyphRenderer.ts#blitGlyphClipped`.
 * Same clipping semantics; the only difference is the destination —
 * world `(px, py)` → local `(px - bufX0, py - bufY0)`. Dither pattern
 * uses world coordinates so the rotated output dithers identically to
 * a non-rotated render.
 *
 * Stores 1 wherever the engine would have set a pixel to 1, leaving
 * background bytes at 0. The compositor only writes 1s to the canvas,
 * so the rare `fill < 100` case where the engine would have written 0
 * over an existing 1 is treated as a no-op — matching the visually-
 * indistinguishable behaviour of black text on a white-by-default
 * post-render area, and avoiding cross-element interference.
 */
function blitGlyphLocal(
  buffer: Uint8Array,
  bufW: number,
  bufH: number,
  bufX0: number,
  bufY0: number,
  glyph: DecodedGlyph,
  x: number,
  y: number,
  fill: number,
  opacity: number,
  clipX: number,
  clipY: number,
  clipW: number,
  clipH: number,
): void {
  const gx = Math.round(x + glyph.xOffset);
  const gy = Math.round(y + glyph.yOffset);
  const stride = Math.ceil(glyph.width / 8);
  const clipRight = clipX + clipW;
  const clipBottom = clipY + clipH;

  for (let row = 0; row < glyph.height; row++) {
    const py = gy + row;
    if (py < clipY || py >= clipBottom) continue;
    const localY = py - bufY0;
    if (localY < 0 || localY >= bufH) continue;

    for (let col = 0; col < glyph.width; col++) {
      const px = gx + col;
      if (px < clipX || px >= clipRight) continue;
      const localX = px - bufX0;
      if (localX < 0 || localX >= bufW) continue;

      const byteIdx = row * stride + (col >> 3);
      const bitIdx = 7 - (col & 7);
      const isInk = (glyph.pixels[byteIdx] >> bitIdx) & 1;
      if (!isInk) continue;

      const val = shouldDitherPixel(px, py, fill) ? 1 : 0;
      if (val === 0) continue;

      if (opacity >= 100) {
        buffer[localY * bufW + localX] = 1;
      } else if (opacity > 0 && shouldDitherPixel(px, py, opacity)) {
        buffer[localY * bufW + localX] = 1;
      }
    }
  }
}

// ── Internal: rotated-bounds geometry ──────────────────────────

/**
 * Forward-rotate the four corners of the un-rotated bbox to find the
 * world bounding rectangle of the rotated output. Mirrors
 * `engine/transform.ts#transformBounds` (with the same 1 px halo) so
 * the iteration window matches what the engine would have produced.
 */
function computeRotatedBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  centerX: number,
  centerY: number,
  angle: number,
  sx: number,
  sy: number,
): { dstX: number; dstY: number; dstW: number; dstH: number } {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const corners = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const dx = (c.x - centerX) * sx;
    const dy = (c.y - centerY) * sy;
    const wx = dx * cosA - dy * sinA + centerX;
    const wy = dx * sinA + dy * cosA + centerY;
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
  }

  return {
    dstX: Math.floor(minX) - 1,
    dstY: Math.floor(minY) - 1,
    dstW: Math.ceil(maxX - minX) + 2,
    dstH: Math.ceil(maxY - minY) + 2,
  };
}

// ── Internal: compositing ──────────────────────────────────────

/**
 * Inverse-map every destination pixel in the rotated world bbox back
 * to the un-rotated local buffer; copy the inked pixels onto the
 * canvas. This is the same loop body as
 * `engine/transform.ts#drawWithTransform`, with the local buffer
 * playing the role of the temp canvas.
 */
function compositeOne(canvas: Canvas, e: PreRenderedRotatedText): void {
  const { centerX, centerY, angle, sx, sy } = e;
  const cosInv = Math.cos(-angle);
  const sinInv = Math.sin(-angle);

  const startX = Math.max(0, e.dstX);
  const startY = Math.max(0, e.dstY);
  const endX = Math.min(canvas.width - 1, e.dstX + e.dstW);
  const endY = Math.min(canvas.height - 1, e.dstY + e.dstH);

  for (let wy = startY; wy <= endY; wy++) {
    for (let wx = startX; wx <= endX; wx++) {
      const dx = wx - centerX;
      const dy = wy - centerY;
      const rx = dx * cosInv - dy * sinInv;
      const ry = dx * sinInv + dy * cosInv;
      const srcX = Math.round(rx / sx + centerX);
      const srcY = Math.round(ry / sy + centerY);

      const lx = srcX - e.srcX;
      const ly = srcY - e.srcY;
      if (lx < 0 || lx >= e.srcW || ly < 0 || ly >= e.srcH) continue;
      if (e.pixels[ly * e.srcW + lx] === 1) {
        canvas.setPixel(wx, wy, 1);
      }
    }
  }
}
