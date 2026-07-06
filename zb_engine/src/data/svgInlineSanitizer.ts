/**
 * svgInlineSanitizer.ts — Pre-render SVG sanitization outside the frozen engine
 *
 * Problem
 * ───────
 * The frozen engine's `sanitizeSvg` (`src/engine/primitives/svg.ts`) is a
 * regex blocklist with two catastrophic O(n²) backtracking cases: the
 * `<image href>` regex on `<image` + a long whitespace run with no `href`,
 * and the `on*`-handler regex on ANY long whitespace run. Either freezes the
 * single Node event loop for seconds-to-minutes on adversarial input. The
 * same regex also lets through `<use>`/`<feImage>` external hrefs, unquoted
 * `<image href=...>`, and DOCTYPE/ENTITY constructs.
 *
 * That file is FROZEN (Engineering constraint §1) and cannot be edited. A
 * parser-based, linear-time, allow-list sanitizer already exists
 * (`sanitizeSvgForRasterization` in `svgSanitization.ts`) and is applied by
 * the out-of-engine pre-rasterizers, but those passes only cover a subset of
 * SVGs (large, non-stroked, out-of-canvas-rotated, inline-only). Small
 * (<50 KB), stroked, in-canvas-rotated, and URL-fetched SVGs skip every
 * pre-pass and reach the frozen regex with attacker-controlled raw bytes.
 *
 * Strategy
 * ────────
 * This pass runs BEFORE the element list reaches the engine so the frozen
 * regex `sanitizeSvg` only ever receives already-parser-sanitized AND
 * whitespace-run-capped bytes for statically-resolvable SVG content. For each
 * `svg` element:
 *
 *   1. A literal inline `svg` string is run through
 *      `sanitizeSvgForRasterization` (parser-based allow-list) and then
 *      `collapseWhitespaceRuns` (linear whitespace-run cap).
 *   2. An empty `svg` with a literal http(s) `src` is fetched out-of-engine
 *      via the existing SSRF-guarded `fetchTextWithLimit`, sanitized +
 *      collapsed, inlined onto `svg`, and its `src` cleared so the frozen
 *      `drawSvg` fetch path is never reached.
 *
 * The whitespace-run cap is REQUIRED in addition to the parser sanitizer:
 * `sanitizeSvgForRasterization` is configured with `trimValues:false` and so
 * PRESERVES arbitrarily long whitespace runs (intentional, for glyph
 * spacing). Those runs would still drive the frozen engine's on-handler and
 * `<image>` regexes into super-linear backtracking, so the cap lives here as
 * a local linear-time transform — NOT in the frozen engine and NOT in
 * `sanitizeSvgForRasterization` (which stays unchanged).
 *
 * Residual: binding-expression (non-string) `svg`/`src` values are left
 * untouched — they resolve inside the frozen `resolveElement` and cannot be
 * pre-sanitized at this seam. This module does NOT modify any code under
 * `src/engine/`.
 *
 * This follows the same "pre-render pass outside the frozen engine" pattern
 * as `svgPreprocessor`, `svgPreRasterizer`, and `userAssets`, and is invoked
 * from `renderService.preparePipeline`.
 */

import { sanitizeSvgForRasterization } from "./svgSanitization";
import {
  fetchTextWithLimit,
  MAX_SVG_FETCH_BYTES,
  IMAGE_FETCH_TIMEOUT_MS,
} from "../engine/primitives/assetLimits";

/**
 * Maximum group nesting depth for recursion. Mirrors `MAX_GROUP_DEPTH` in
 * `svgPreprocessor.ts` / `elementResolver.ts` so this pass and the resolver
 * agree on which children will actually be rendered.
 */
const MAX_GROUP_DEPTH = 10;

/**
 * Upper bound on the length of any whitespace run left in a sanitized SVG.
 * Legitimate SVG never contains hundreds of consecutive whitespace
 * characters (path `d`/`points`, gradients, text, and CSS all use single
 * separators), so collapsing longer runs is lossless for real content while
 * denying the frozen engine's regex sanitizer any input long enough to
 * backtrack super-linearly.
 */
const MAX_SVG_WHITESPACE_RUN = 256;

