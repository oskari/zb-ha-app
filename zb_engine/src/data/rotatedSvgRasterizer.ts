/**
 * rotatedSvgRasterizer.ts — Out-of-engine rasterization for rotated/scaled
 * SVG elements (notably the icon picker's Tabler icons).
 *
 * Problem
 * ───────
 * Same root cause as `data/rotatedTextRasterizer.ts`: the frozen draw
 * engine renders rotated/scaled elements via
 * `engine/transform.ts#drawWithTransform`, which:
 *
 *   1. Allocates a temporary 1-bit canvas the same size as the main
 *      canvas (`new TransformCanvas(canvas.width, canvas.height)`).
 *   2. Calls the element's primitive (`drawSvg`) on the temp canvas
 *      at the element's *un-rotated* world position.
 *   3. Inverse-maps every destination pixel in the rotated bounding
 *      box back to the temp canvas to sample the un-rotated source.
 *
 * `Canvas.setPixel` silently ignores out-of-bounds writes. So if the
 * un-rotated SVG bbox extends past the canvas — which happens whenever
 * the element's `pos.x + sizeX` or `pos.y + sizeY` exceeds the canvas,
 * including the very common case of an icon placed with default
 * `origin = {x: 0, y: 0}` so rotation pivots around its top-left corner
 * and the icon "swings" past an edge — the pixels that land outside the
 * temp canvas are silently dropped. The inverse-mapping step then
 * samples those positions and finds nothing, so the deployed image
 * shows the rotated icon clipped or fully missing even when the
 * builder's Konva preview (which transforms inside its own
 * group-clipped bbox, not the artboard) renders it correctly.
 *
 * Per `ENGINEERING_CONSTRAINTS.md` §1 the engine is frozen, so the temp-canvas
 * sizing cannot be widened. The fix lives outside the engine, mirroring
 * the established pattern of `rotatedTextRasterizer`, `svgPreRasterizer`
 * and `userAssets`: detect the affected elements, render them into a
 * local buffer the bounding box's actual size, mute the original
 * element so the engine skips it, and composite the result onto the
 * canvas after `render()` returns.
 *
 * Scope
 * ─────
 * Only triggered when:
 *   - `type === "svg"`
 *   - element is `visible` and has non-empty resolved `svg` content
 *   - rotation OR non-unit scale is applied (engine path otherwise works)
 *   - the un-rotated bounding box extends past the canvas in any direction
 *   - `enableStroke === false` (the engine's morphological stroke path
 *     uses dilate/erode passes that we cannot replicate without
 *     duplicating frozen code; rotated stroked SVGs fall through to
 *     the engine — a vanishingly rare combination).
 *
 * Anything else falls through to the engine unchanged. The preserved-
 * z-order property of in-bounds rotated SVGs therefore is unaffected;
 * only the broken case is rerouted, and rerouted elements are
 * composited after the engine render (i.e. on top of all other
 * geometry). For the single icon per layout that this typically affects
 * — a rotated edge-placed icon — being on top is consistent with how
 * users actually use rotated icons.
 */

import sharp from "sharp";
import { createHash } from "crypto";
import type { Canvas } from "../engine/canvas";
import { resolveElement } from "../engine/elementResolver";
import { shouldDitherPixel, setWithOpacity } from "../engine/dither";
import type { SvgProps } from "../engine/types";
import type { DataContext } from "@zb/expressions";
import { sanitizeSvgForRasterization } from "./svgSanitization";
import { MAX_INLINE_SVG_BYTES } from "../engine/primitives/assetLimits";
import { MAX_RASTER_AXIS, MAX_RASTER_PIXELS } from "./rasterLimits";

// ── Types ──────────────────────────────────────────────────────

/**
 * Pre-rendered un-rotated SVG, ready for rotated compositing. The
 * `pixels` buffer is the grayscale output of sharp at exactly
 * (srcW × srcH); inverse-mapping reads it the same way the engine
 * would have read its temp canvas.
 */
