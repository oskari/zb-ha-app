/**
 * svgSanitization.ts — SVG input sanitizer for out-of-engine code paths
 *
 * The frozen engine has its own private `sanitizeSvg` inside
 * `src/engine/primitives/svg.ts` (see Engineering constraint §1 — that file MUST NOT be
 * modified or re-exported from). Any pre-render pass that hands SVG content
 * to a rasterizer outside the engine MUST run an equivalent sanitization
 * step itself, otherwise the engine's protections (XSS strip, external
 * `<image href>` removal, event-handler removal) are bypassed.
 *
 * This module is the canonical sanitizer for those out-of-engine paths
 * (`svgPreRasterizer.ts`, `rotatedSvgRasterizer.ts`, `userAssets.ts`, and
 * the user-asset upload route). It MUST stay at least as strict as the
 * engine's copy.
 *
 * Design — parser-based allowlist (NOT a regex blocklist)
 * ───────────────────────────────────────────────────────
 * The previous implementation was a sequence of regular expressions. That
 * approach had two structural problems:
 *
 *   1. ReDoS — overlapping quantifiers (e.g. `<image\b[^>]*?\s+...href`)
 *      backtrack super-linearly on adversarial input, freezing the single
 *      Node event loop and DoS-ing both ports.
 *   2. Blocklist bypasses — a deny-list can never be complete. Unterminated
 *      `<script`, unquoted `<image href=...>`, SMIL/`<use>` `javascript:`
 *      URLs, and comment-smuggled markup all survived.
 *
 * This implementation parses the SVG with `fast-xml-parser` (linear time —
 * no catastrophic backtracking), walks the tree keeping only an explicit
 * allow-list of SVG drawing elements, strips dangerous attributes
 * (`on*` handlers, unsafe `href`/`xlink:href`), and re-serialises. Anything
 * not on the allow-list — `<script>`, `<foreignObject>`, `<iframe>`, SMIL
 * animation, processing instructions, DOCTYPE, comments — is dropped by
 * construction rather than matched-and-removed.
 *
 * Entity processing is disabled on both parse and build (`processEntities:
 * false`) so XXE / billion-laughs constructs cannot expand (Engineering constraint §8);
 * the downstream rasterizer (sharp/librsvg) independently refuses external
 * resource loads as a second layer.
 */

import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { MAX_INLINE_SVG_BYTES } from "../engine/primitives/assetLimits";

/**
 * Allow-listed SVG element names (compared case-insensitively). Covers the
 * static drawing, structural, gradient, clipping, masking, and filter
 * vocabulary. Deliberately EXCLUDES:
 *   - `script`, `foreignObject`, `iframe` — script / HTML injection.
 *   - SMIL animation (`animate`, `set`, `animateTransform`, `animateMotion`,
 *     `mpath`) — a known `javascript:`/attribute-injection vector that
 *     contributes nothing to a single static raster frame.
 * Any element not in this set (and its entire subtree) is dropped.
 */
const ALLOWED_ELEMENTS = new Set<string>([
  // Root / structural
  "svg", "g", "defs", "symbol", "use", "switch", "a", "view",
  "title", "desc", "metadata", "style",
  // Shapes
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  // Text
  "text", "tspan", "textpath", "tref",
  // Raster
  "image",
  // Paint servers
  "lineargradient", "radialgradient", "stop", "pattern",
  // Clipping / masking / markers
  "clippath", "mask", "marker",
  // Filters + primitives
  "filter", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite",
  "feconvolvematrix", "fediffuselighting", "fedisplacementmap", "fedistantlight",
  "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr",
  "fegaussianblur", "feimage", "femerge", "femergenode", "femorphology",
  "feoffset", "fepointlight", "fespecularlighting", "fespotlight", "fetile",
  "feturbulence",
]);

/**
 * Elements whose `href`/`xlink:href` may load or clone external bytes.
 * For these, only a same-document fragment reference (`#id`) is permitted;
 * every other form (`http(s)://`, `file://`, `data:`, bare path) is dropped
 * — matching the frozen engine's behaviour for `<image>`.
 */
const FRAGMENT_ONLY_HREF_ELEMENTS = new Set<string>(["image", "feimage", "use"]);

/**
 * Dangerous URL schemes stripped from `href`/`xlink:href` on elements that
 * are allowed to carry a general link (e.g. `<a>`). Matched after stripping
 * whitespace / control characters so `java\tscript:` obfuscation is caught.
 */
const DANGEROUS_HREF_SCHEMES = ["javascript:", "data:", "vbscript:"];

/**
 * Matches runs of ASCII control characters and spaces (0x00-0x20), used to
 * strip whitespace/control-char obfuscation before scheme detection. Built
 * via `RegExp` so no literal control bytes appear in the source.
 */
const CONTROL_OR_SPACE_RE = new RegExp("[\\u0000-\\u0020]+", "g");