/**
 * Regex matching a whitespace run one longer than the cap. A single
 * bounded-min quantifier over a character class — linear, no backtracking.
 * The literal `257` is `MAX_SVG_WHITESPACE_RUN + 1`.
 */
const LONG_WHITESPACE_RUN_RE = /\s{257,}/g;

/**
 * Collapse every whitespace run longer than `MAX_SVG_WHITESPACE_RUN` to
 * exactly that many spaces. Linear time (no catastrophic backtracking), so
 * it is safe to run on adversarial input. `sanitizeSvgForRasterization`
 * preserves arbitrarily long runs (`trimValues:false`); this guarantees the
 * frozen engine never receives one long enough to trigger its ReDoS.
 *
 * Exported so the other out-of-engine paths that hand `sanitizeSvgForRasterization`
 * output toward the frozen engine — the `asset:` re-inline in `userAssets.ts`
 * and the upload seam in `ha/haAssets.ts` — apply the identical cap from a
 * single source of truth.
 */
export function collapseWhitespaceRuns(svg: string): string {
  return svg.replace(LONG_WHITESPACE_RUN_RE, " ".repeat(MAX_SVG_WHITESPACE_RUN));
}

/** True if a string is a literal http(s) URL (after trimming). */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * True when an `svg` value carries a runtime binding/expression that resolves
 * INSIDE the frozen engine — a binding/expression object (`{"$":...}`,
 * `{"concat":[...]}`) or a string template containing `{{`. These are the
 * documented residual and are left untouched here.
 *
 * Everything else that is not a non-empty inline string — `""`, `null`, `[]`,
 * numbers — is treated as "no inline content": the frozen `resolveSvg` coerces
 * it to `""` and then falls through to the `src` fetch fallback, so a literal
 * http(s) `src` MUST be pre-fetched/inlined here or it reaches the frozen regex
 * sanitizer with raw bytes. Gating branch (2) on this (instead of
 * `svg === ""`) closes the `svg: null`/`[]` + http `src` sanitizer bypass.
 */
function isDeferredSvgBinding(svg: unknown): boolean {
  if (typeof svg === "string") return svg.includes("{{");
  return typeof svg === "object" && svg !== null && !Array.isArray(svg);
}

/**
 * Sanitize a single element. SVG-type elements with a literal string `svg`
 * (or an http(s) `src` to fetch and inline — including when `svg` is empty or a
 * static non-string like `null`/`[]`) come back with parser-sanitized,
 * whitespace-capped bytes; every other element — including binding-expression
 * `svg`, `asset:`/`data:` `src`, and non-SVG elements — is returned by
 * reference, unchanged.
 */
