/**
 * svgPreprocessor.ts — Normalize SVG intrinsic dimensions before rendering
 *
 * Problem
 * ───────
 * The frozen draw engine rasterizes inline SVGs with sharp/librsvg under a
 * 300 ms timeout (SVG_RASTER_TIMEOUT_MS in primitives/assetLimits.ts). When a
 * rasterization throws — most commonly because librsvg is forced to allocate a
 * huge intermediate pixel buffer for a vector export with `width="2531"
 * height="1989"` — the engine catches the error and silently skips that
 * element. The user sees the SVG correctly in the Konva builder canvas
 * (the browser handles SVG natively at any size) but blank in /preview and
 * the deployed image.
 *
 * Additionally, sharp's `.resize(w, h, { fit: "contain" })` letterboxes the
 * SVG to preserve its aspect ratio, while the Konva preview always stretches
 * the loaded bitmap anisotropically to the element's `sizeX × sizeY`. This
 * causes a WYSIWYG mismatch even when rasterization succeeds.
 *
 * Strategy
 * ────────
 * For every inline SVG, before the payload reaches the engine, rewrite the
 * root `<svg>` tag so that:
 *
 *   1. A `viewBox` is present — preserves the original coordinate system so
 *      child shapes remain in the correct positions after resizing.
 *   2. `width` / `height` equal the element's display size (sizeX × sizeY) —
 *      librsvg rasterizes at the target size directly, no costly large
 *      intermediate buffer.
 *   3. `preserveAspectRatio="none"` — librsvg fills the entire viewport with
 *      an anisotropic stretch, matching the Konva canvas preview exactly.
 *
 * The result is a SVG that rasterizes well under the timeout and produces an
 * output identical to what the builder UI shows.
 *
 * This module follows the same pre-render pattern as `expandTextBounds` and
 * `expandGraphElements` and is invoked from `renderService.preparePipeline`.
 * It does NOT modify any code under `src/engine/`.
 */

/**
 * Maximum group nesting depth for recursive SVG normalization. Mirrors
 * `MAX_GROUP_DEPTH` in `engine/elementResolver.ts` so the preprocessor and
 * the resolver agree on which children will actually be rendered.
 */
const MAX_GROUP_DEPTH = 10;

/**
 * Parse a length attribute value (e.g. `"160"`, `"160px"`, `"160.5"`).
 *
 * Accepts unitless numbers and `px` values only; rejects percentages and
 * other CSS units. Returning `null` lets the caller fall back to a more
 * reliable source for the dimension (viewBox, then target size).
 */
