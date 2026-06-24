/**
 * userAssets.ts — Pre-render resolver for user-uploaded asset references
 *
 * Elements with a `src` field set to `asset:<uuid>.<ext>` reference a
 * file uploaded to the platform's persistent asset store (HA: `/data/assets`).
 * The frozen draw engine cannot interpret this scheme — it would either
 * fail SSRF validation or 404 on a `new URL()` parse — so we intercept
 * the token in a pre-render pass, exactly mirroring the pattern used by
 * `svgPreRasterizer.ts` and `svgPreprocessor.ts` (see ENGINEERING_CONSTRAINTS §1
 * — engine is frozen, all per-element work happens upstream).
 *
 * Per-element behaviour:
 *
 *   • `img` element with `src: "asset:<uuid>.png|jpg|jpeg|webp"`:
 *       Read bytes via `storage.readAsset()`, decode with sharp at the
 *       element's resolved size, store the resulting grayscale bitmap in
 *       a Map keyed by element index, and clear `el.src` so the engine's
 *       `drawImg` early-returns silently. The bitmap is composited onto
 *       the canvas after `render()` returns, byte-equivalent to the
 *       engine's own threshold/dither + opacity write loop.
 *
 *   • `svg` element with `src: "asset:<uuid>.svg"`:
 *       Read bytes, sanitize via `sanitizeSvgForRasterization` (defense in
 *       depth — assets are sanitized at upload time, but a future bug or
 *       direct disk write must not be able to slip a `<script>` past us),
 *       and rewrite the element to inline-SVG form (`el.svg = sanitized`,
 *       `el.src = ""`). The downstream `preRasterizeLargeSvgs` pass — or
 *       the engine itself, for SVGs under its 50 KB threshold — handles
 *       the rasterize + composite step. This avoids duplicating the
 *       fill / stroke / transform compositor that already exists in
 *       `svgPreRasterizer.ts`.
 *
 *   • Any failure (missing file, traversal attempt, decode error,
 *     pixel-budget overflow): clear `el.src` so the engine early-returns,
 *     push a generic message into `errors[]` (no path / IP / stack
 *     details per ENGINEERING_CONSTRAINTS §14).
 */

import sharp from "sharp";
import type { Canvas } from "../engine/canvas";
import { shouldDitherPixel, setWithOpacity } from "../engine/dither";
import { resolveElement } from "../engine/elementResolver";
import type { ImgProps } from "../engine/types";
import type { DataContext } from "@zb/expressions";
import { sanitizeSvgForRasterization } from "./svgSanitization";
import { MAX_RASTER_AXIS, MAX_RASTER_PIXELS } from "./rasterLimits";
import { MAX_USER_SVG_BYTES } from "../limits";

/**
 * The minimal storage surface the resolver needs. Declared here (rather
 * than re-importing the full `StorageAdapter`) so the resolver can be
 * reused on platforms whose storage layer happens to expose only the
 * read side of the asset API.
 */
export interface AssetReader {
  readAsset?(filename: string): Promise<Buffer>;
}

/** Recognises payload `src` values that reference a user-uploaded asset. */
const ASSET_TOKEN_RE = /^asset:([a-f0-9-]+\.(?:svg|png|jpe?g|webp))$/;

/**
 * Defense-in-depth filename validator. Mirrors the regex enforced by the
 * HA storage adapter and the asset routes; any mismatch here means the
 * payload smuggled in a token shape that the storage layer would reject
 * anyway, so we refuse it without touching disk.
 */
const ASSET_FILENAME_RE = /^[a-f0-9-]+\.(svg|png|jpe?g|webp)$/;

/** A pre-decoded raster asset ready to be composited onto the canvas. */
interface PreLoadedRaster {
  /** Resolved element props — pos / size / opacity / bwMode / bwLevel. */
  readonly props: ImgProps;
  /** Raw grayscale bytes; `pixels.length === width * height`. */
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Result of the asset pre-pass. */
export interface UserAssetResolveResult {
  /**
   * Element list with `asset:` references rewritten:
   *   - raster `img` elements have `src` cleared (composited later)
   *   - `svg` elements have `svg` set and `src` cleared (handled by the
   *     SVG pre-rasterizer or the engine's normal SVG path)
   * Elements that don't reference an asset are returned by reference.
   */
  readonly elements: Record<string, unknown>[];