async function sanitizeElement(
  el: Record<string, unknown>,
  depth: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (el.type === "group" && Array.isArray(el.children)) {
    const children = el.children as Record<string, unknown>[];
    const sanitizedChildren = await sanitizeElementsInternal(children, depth + 1, signal);
    // Preserve referential equality when no descendant changed.
    return sanitizedChildren === children ? el : { ...el, children: sanitizedChildren };
  }

  if (el.type !== "svg") return el;

  // (1) Literal inline SVG content — parser-sanitize then whitespace-cap.
  // `sanitizeSvgForRasterization` already enforces MAX_INLINE_SVG_BYTES and
  // returns "" for unusable input; keep that "" (draw nothing) rather than
  // restoring the original unsanitized bytes.
  //
  // Also clear `src`: a non-empty inline `svg` means the frozen `drawSvg` uses
  // it and never reads `src`. But if sanitization blanks `svg` to "" (no usable
  // <svg> root, or over the size cap), `drawSvg`'s `if (!svgContent &&
  // props.src)` fallback would fetch the RAW `src` bytes and run them through
  // the frozen regex — reopening the exact ReDoS / external-ref bypass this
  // pass closes. Clearing `src` is behaviour-preserving for valid inline SVGs
  // and fail-safe (draw nothing) for unsanitizable ones.
  if (typeof el.svg === "string" && el.svg.length > 0) {
    return {
      ...el,
      svg: collapseWhitespaceRuns(sanitizeSvgForRasterization(el.svg)),
      src: "",
    };
  }

  // (2) No usable inline SVG string (empty `""`, OR a static non-string such as
  // `null`/`[]` that the frozen `resolveSvg` coerces to "" before its `src`
  // fetch fallback) with a literal http(s) `src` — fetch out-of-engine through
  // the existing SSRF/redirect/size-guarded helper, sanitize + collapse, inline
  // onto `svg`, and clear `src` so the frozen `drawSvg` never performs the
  // fetch. Any failure blanks both fields. Binding/expression `svg` is excluded
  // by `isDeferredSvgBinding` (documented residual — resolves in the engine).
  if (
    !isDeferredSvgBinding(el.svg) &&
    typeof el.src === "string" &&
    isHttpUrl(el.src)
  ) {
    try {
      const text = await fetchTextWithLimit(
        el.src.trim(),
        "SVG source",
        MAX_SVG_FETCH_BYTES,
        IMAGE_FETCH_TIMEOUT_MS,
      );
      const safe = collapseWhitespaceRuns(sanitizeSvgForRasterization(text));
      return { ...el, svg: safe, src: "" };
    } catch {
      return { ...el, svg: "", src: "" };
    }
  }

  // (3) Binding-expression `svg` (resolved inside the frozen engine), or any
  // `src` that is not a literal http(s) URL — an `asset:` token or a `data:`
  // URI (a `data:`/`file:` `src` is separately rejected by the engine's own
  // SSRF URL validator before it can reach the regex). Leave untouched
  // (documented residual).
  return el;
}

/**
 * Recursively sanitize an element array, mirroring the copy-on-write shape of
 * `svgPreprocessor.normalizeSvgElementsInternal`: the original array is
 * returned by reference when nothing changed; otherwise a new array is
 * returned with unchanged elements keeping their original reference.
 */
async function sanitizeElementsInternal(
  elements: Record<string, unknown>[],
  depth: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  // The frozen engine renders group children — INCLUDING svg leaves — down to
  // nesting depth MAX_GROUP_DEPTH: `resolveGroup` throws only at
  // `depth >= MAX_GROUP_DEPTH`, so a group at depth MAX_GROUP_DEPTH-1 still
  // resolves its children at depth MAX_GROUP_DEPTH, and `resolveSvg` has no
  // depth guard. A security pass must therefore sanitize one level DEEPER than
  // the cosmetic `svgPreprocessor` size-normalizer: a leaf the normalizer skips
  // still renders correctly, but a leaf THIS pass skips would hand raw bytes to
  // the frozen regex sanitizer. So bail only once PAST the deepest renderable
  // leaf. (Payload nesting is already capped at MAX_ELEMENT_NESTING_DEPTH by
  // Zod validation, so this cannot recurse unboundedly.)
  if (depth > MAX_GROUP_DEPTH) return elements;

  const out: Record<string, unknown>[] = new Array(elements.length);
  let changed = false;
  for (let i = 0; i < elements.length; i++) {
    // Honour the per-render AbortSignal cooperatively, like the other
    // pre-render passes (svgPreRasterizer / rotatedSvgRasterizer).
    if (signal?.aborted) throw new Error("RENDER_ABORTED");
    const el = elements[i];
    const next = await sanitizeElement(el, depth, signal);
    if (next !== el) changed = true;
    out[i] = next;
  }
  return changed ? out : elements;
}

/**
 * Sanitize every statically-resolvable SVG in the element list so the frozen
 * engine's regex sanitizer only ever receives parser-sanitized,
 * whitespace-capped bytes. Recurses into `group` children up to
 * `MAX_GROUP_DEPTH`.
 *
 * Called from `renderService.preparePipeline` after source fetching and
 * before `normalizeSvgElements`, so its output feeds every downstream
 * pre-render pass and ultimately `render()`.
 *
 * @param elements  Validated element records from the payload.
 * @param signal    Optional per-render AbortSignal (render timeout).
 * @returns A new array; unchanged elements share their original reference.
 */
export async function sanitizeSvgElementsForEngine(
  elements: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  return sanitizeElementsInternal(elements, 0, signal);
}