interface PreRenderedRotatedSvg {
  /** Resolved element props — needed for fill/threshold/dither/opacity. */
  readonly props: SvgProps;
  /** Grayscale bytes; `pixels.length === srcW * srcH`. */
  readonly pixels: Buffer;
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

export interface RotatedSvgResult {
  /**
   * Element list with affected SVG elements muted (`svg: ""`, `src: ""`,
   * `rotationDeg: 0`, identity scale). Mutation keeps every other field
   * intact so that the engine still accounts for the element's z-order
   * slot but `drawSvg` early-returns at its
   * `if (!svgContent || sizeX <= 0 || sizeY <= 0) return;` guard.
   */
  readonly elements: Record<string, unknown>[];

  /** Pre-rendered entries keyed by element index, composited after render(). */
  readonly preRendered: Map<number, PreRenderedRotatedSvg>;

  /**
   * Diagnostic strings — one entry per SVG that was attempted but
   * failed to pre-rasterize. The renderService merges these into
   * `meta.renderErrors` so the user has visibility, identical in spirit
   * to the other pre-raster passes.
   */
  readonly errors: string[];
}

// ── Cache ─────────────────────────────────────────────────────

/**
 * Insertion-ordered LRU keyed by `hash(svg + width + height)`. Same
 * shape and policy as the cache in `svgPreRasterizer.ts` — duplicated
 * locally so the two passes do not cross-pollute each other's state and
 * so this module has no dependency on the other's internals.
 */
const cache = new Map<
  string,
  { pixels: Buffer; width: number; height: number }
>();
const CACHE_MAX_ENTRIES = 16;

function cacheKey(svgContent: string, width: number, height: number): string {
  return createHash("sha256")
    .update(`${width}x${height}\0`)
    .update(svgContent)
    .digest("hex");
}

function cacheGet(
  key: string,
): { pixels: Buffer; width: number; height: number } | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cachePut(
  key: string,
  value: { pixels: Buffer; width: number; height: number },
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test-only helper: clear the LRU cache between unit tests. */
export function _clearRotatedSvgCacheForTesting(): void {
  cache.clear();
}

// ── Sharp pipeline ────────────────────────────────────────────

/**
 * Generous timeout for sharp's SVG rasterization — matches the value
 * used by `svgPreRasterizer`. The frozen engine's own limit is 300 ms;
 * 5 s here gives small Tabler-style icons all the headroom they need
 * while still bounding worst-case latency.
 */
const PRE_RASTER_TIMEOUT_MS = 5_000;

/** Race a promise against a deadline. Local copy to avoid engine imports. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    handle = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    handle.unref?.();
  });
  return Promise.race([
    promise.then(
      (v) => {
        clearTimeout(handle);
        return v;
      },
      (e) => {
        clearTimeout(handle);
        throw e;
      },
    ),
    timeoutPromise,
  ]);
}

/**
 * Rasterize an SVG to a grayscale raw bitmap of the requested size,
 * caching the result by `(content, width, height)`. Returns null on
 * any failure — the caller leaves the element untouched so the engine
 * can attempt its own rasterization.
 */
async function tryPreRasterize(
  svgContent: string,
  width: number,
  height: number,
): Promise<{ pixels: Buffer; width: number; height: number } | null> {
  // Sanitize BEFORE hashing so identical post-sanitization content
  // shares a cache entry, and so the cache never stores a key derived
  // from attacker-controlled <script>/<image href> bytes.
  const safeSvg = sanitizeSvgForRasterization(svgContent);

  const key = cacheKey(safeSvg, width, height);
  const hit = cacheGet(key);
  if (hit) return hit;

  try {
    const { data, info } = await withTimeout(
      sharp(Buffer.from(safeSvg), { failOn: "error" })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(width, height, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      PRE_RASTER_TIMEOUT_MS,
      "Rotated-SVG pre-rasterization",
    );

    const entry = { pixels: data, width: info.width, height: info.height };
    cachePut(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// ── Geometry ──────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────

/**
 * Walk the element list, pre-render every rotated/scaled SVG element
 * whose un-rotated bounds exceed the canvas, and return the rewritten
 * element list together with a map of pre-rendered bitmaps.
 *
 * Must run AFTER the SVG normalisation pass (`normalizeSvgElements`,
 * which sets `width`/`height`/`preserveAspectRatio` on the inline SVG
 * so sharp rasterizes at exactly `sizeX × sizeY`) and BEFORE the engine
 * `render()` call.
 */
export async function preRasterizeRotatedSvgs(
  elements: Record<string, unknown>[],
  ctx: DataContext,
  canvasWidth: number,
  canvasHeight: number,
  signal?: AbortSignal,
): Promise<RotatedSvgResult> {
  const out = elements.slice();
  const preRendered = new Map<number, PreRenderedRotatedSvg>();
  const errors: string[] = [];

  for (let i = 0; i < out.length; i++) {
    // Cooperative cancellation — see `rotatedTextRasterizer.ts` for
    // the rationale.
    if (signal?.aborted) throw new Error("RENDER_ABORTED");
    const raw = out[i];
    if (!raw || raw.type !== "svg") continue;

    // Only handle inline SVGs. URL-fetched SVGs (`src` only) require
    // an HTTP fetch the engine performs internally; we don't replicate
    // that pipeline here. They fall through unchanged.
    const rawSvg = typeof raw.svg === "string" ? raw.svg : "";
    if (!rawSvg) continue;

    // Defensive size cap — the engine enforces this in
    // `assertTextWithinLimit` before its own raster path; we must
    // re-check because this pass clears the SVG field on success and
    // the engine never sees the content.
    if (rawSvg.length > MAX_INLINE_SVG_BYTES) continue;

    let resolved: SvgProps;
    try {
      const r = resolveElement(raw, ctx);
      if (r.type !== "svg") continue;
      resolved = r;
    } catch {
      // Binding failure: leave the element to the engine, which will
      // surface the error through `meta.renderErrors`.
      continue;
    }

    if (!resolved.visible) continue;
    if (resolved.sizeX <= 0 || resolved.sizeY <= 0) continue;

    const hasTransform =
      resolved.rotationDeg !== 0 ||
      resolved.scale.x !== 1 ||
      resolved.scale.y !== 1;
    if (!hasTransform) continue;

    // Engine's morphological stroke path (dilate/erode of the shape
    // mask) cannot be reproduced byte-identically without copying
    // frozen code. Stroked rotated SVGs are rare; let the engine try.
    if (resolved.enableStroke) continue;

    // Engine path is correct whenever the un-rotated draw fits inside
    // the canvas — `Canvas.setPixel` only drops out-of-bounds writes,
    // and within-canvas pixels rotate correctly via inverse-mapping.
    // Skip these to preserve z-order behaviour for the common case.
    const x0 = Math.round(resolved.pos.x);
    const y0 = Math.round(resolved.pos.y);
    const w = Math.round(resolved.sizeX);
    const h = Math.round(resolved.sizeY);
    const insideCanvas =
      x0 >= 0 && y0 >= 0 && x0 + w <= canvasWidth && y0 + h <= canvasHeight;
    if (insideCanvas) continue;

    // Clamp output dimensions defensively — `sizeX`/`sizeY` come from
    // payload data and an attacker-supplied widget could in principle
    // request a multi-megapixel allocation that OOMs the process
    // before sharp's timeout fires.
    const targetW = Math.min(w, MAX_RASTER_AXIS);
    const targetH = Math.min(h, MAX_RASTER_AXIS);
    if (targetW <= 0 || targetH <= 0) continue;
    if (targetW * targetH > MAX_RASTER_PIXELS) {
      errors.push(
        `Element #${i} (svg, rotated) — requested raster ${targetW}×${targetH} ` +
          `exceeds pixel budget; falling back to engine.`,
      );
      continue;
    }

    const bitmap = await tryPreRasterize(rawSvg, targetW, targetH);
    if (!bitmap) {
      errors.push(
        `Element #${i} (svg, rotated, ${rawSvg.length}B) — pre-rasterization ` +
          `failed; falling back to engine.`,
      );
      continue;
    }

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
      w,
      h,
      centerX,
      centerY,
      angle,
      sx,
      sy,
    );

    preRendered.set(i, {
      props: resolved,
      pixels: bitmap.pixels,
      srcX: x0,
      srcY: y0,
      srcW: bitmap.width,
      srcH: bitmap.height,
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

    // Mute the element so the engine skips it. Clearing both `svg` and
    // `src` ensures the engine's `drawSvg` early-returns at its
    // `if (!svgContent || sizeX <= 0 || sizeY <= 0) return;` guard.
    // Resetting the transform fields additionally avoids a wasted
    // full-canvas temp allocation in `drawWithTransform` for an
    // element that produces no output.
    out[i] = {
      ...raw,
      svg: "",
      src: "",
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
    };
  }

  return { elements: out, preRendered, errors };
}

// ── Compositor ────────────────────────────────────────────────

/**
 * Inverse-map every destination pixel in the rotated world bbox back
 * to the un-rotated local source bitmap; write inked pixels onto the
 * canvas using the engine's exact dither / opacity helpers.
 *
 * Follows:
 *   - `engine/transform.ts#drawWithTransform` for the inverse-map loop
 *   - `engine/primitives/svg.ts#drawSvg` (fill-only / no-stroke branch)
 *     for the per-pixel decision — `shapeMask = (gray < threshold)`, then
 *     `fillPixel = shouldDitherPixel(...) ? 1 : 0`, then
 *     `setWithOpacity(canvas, px, py, fillPixel, opacity)`. The
 *     `enableFill === false` path likewise uses bwMode (threshold OR
 *     ordered dither) directly on the gray value.
 *
 * NOT identical to drawSvg in one respect: the ordered dither is sampled
 * here at the rotated DESTINATION coords (`wx, wy`), whereas drawSvg — and
 * the sibling `rotatedTextRasterizer` (see its `blitGlyphLocal`) — dither
 * at un-rotated SOURCE/world coords. So for dithered fills or
 * `bwMode === "dither"` the dither texture aligns to the canvas grid and
 * differs subtly from a non-rotated render; threshold (non-dithered)
 * output is unaffected. To get true parity, sample at `(srcX, srcY)`.
 */
function compositeOne(canvas: Canvas, e: PreRenderedRotatedSvg): void {
  const { props, pixels, srcW, srcH, centerX, centerY, angle, sx, sy } = e;
  const cosInv = Math.cos(-angle);
  const sinInv = Math.sin(-angle);
  const threshold = Math.round((props.bwLevel / 100) * 255);

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
      if (lx < 0 || lx >= srcW || ly < 0 || ly >= srcH) continue;

      const gray = pixels[ly * srcW + lx];

      if (props.enableFill) {
        // Fill-only path: shape mask = (gray < threshold), then dither
        // the fill value at each "on" pixel. Background pixels are
        // intentionally untouched so the rotated icon doesn't erase
        // underlying geometry — as in drawSvg's enableFill && !enableStroke
        // branch (modulo the dither-coord divergence noted on this function).
        if (gray >= threshold) continue;
        const fillPixel = shouldDitherPixel(wx, wy, props.fill) ? 1 : 0;
        setWithOpacity(canvas, wx, wy, fillPixel, props.opacity);
      } else {
        // No-fill, no-stroke: write each pixel directly using bwMode.
        let isBlack: boolean;
        if (props.bwMode === "dither") {
          isBlack = shouldDitherPixel(
            wx,
            wy,
            Math.round((1 - gray / 255) * 100),
          );
        } else {
          isBlack = gray < threshold;
        }
        setWithOpacity(canvas, wx, wy, isBlack ? 1 : 0, props.opacity);
      }
    }
  }
}

/**
 * Composite every pre-rendered rotated-SVG bitmap onto the engine's
 * 1-bit canvas. Called by `runPipeline` after `render()` finishes.
 *
 * Map iteration order is insertion order, which matches element index
 * order — same z-order policy as the other post-render compositors.
 */
export function compositeRotatedSvgs(
  canvas: Canvas,
  entries: Map<number, PreRenderedRotatedSvg>,
): void {
  for (const entry of entries.values()) {
    compositeOne(canvas, entry);
  }
}