  /** Raster bitmaps keyed by element index, composited after render(). */
  readonly preLoaded: Map<number, PreLoadedRaster>;

  /** One generic message per element that failed to resolve. */
  readonly errors: string[];
}

// ── Per-render decode cache ───────────────────────────────────

/**
 * Within a single render, multiple elements may reference the same asset
 * at the same target size (e.g. a status icon repeated across a layout).
 * A small per-call cache keyed by `(filename, w, h)` collapses those into
 * one decode. The cache is local to each `resolveUserAssets()` invocation
 * — there is intentionally no cross-render cache here. Cross-render
 * caching for large SVGs is already handled by `svgPreRasterizer.ts`
 * (post-sanitization, content-hash keyed) which sees the SVG bytes after
 * we hand them off.
 */
type RasterCacheKey = string;
function rasterKey(filename: string, w: number, h: number): RasterCacheKey {
  return `${filename}|${w}x${h}`;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Walk the element list, resolve every `asset:<uuid>.<ext>` token, and
 * return a new element list with the references rewritten so the engine
 * never sees the custom scheme.
 *
 * @param elements   The element list as produced by `normalizeSvgElements`
 *                   (i.e. SVG `width=`/`height=` already injected).
 * @param ctx        Data context for binding resolution.
 * @param storage    Storage adapter exposing `readAsset()`. If the adapter
 *                   does not implement asset reads, the pass is a no-op:
 *                   `asset:` tokens fall through to the engine which will
 *                   fail them with its standard URL-validation error.
 */
export async function resolveUserAssets(
  elements: Record<string, unknown>[],
  ctx: DataContext,
  storage: AssetReader,
): Promise<UserAssetResolveResult> {
  // Fast exit — non-HA platforms with no asset storage skip the loop.
  if (typeof storage.readAsset !== "function") {
    return { elements, preLoaded: new Map(), errors: [] };
  }

  const out = elements.slice();
  const preLoaded = new Map<number, PreLoadedRaster>();
  const errors: string[] = [];
  const rasterCache = new Map<RasterCacheKey, { pixels: Buffer; width: number; height: number }>();

  for (let i = 0; i < out.length; i++) {
    const raw = out[i];
    if (!raw || (raw.type !== "img" && raw.type !== "svg")) continue;

    const src = typeof raw.src === "string" ? raw.src : "";
    const match = ASSET_TOKEN_RE.exec(src);
    if (!match) continue;
    const filename = match[1];

    // Defense in depth — refuse anything that wouldn't survive the
    // storage adapter's own filename check (cheaper than a disk hit).
    if (!ASSET_FILENAME_RE.test(filename)) {
      errors.push(`Element #${i}: invalid asset reference.`);
      out[i] = { ...raw, src: "" };
      continue;
    }

    // Read once; let the storage adapter enforce traversal / symlink rules.
    let bytes: Buffer;
    try {
      bytes = await storage.readAsset(filename);
    } catch {
      errors.push(`Element #${i}: asset not available.`);
      out[i] = { ...raw, src: "" };
      continue;
    }

    if (filename.endsWith(".svg")) {
      // Re-enforce the per-file SVG ceiling — uploads cap this, but the
      // file on disk is the ground truth at render time and may have
      // grown via a future direct-write code path we don't yet have.
      if (bytes.length > MAX_USER_SVG_BYTES) {
        errors.push(`Element #${i}: SVG asset exceeds size limit.`);
        out[i] = { ...raw, src: "", svg: "" };
        continue;
      }
      let text: string;
      try {
        text = bytes.toString("utf-8");
      } catch {
        errors.push(`Element #${i}: SVG asset is not valid UTF-8.`);
        out[i] = { ...raw, src: "", svg: "" };
        continue;
      }
      const sanitized = sanitizeSvgForRasterization(text);
      if (!/<svg[\s>]/i.test(sanitized)) {
        errors.push(`Element #${i}: SVG asset has no <svg> root.`);
        out[i] = { ...raw, src: "", svg: "" };
        continue;
      }
      // Rewrite to inline form. Downstream svgPreRasterizer (>= 50 KB)
      // or the engine's own drawSvg (< 50 KB) takes it from here.
      out[i] = { ...raw, src: "", svg: sanitized };
      continue;
    }

    // Raster path — decode now, composite after render().
    let resolved: ImgProps;
    try {
      const r = resolveElement(raw, ctx);
      if (r.type !== "img") {
        // Element type mismatch (e.g. binding flipped it) — let the
        // engine handle the resulting empty src gracefully.
        out[i] = { ...raw, src: "" };
        continue;
      }
      resolved = r;
    } catch {
      errors.push(`Element #${i}: asset element bindings failed.`);
      out[i] = { ...raw, src: "" };
      continue;
    }

    if (resolved.sizeX <= 0 || resolved.sizeY <= 0) {
      out[i] = { ...raw, src: "" };
      continue;
    }

    const targetW = Math.min(Math.round(resolved.sizeX), MAX_RASTER_AXIS);
    const targetH = Math.min(Math.round(resolved.sizeY), MAX_RASTER_AXIS);
    if (targetW * targetH > MAX_RASTER_PIXELS) {
      errors.push(`Element #${i}: asset exceeds pixel budget.`);
      out[i] = { ...raw, src: "" };
      continue;
    }

    const cacheKey = rasterKey(filename, targetW, targetH);
    let bitmap = rasterCache.get(cacheKey);
    if (!bitmap) {
      try {
        const { data, info } = await sharp(bytes, { failOn: "error" })
          .rotate() // honour EXIF then strip metadata
          .resize(targetW, targetH, {
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .grayscale()
          .raw()
          .toBuffer({ resolveWithObject: true });
        bitmap = { pixels: data, width: info.width, height: info.height };
        rasterCache.set(cacheKey, bitmap);
      } catch {
        errors.push(`Element #${i}: asset decode failed.`);
        out[i] = { ...raw, src: "" };
        continue;
      }
    }

    // Clear src so the frozen drawImg early-returns at its
    // `if (!src ...) return` guard. All other props (pos/size/opacity)
    // remain so the resolved element keeps its z-order slot.
    out[i] = { ...raw, src: "" };
    preLoaded.set(i, {
      props: resolved,
      pixels: bitmap.pixels,
      width: bitmap.width,
      height: bitmap.height,
    });
  }

  return { elements: out, preLoaded, errors };
}

// ── Compositor ────────────────────────────────────────────────

/**
 * Write a pre-decoded raster asset onto the engine's 1-bit canvas using
 * the engine's exact threshold / dither + opacity helpers. Mirrors
 * `drawImg` in `src/engine/primitives/img.ts` byte-for-byte so the
 * visual output is identical to what the engine would produce if the
 * `src` URL had been resolvable.
 */
function compositePreLoadedRaster(canvas: Canvas, entry: PreLoadedRaster): void {
  const { props, pixels, width: rasterW, height: rasterH } = entry;
  const w = Math.round(props.sizeX);
  const h = Math.round(props.sizeY);
  const x0 = Math.round(props.pos.x);
  const y0 = Math.round(props.pos.y);
  const threshold = Math.round((props.bwLevel / 100) * 255);

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
}

/**
 * Composite every pre-loaded raster asset onto the canvas in element
 * (z) order — Map iteration is insertion order per spec. Called by
 * `renderService.runPipeline` after `render()` finishes.
 */
export function compositeUserAssetsOnto(
  canvas: Canvas,
  preLoaded: Map<number, PreLoadedRaster>,
): void {
  for (const entry of preLoaded.values()) {
    if (!entry.props.visible) continue;
    compositePreLoadedRaster(canvas, entry);
  }
}