function parseLengthAttribute(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  // Strict numeric form, optional `px` suffix. No %, em, etc.
  const match = trimmed.match(/^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)(?:px)?$/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse the four numeric components of a `viewBox` attribute value.
 * Returns `null` if any component is missing or non-finite, or if either
 * the width or height component is non-positive.
 */
function parseViewBox(rawValue: string): { w: number; h: number } | null {
  const parts = rawValue.trim().split(/[\s,]+/).map(parseFloat);
  if (parts.length !== 4) return null;
  if (!parts.every((p) => Number.isFinite(p))) return null;
  const [, , w, h] = parts;
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

/**
 * Replace a quoted attribute value, or insert the attribute immediately
 * after `<svg` when it is not present.
 *
 * Both single- and double-quoted values are recognised; the rewritten form
 * always uses double quotes for consistency.
 */
function setSvgAttribute(svgTag: string, name: string, value: string): string {
  // Negative lookbehind prevents matching e.g. `data-width` when name=`width`.
  // A word-boundary `\b` is insufficient because `-` is a non-word character,
  // so `\bwidth` would match after the hyphen in `data-width`.
  const re = new RegExp(`(?<![-\\w])${name}\\s*=\\s*(["'])[^"']*\\1`, "i");
  if (re.test(svgTag)) {
    return svgTag.replace(re, `${name}="${value}"`);
  }
  // Insert immediately after `<svg` (preserves any existing whitespace and
  // attribute ordering of the original tag).
  return svgTag.replace(/<svg\b/i, `<svg ${name}="${value}"`);
}

/**
 * Normalize the root `<svg>` tag of an inline SVG so that librsvg
 * rasterizes at the target display size with an anisotropic fill.
 *
 * The function is a pure string transform — it does not parse the SVG body.
 * The `<svg ...>` opening tag is identified by a literal `<svg` lookup
 * followed by the next `>`; this is safe because SVG (an XML dialect)
 * requires `>` inside attribute values to be escaped as `&gt;`.
 *
 * @param svgContent  Raw SVG markup (may include an XML declaration / DOCTYPE).
 * @param targetW     Target render width in pixels (element `sizeX`).
 * @param targetH     Target render height in pixels (element `sizeY`).
 * @returns The rewritten SVG string, or the original if nothing could be parsed.
 */
export function normalizeSvgDimensions(
  svgContent: string,
  targetW: number,
  targetH: number,
): string {
  if (!svgContent || !(targetW > 0) || !(targetH > 0)) return svgContent;

  const svgTagStart = svgContent.indexOf("<svg");
  if (svgTagStart === -1) return svgContent;
  const openEnd = svgContent.indexOf(">", svgTagStart);
  if (openEnd === -1) return svgContent;

  const originalTag = svgContent.slice(svgTagStart, openEnd + 1);
  let newTag = originalTag;

  // ── Step 1: ensure a usable viewBox exists ──
  // Priority for deriving the viewBox dimensions:
  //   1. Existing valid `viewBox` attribute (authoritative — leave alone).
  //   2. Explicit `width`/`height` attributes (typical of vector exports
  //      authored at a fixed pixel size).
  //   3. Target render size (last-resort sentinel; avoids producing an
  //      invalid viewBox if the SVG provides no intrinsic sizing at all).
  const viewBoxMatch = newTag.match(/(?<![-\w])viewBox\s*=\s*(["'])([^"']+)\1/i);
  const widthMatch = newTag.match(/(?<![-\w])width\s*=\s*(["'])([^"']+)\1/i);
  const heightMatch = newTag.match(/(?<![-\w])height\s*=\s*(["'])([^"']+)\1/i);
  const intrinsicW = widthMatch ? parseLengthAttribute(widthMatch[2]) : null;
  const intrinsicH = heightMatch ? parseLengthAttribute(heightMatch[2]) : null;

  if (!viewBoxMatch) {
    const vbW = intrinsicW ?? targetW;
    const vbH = intrinsicH ?? targetH;
    newTag = newTag.replace(/<svg\b/i, `<svg viewBox="0 0 ${vbW} ${vbH}"`);
  } else if (!parseViewBox(viewBoxMatch[2])) {
    // Existing viewBox is malformed — replace with a derived one.
    const vbW = intrinsicW ?? targetW;
    const vbH = intrinsicH ?? targetH;
    newTag = newTag.replace(
      /(?<![-\w])viewBox\s*=\s*(["'])[^"']*\1/i,
      `viewBox="0 0 ${vbW} ${vbH}"`,
    );
  }

  // ── Step 2: force width/height to the element's display size ──
  // librsvg now rasterizes directly at the target pixel size, avoiding the
  // timeout-prone "rasterize huge then downscale" path inside sharp.
  newTag = setSvgAttribute(newTag, "width", String(targetW));
  newTag = setSvgAttribute(newTag, "height", String(targetH));

  // ── Step 3: force preserveAspectRatio="none" ──
  // The Konva builder preview always stretches the rasterized SVG to the
  // element bounds anisotropically (via `<KonvaImage width={w} height={h}>`
  // → `ctx.drawImage(img, 0, 0, w, h)`). To keep WYSIWYG parity, the engine
  // must do the same instead of letterboxing with `xMidYMid meet`.
  newTag = setSvgAttribute(newTag, "preserveAspectRatio", "none");

  if (newTag === originalTag) return svgContent;
  return svgContent.slice(0, svgTagStart) + newTag + svgContent.slice(openEnd + 1);
}

/**
 * Normalize a single element record. Returns the original reference when no
 * change is needed; otherwise returns a shallow copy with the rewritten SVG.
 *
 * Skips elements whose `svg` is not a literal string (e.g. binding
 * expression objects) — those are resolved inside the engine and are out of
 * scope for static rewriting.
 */
function normalizeSvgElement(
  el: Record<string, unknown>,
): Record<string, unknown> {
  if (
    el.type !== "svg" ||
    typeof el.svg !== "string" ||
    el.svg.length === 0 ||
    typeof el.sizeX !== "number" ||
    typeof el.sizeY !== "number" ||
    !(el.sizeX > 0) ||
    !(el.sizeY > 0)
  ) {
    return el;
  }

  const normalized = normalizeSvgDimensions(
    el.svg,
    Math.round(el.sizeX),
    Math.round(el.sizeY),
  );

  if (normalized === el.svg) return el;
  return { ...el, svg: normalized };
}

/**
 * Apply SVG dimension normalization to every SVG-type element in the array,
 * recursing into `group` children up to `MAX_GROUP_DEPTH`.
 *
 * Called from `renderService.preparePipeline` after Zod validation and
 * before `expandGraphElements`, mirroring the position of `expandTextBounds`
 * in the pre-render pipeline.
 *
 * @param elements  Validated element records from the payload.
 * @returns A new array; unchanged elements share their original reference.
 */
export function normalizeSvgElements(
  elements: Record<string, unknown>[],
): Record<string, unknown>[] {
  return normalizeSvgElementsInternal(elements, 0);
}

function normalizeSvgElementsInternal(
  elements: Record<string, unknown>[],
  depth: number,
): Record<string, unknown>[] {
  // Stop recursing past the engine's group depth limit — anything deeper
  // would be rejected by `resolveGroup` anyway.
  if (depth >= MAX_GROUP_DEPTH) return elements;

  return elements.map((el) => {
    if (el.type === "group" && Array.isArray(el.children)) {
      const children = el.children as Record<string, unknown>[];
      const normalizedChildren = normalizeSvgElementsInternal(children, depth + 1);
      // Preserve referential equality if no descendant changed.
      const changed = normalizedChildren.some((child, i) => child !== children[i]);
      return changed ? { ...el, children: normalizedChildren } : el;
    }
    return normalizeSvgElement(el);
  });
}
