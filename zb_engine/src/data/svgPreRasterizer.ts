/**
 * svgPreRasterizer.ts — Out-of-engine SVG rasterization with caching
 *
 * Problem
 * ───────
 * The frozen draw engine rasterizes inline SVGs with sharp/librsvg under a
 * hard 300 ms timeout (`SVG_RASTER_TIMEOUT_MS` in
 * `src/engine/primitives/assetLimits.ts`). Vector exports of any complexity —
 * the user's reported case is a 927 KB SVG with thousands of paths —
 * intermittently breach that deadline, are silently dropped by the engine,
 * and leave the user with a blank region and no actionable feedback.
 *
 * Per `ENGINEERING_CONSTRAINTS.md` the engine is frozen, so the timeout itself
 * cannot be lifted. The fix lives outside the engine.
 *
 * Strategy
 * ────────
 * For every inline SVG element that exceeds a size threshold and uses the
 * common simple-transform / fill-only / no-stroke path (the path the user
 * actually hits), the renderService:
 *
 *   1. Calls `tryPreRasterize` here — sharp converts the SVG to a grayscale
 *      raw bitmap with a generous (5 s) timeout. The result is cached by
 *      content hash so repeat renders of the same SVG are essentially free.
 *
 *   2. Clears the element's `svg` field. The engine's `drawSvg` then
 *      early-returns silently (no error, no work, no timeout race).
 *
 *   3. Calls `compositePreRasteredSvg` after `render()` returns, writing
 *      the cached bitmap onto the engine's 1-bit canvas using the same
 *      threshold/dither and fill-opacity logic the engine would have used.
 *
 * SVGs with rotation, non-uniform scale, or stroke fall through to the
 * engine path unchanged — those are rare for very large SVGs, and the
 * engine's `meta.renderErrors` plus the warning UI already surface the
 * timeout to the user when it happens.
 *
 * This module follows the same "pre-render pass outside the frozen engine"
 * pattern as `expandTextBounds`, `expandGraphElements`, and
 * `svgPreprocessor`.
 */

import sharp from "sharp";
import { createHash } from "crypto";
import type { Canvas } from "../engine/canvas";
import { shouldDitherPixel, setWithOpacity } from "../engine/dither";
import { resolveElement } from "../engine/elementResolver";
import { MAX_INLINE_SVG_BYTES } from "../engine/primitives/assetLimits";
import type { DataContext } from "@zb/expressions";
import type { SvgProps } from "../engine/types";
import { sanitizeSvgForRasterization } from "./svgSanitization";
import { MAX_RASTER_AXIS, MAX_RASTER_PIXELS } from "./rasterLimits";

/**
 * SVGs smaller than this are left alone — the engine handles them well
 * within its 300 ms timeout, and pre-rasterization would be pure overhead.
 * 50 KB is comfortably above all of the Tabler-icon set (which top out
 * around 1–2 KB) and well under the 1 MiB inline-SVG hard limit.
 */
const LARGE_SVG_THRESHOLD = 50 * 1024;

/**
 * Generous timeout for sharp's SVG rasterization. The engine's own limit
 * is 300 ms; we run with 5 s here because pre-rasterization is performed
 * once per (content, dimensions) tuple and then cached, so the latency
 * cost is amortised across every subsequent render of the same SVG.
 */
const PRE_RASTER_TIMEOUT_MS = 5_000;

/**
 * Maximum number of pre-rasterized bitmaps held in memory. Each entry
 * stores width × height grayscale bytes, so 16 entries at 720×480 is
 * roughly 5 MB — well under any practical memory budget.
 */
const CACHE_MAX_ENTRIES = 16;

/** A pre-rasterized SVG ready to be composited onto the engine canvas. */
export interface PreRasteredEntry {
  /** Resolved element props — values used during compositing. */
  readonly props: SvgProps;
  /** Raw grayscale bytes; `pixels.length === width * height`. */
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Result of the pre-raster pass. */
export interface PreRasterResult {
  /**
   * Elements with the pre-rasterized SVG fields cleared so the engine's
   * `drawSvg` early-returns silently. References that did not need
   * pre-rasterization are returned unchanged (preserved by reference).
   */
  readonly elements: Record<string, unknown>[];

  /**
   * Bitmaps keyed by their position in the returned `elements` array.
   * Iterated by `compositePreRasteredSvg` after the engine renders.
   */
  readonly preRastered: Map<number, PreRasteredEntry>;