const ATTR_PREFIX = "@_";
const TEXT_KEY = "#text";
const CDATA_KEY = "#cdata";
const ATTRS_KEY = ":@";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  // Security: never expand XML entities (XXE / billion-laughs). Engineering constraint §8.
  // With entities un-decoded, a `#text` node can never carry a raw `<`, so the
  // (non-escaping) builder cannot re-materialise markup from text content.
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: true,
  // Keep text exactly as authored so glyph spacing etc. is preserved.
  trimValues: false,
  // Capture CDATA as its own node so it round-trips as inert `<![CDATA[...]]>`
  // character data. WITHOUT this, fast-xml-parser unwraps CDATA into a plain
  // text node and the builder re-emits it raw — turning
  // `<style><![CDATA[<script>…]]></style>` back into a live `<script>` element
  // (a sanitizer bypass). Keeping it wrapped preserves legitimate `<style>`
  // CSS while leaving any embedded markup as non-executable character data.
  cdataPropName: CDATA_KEY,
  // Comments are dropped (the default) — no `commentPropName` is set.
});

const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  suppressEmptyNode: true,
  processEntities: false,
  cdataPropName: CDATA_KEY,
});

/** Strip the attribute-name prefix and return the lower-cased local name. */
function localAttrName(key: string): string {
  const raw = key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key;
  const lower = raw.toLowerCase();
  const colon = lower.indexOf(":");
  return colon >= 0 ? lower.slice(colon + 1) : lower;
}

/** True if a resolved `href` value is safe to keep on the given element. */
function isSafeHref(elementName: string, value: unknown): boolean {
  // Collapse whitespace / control chars (0x00–0x20) so obfuscated schemes
  // such as `java\tscript:` or `\x01javascript:` are still detected.
  const v = String(value ?? "").replace(CONTROL_OR_SPACE_RE, "").toLowerCase();
  if (FRAGMENT_ONLY_HREF_ELEMENTS.has(elementName)) {
    return v.startsWith("#");
  }
  return !DANGEROUS_HREF_SCHEMES.some((scheme) => v.startsWith(scheme));
}

/**
 * Return a sanitised copy of one element's attribute bag: event-handler
 * (`on*`) attributes are removed, and unsafe `href`/`xlink:href` values are
 * dropped. All other attributes pass through untouched.
 */
function sanitizeAttributes(
  elementName: string,
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const local = localAttrName(key);
    if (local.startsWith("on")) continue; // event handler
    if (local === "href" && !isSafeHref(elementName, value)) continue;
    clean[key] = value;
  }
  return clean;
}

/** A node in fast-xml-parser's `preserveOrder` representation. */
type OrderedNode = Record<string, unknown>;

/**
 * Recursively filter a `preserveOrder` node list: text nodes are kept,
 * allow-listed elements are kept (with attributes sanitised and children
 * recursed), and everything else is dropped along with its subtree.
 */
function filterNodes(nodes: OrderedNode[]): OrderedNode[] {
  const out: OrderedNode[] = [];
  for (const node of nodes) {
    // Text and CDATA are character data — kept verbatim. CDATA round-trips as
    // `<![CDATA[...]]>`, so any markup it contains stays inert (see parser
    // config). With `processEntities:false`, neither can carry a raw `<`.
    if (TEXT_KEY in node || CDATA_KEY in node) {
      out.push(node);
      continue;
    }
    // The single non-attribute key is the element/tag name.
    const tagKey = Object.keys(node).find((k) => k !== ATTRS_KEY);
    if (tagKey === undefined) continue;
    if (!ALLOWED_ELEMENTS.has(tagKey.toLowerCase())) continue;

    const elementName = tagKey.toLowerCase();
    const attrs = node[ATTRS_KEY];
    if (attrs && typeof attrs === "object") {
      node[ATTRS_KEY] = sanitizeAttributes(elementName, attrs as Record<string, unknown>);
    }
    const children = node[tagKey];
    if (Array.isArray(children)) {
      node[tagKey] = filterNodes(children as OrderedNode[]);
    }
    out.push(node);
  }
  return out;
}

/**
 * Strip dangerous SVG constructs that could cause XSS, local-file
 * disclosure, or external resource loading when fed to librsvg/sharp.
 *
 * Returns sanitised SVG markup, or an empty string if the input exceeds the
 * hard size cap or cannot be parsed into anything containing an `<svg>`
 * root. An empty result is safe: every caller treats it as "not a usable
 * SVG" (the upload route rejects it; the render pre-passes fall back to the
 * engine, which runs its own sanitizer).
 */
export function sanitizeSvgForRasterization(svgContent: string): string {
  // Hard byte cap before parsing — defence in depth. Callers already bound
  // their inputs (`MAX_USER_SVG_BYTES` on uploads, `MAX_INLINE_SVG_BYTES`
  // on inline payload SVG), but the sanitizer refuses to allocate a parse
  // tree for anything larger than the engine's own inline ceiling.
  if (svgContent.length > MAX_INLINE_SVG_BYTES) return "";

  let nodes: OrderedNode[];
  try {
    nodes = parser.parse(svgContent) as OrderedNode[];
  } catch {
    return "";
  }
  if (!Array.isArray(nodes)) return "";

  const filtered = filterNodes(nodes);

  let result: string;
  try {
    result = builder.build(filtered);
  } catch {
    return "";
  }

  // Guarantee the output still carries an SVG root; otherwise the input was
  // not a real SVG (or every node was dropped) and we return nothing.
  return /<svg[\s>]/i.test(result) ? result : "";
}