  /**
   * Diagnostic strings — one entry per SVG that was attempted but
   * failed to pre-rasterize within the timeout. The renderService logs
   * these so the user has visibility, identical in spirit to
   * `meta.renderErrors`.
   */
  readonly errors: string[];
}

// ── Cache ─────────────────────────────────────────────────────

/**
 * Insertion-ordered LRU keyed by `hash(svg + width + height)`. Map's
 * iteration order is insertion order, so re-inserting on hit promotes
 * the entry and the oldest key is the first one yielded by `keys()`.
 */
const cache = new Map<string, { pixels: Buffer; width: number; height: number }>();

function cacheKey(svgContent: string, width: number, height: number): string {
  // SHA-256: collision-resistant, negligible cost for cache-key sizes.
  return createHash("sha256")
    .update(`${width}x${height}\0`)
    .update(svgContent)
    .digest("hex");
}

function cacheGet(key: string): { pixels: Buffer; width: number; height: number } | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  // Promote: delete + re-insert puts this entry at the end of iteration order.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cachePut(key: string, value: { pixels: Buffer; width: number; height: number }): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test-only helper: clear the LRU cache between unit tests. */
export function _clearPreRasterCacheForTesting(): void {
  cache.clear();
}

// ── Sharp pipeline ────────────────────────────────────────────

/**
 * Race a promise against a deadline — local copy of the engine's
 * `withTimeout` so this module has no engine import side-effects on
 * the timeout constant itself.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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
      (v) => { clearTimeout(handle); return v; },
      (e) => { clearTimeout(handle); throw e; },
    ),
    timeoutPromise,
  ]);
}

/**
 * Rasterize an SVG to a grayscale raw bitmap of the requested size,
 * caching the result by `(content, width, height)`. Returns null on
 * any failure — the caller leaves the element untouched so the engine
 * can attempt its own (300 ms) rasterization, preserving prior behaviour
 * for edge cases this module declines to handle.
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
      // `failOn: 'error'` makes sharp/libvips throw on malformed input
      // rather than silently producing a best-effort raster.
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
      "SVG pre-rasterization",
    );

    const entry = { pixels: data, width: info.width, height: info.height };
    cachePut(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// ── Eligibility predicate ─────────────────────────────────────

/**
 * Pre-rasterization is only attempted for SVGs that:
 *   1. Are inline (not URL-fetched — those go through a different code path).
 *   2. Exceed `LARGE_SVG_THRESHOLD` in source size.
 *   3. Have a simple transform (no rotation, scale=1) — anything else
 *      requires running the engine's transform-into-temp-canvas helper,
 *      which we cannot replicate without duplicating frozen code.
 *   4. Use the fill-only path (`enableStroke=false`). The stroke path
 *      runs morphological dilate/erode on the shape mask; out-of-engine
 *      reproduction would risk visual drift.
 *
 * Anything excluded falls through to the engine unchanged.
 */
function isPreRasterCandidate(props: SvgProps, rawSvg: string): boolean {
  if (!rawSvg || rawSvg.length < LARGE_SVG_THRESHOLD) return false;
  if (props.rotationDeg !== 0) return false;
  if (props.scale.x !== 1 || props.scale.y !== 1) return false;
  if (props.enableStroke) return false;
  if (props.sizeX <= 0 || props.sizeY <= 0) return false;
  return true;
}

// ── Pre-raster pass ───────────────────────────────────────────

/**
 * Walk the element list, pre-rasterize every eligible large inline SVG,
 * and return a new element list with the `svg` field cleared on each
 * pre-rasterized entry. Cleared elements still pass through the engine
 * but `drawSvg` early-returns at its `if (!svgContent ...) return` check,
 * so they cost nothing and emit no error.
 *
 * Group children are not recursed: large SVGs nested inside groups are
 * uncommon, and the engine's group-with-transform path requires
 * compositing inside the group's own temp canvas — out of scope for
 * this pass.
 */
export async function preRasterizeLargeSvgs(
  elements: Record<string, unknown>[],
  ctx: DataContext,
  signal?: AbortSignal,
): Promise<PreRasterResult> {
  const out = elements.slice();
  const preRastered = new Map<number, PreRasteredEntry>();
  const errors: string[] = [];

  for (let i = 0; i < out.length; i++) {
    // Cooperative cancellation — see `rotatedTextRasterizer.ts` for
    // the rationale.
    if (signal?.aborted) throw new Error("RENDER_ABORTED");
    const raw = out[i];
    if (!raw || raw.type !== "svg") continue;
    const rawSvg = typeof raw.svg === "string" ? raw.svg : "";
    if (rawSvg.length < LARGE_SVG_THRESHOLD) continue;

    // Mirror the engine's hard size limit. The engine enforces this in
    // `assertTextWithinLimit` before its own sanitize+raster path; we
    // must re-check because this pass runs first and the engine never
    // sees the SVG (its `svg` field is cleared on success).
    if (rawSvg.length > MAX_INLINE_SVG_BYTES) {
      errors.push(
        `Element #${i} (svg, ${rawSvg.length}B) — exceeds inline SVG size ` +
          `limit (${MAX_INLINE_SVG_BYTES}B); skipped.`,
      );
      continue;
    }

    let resolved: SvgProps;
    try {
      const r = resolveElement(raw, ctx);
      if (r.type !== "svg") continue;
      resolved = r;
    } catch {
      // Unresolvable bindings — let the engine handle the failure and
      // surface it through `meta.renderErrors`.
      continue;
    }

    if (!isPreRasterCandidate(resolved, rawSvg)) continue;

    // Clamp output dimensions defensively. `sizeX`/`sizeY` come from
    // payload data; without a cap a single element can request a
    // multi-megapixel allocation that OOMs the process before sharp's
    // timeout fires.
    const targetW = Math.min(Math.round(resolved.sizeX), MAX_RASTER_AXIS);
    const targetH = Math.min(Math.round(resolved.sizeY), MAX_RASTER_AXIS);
    if (targetW * targetH > MAX_RASTER_PIXELS) {
      errors.push(
        `Element #${i} (svg) — requested raster ${targetW}×${targetH} ` +
          `exceeds pixel budget; falling back to engine.`,
      );
      continue;
    }
    const bitmap = await tryPreRasterize(rawSvg, targetW, targetH);
    if (!bitmap) {
      errors.push(
        `Element #${i} (svg, ${rawSvg.length}B) — pre-rasterization failed; ` +
          `falling back to engine.`,
      );
      continue;
    }

    // Clear the svg field so the frozen engine's drawSvg early-returns.
    // Keep all other props (pos, size, transform, fill, opacity) so the
    // resolved element still participates in z-order accounting.
    out[i] = { ...raw, svg: "", src: "" };
    preRastered.set(i, {
      props: resolved,
      pixels: bitmap.pixels,
      width: bitmap.width,
      height: bitmap.height,
    });
  }

  return { elements: out, preRastered, errors };
}

// ── Compositor ────────────────────────────────────────────────

/**
 * Write a pre-rasterized SVG bitmap onto the engine's 1-bit canvas,
 * exactly reproducing the engine's `drawSvg` behaviour for the simple
 * fill-only / no-stroke path.
 *
 * Engine reference (do NOT modify): `src/engine/primitives/svg.ts#drawSvg`,
 * the `enableFill && !enableStroke` branch:
 *
 *   const shapeMask = (gray < threshold) ? 1 : 0;     // computed pre-loop
 *   for each pixel { if (shapeMask) {
 *     const fillPixel = shouldDitherPixel(px, py, fill) ? 1 : 0;
 *     setWithOpacity(canvas, px, py, fillPixel, opacity);
 *   } }
 *
 * The two engine helpers (`shouldDitherPixel`, `setWithOpacity`) are
 * imported as-is so dither characteristics stay byte-identical to the
 * engine's output.
 *
 * The `enableFill=false` branch is also supported for completeness — it
 * applies bwMode (threshold OR ordered dither) directly to the pixel
 * value, identical to drawSvg's first branch.
 */
function compositePreRasteredSvg(canvas: Canvas, entry: PreRasteredEntry): void {
  const { props, pixels, width: rasterW, height: rasterH } = entry;
  const w = Math.round(props.sizeX);
  const h = Math.round(props.sizeY);
  const x0 = Math.round(props.pos.x);
  const y0 = Math.round(props.pos.y);
  const threshold = Math.round((props.bwLevel / 100) * 255);

  if (!props.enableFill) {
    // No-fill, no-stroke: write each pixel directly, threshold or dither.
    for (let row = 0; row < rasterH && row < h; row++) {
      for (let col = 0; col < rasterW && col < w; col++) {
        const gray = pixels[row * rasterW + col];
        const px = x0 + col;
        const py = y0 + row;

        let isBlack: boolean;
        if (props.bwMode === "dither") {
          isBlack = shouldDitherPixel(px, py, Math.round((1 - gray / 255) * 100));
        } else {
          isBlack = gray < threshold;
        }
        setWithOpacity(canvas, px, py, isBlack ? 1 : 0, props.opacity);
      }
    }
    return;
  }

  // Fill-only path: shape mask = (gray < threshold), then dither fill
  // value at each "on" pixel. Stroke path is intentionally not handled —
  // `isPreRasterCandidate` excludes `enableStroke=true` elements.
  for (let row = 0; row < rasterH && row < h; row++) {
    for (let col = 0; col < rasterW && col < w; col++) {
      const gray = pixels[row * rasterW + col];
      if (gray >= threshold) continue;

      const px = x0 + col;
      const py = y0 + row;
      const fillPixel = shouldDitherPixel(px, py, props.fill) ? 1 : 0;
      setWithOpacity(canvas, px, py, fillPixel, props.opacity);
    }
  }
}

/**
 * Composite every pre-rasterized SVG onto the canvas in the same z-order
 * the engine would have drawn them. Called by `runPipeline` after the
 * frozen `render()` has finished its work.
 */
export function compositePreRasteredOnto(
  canvas: Canvas,
  preRastered: Map<number, PreRasteredEntry>,
): void {
  // Insertion order in the Map matches element index order, which
  // matches z-order — Maps in JS preserve insertion order per spec.
  for (const entry of preRastered.values()) {
    if (!entry.props.visible) continue;
    compositePreRasteredSvg(canvas, entry);
  }
}
