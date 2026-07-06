/**
 * svgInlineSanitizer.test.ts — Tests for the out-of-engine SVG sanitize pass
 *
 * The frozen engine's regex `sanitizeSvg` has two catastrophic O(n²)
 * backtracking cases (the `<image href>` regex and the `on*`-handler regex),
 * both driven by long whitespace runs, plus external-ref/entity gaps. This
 * pass runs before the element list reaches the engine and hands it only
 * parser-sanitized, whitespace-run-capped bytes. These tests verify:
 *
 *   1. Both ReDoS shapes are neutralised in well under a second.
 *   2. External references, script, and DOCTYPE/ENTITY are stripped.
 *   3. Group recursion works and binding-expression svg/src pass through.
 *   4. The http(s) `src` fetch path inlines sanitized bytes and clears `src`.
 *   5. End-to-end wiring through `expandPipeline` feeds safe bytes onward.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the network fetch used by the URL-src branch; keep every real
// constant (MAX_SVG_FETCH_BYTES, MAX_INLINE_SVG_BYTES used by the sanitizer,
// etc.) via importActual so no test touches the network.
vi.mock("../src/engine/primitives/assetLimits", async () => {
  const actual = await vi.importActual<typeof import("../src/engine/primitives/assetLimits")>(
    "../src/engine/primitives/assetLimits",
  );
  return { ...actual, fetchTextWithLimit: vi.fn() };
});

import { fetchTextWithLimit } from "../src/engine/primitives/assetLimits";
import { sanitizeSvgForRasterization } from "../src/data/svgSanitization";
import { sanitizeSvgElementsForEngine } from "../src/data/svgInlineSanitizer";
import { expandPipeline } from "../src/core/renderService";

/** Length of the largest whitespace run the pass may leave in place. */
const MAX_SVG_WHITESPACE_RUN = 256;
/** Matches a whitespace run one longer than the cap. */
const LONG_RUN = /\s{257,}/;

beforeEach(() => {
  vi.mocked(fetchTextWithLimit).mockReset();
});

describe("sanitizeSvgElementsForEngine — ReDoS regression guards", () => {
  it("neutralises the <image>+whitespace shape in < 1s", async () => {
    const svg = "<svg><image" + " ".repeat(200_000);
    const start = Date.now();
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg }]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    const out = el.svg as string;
    // Either blanked (unparseable) or free of the long-whitespace shape.
    expect(out === "" || !LONG_RUN.test(out)).toBe(true);
    // No unquoted external <image href=...> survives.
    expect(out).not.toMatch(/<image[^>]*href\s*=\s*[^"'\s>]/i);
  });

  it("neutralises the text-node whitespace shape in < 1s and caps runs", async () => {
    const svg = "<svg><text>" + " ".repeat(200_000) + "</text></svg>";
    const start = Date.now();
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg }]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(LONG_RUN.test(el.svg as string)).toBe(false);
  });

  it("neutralises the inter-element whitespace shape and caps runs", async () => {
    const svg = "<svg>" + " ".repeat(200_000) + "<rect/></svg>";
    const start = Date.now();
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg }]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    const out = el.svg as string;
    expect(LONG_RUN.test(out)).toBe(false);
    // Runs are collapsed to at most MAX_SVG_WHITESPACE_RUN spaces.
    const longest = (out.match(/\s+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0);
    expect(longest).toBeLessThanOrEqual(MAX_SVG_WHITESPACE_RUN);
  });
});

describe("sanitizeSvgElementsForEngine — content sanitization", () => {
  it("recurses into group children and sanitizes nested svg", async () => {
    const hostile = '<svg><script>alert(1)</script><rect/></svg>';
    const [group] = await sanitizeSvgElementsForEngine([
      { type: "group", children: [{ type: "svg", svg: hostile }] },
    ]);
    const children = group.children as Record<string, unknown>[];
    expect(children[0].svg as string).not.toMatch(/<script/i);
    expect(children[0].svg as string).toMatch(/<rect/i);
  });

  it("sanitizes an svg leaf at the engine's deepest renderable nesting depth (10)", async () => {
    // The frozen engine renders svg leaves down to nesting depth 10 (a group
    // at depth 9 resolves its children at depth 10; resolveSvg has no depth
    // guard). The pass must sanitize that leaf, or its raw bytes reach the
    // frozen regex sanitizer. Build 10 nested groups wrapping a ReDoS leaf.
    let node: Record<string, unknown> = {
      type: "svg",
      svg: "<svg><text>" + " ".repeat(200_000) + "</text></svg>",
    };
    for (let i = 0; i < 10; i++) node = { type: "group", children: [node] };

    const [root] = await sanitizeSvgElementsForEngine([node]);

    // Walk down to the leaf and assert it was sanitized (whitespace capped).
    let leaf = root;
    while (leaf.type === "group") leaf = (leaf.children as Record<string, unknown>[])[0];
    expect(leaf.svg).not.toBe("<svg><text>" + " ".repeat(200_000) + "</text></svg>");
    expect(LONG_RUN.test(leaf.svg as string)).toBe(false);
  });

  it("strips external <use>/<feImage> href and script", async () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<use href="http://evil/x#a"/>' +
      '<feImage href="http://evil/y"/>' +
      '<script>alert(1)</script>' +
      '<rect/></svg>';
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg: hostile }]);
    const out = el.svg as string;
    expect(out).not.toContain("http://evil");
    expect(out).not.toMatch(/<script/i);
  });

  it("drops DOCTYPE and ENTITY declarations", async () => {
    const hostile =
      '<!DOCTYPE svg [<!ENTITY xxe "boom">]>' +
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg: hostile }]);
    const out = el.svg as string;
    expect(out).not.toMatch(/<!DOCTYPE/i);
    expect(out).not.toMatch(/<!ENTITY/i);
  });

  it("neutralises an unquoted external <image href=...>", async () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><image href=http://evil/z /></svg>';
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg: hostile }]);
    // The parser destroys the malformed `href=` binding — no live href (quoted
    // or unquoted) to the external host survives, so librsvg has nothing to
    // load. (An inert, invalid attribute fragment may remain; it is not a
    // reference.) This closes the frozen regex gap that matched only QUOTED
    // hrefs and let unquoted ones through.
    expect(el.svg as string).not.toMatch(/href\s*=\s*["']?\s*http/i);
  });

  it("keeps a benign SVG intact and unchanged by the whitespace collapse", async () => {
    const benign =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path d="M0 0h24v24H0z" fill="black"/></svg>';
    const [el] = await sanitizeSvgElementsForEngine([{ type: "svg", svg: benign }]);
    const out = el.svg as string;
    expect(out).toMatch(/<svg[\s>]/i);
    expect(out).toContain("<path");
    // Collapse is a no-op on benign content: the final bytes equal the
    // parser-sanitized bytes with no whitespace mangling.
    expect(out).toBe(sanitizeSvgForRasterization(benign));
  });

  it("leaves binding-expression (non-string) svg/src untouched by reference", async () => {
    const bindingSvg = { type: "svg", svg: { $: "features.icon" }, src: "" };
    const assetSrc = { type: "svg", svg: "", src: "asset:abc123.svg" };
    const dataSrc = { type: "svg", svg: "", src: "data:image/svg+xml,foo" };
    const [a, b, c] = await sanitizeSvgElementsForEngine([bindingSvg, assetSrc, dataSrc]);
    expect(a).toBe(bindingSvg);
    expect(b).toBe(assetSrc);
    expect(c).toBe(dataSrc);
  });

  it("returns non-svg elements and empty arrays by reference identity", async () => {
    const rect = { type: "rect", sizeX: 10, sizeY: 10 };
    const arr = [rect];
    const out = await sanitizeSvgElementsForEngine(arr);
    expect(out).toBe(arr);
    expect(out[0]).toBe(rect);
  });
});

describe("sanitizeSvgElementsForEngine — URL src fetch path", () => {
  it("fetches, sanitizes, inlines, and clears src", async () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<script>alert(1)</script>' +
      '<image href="http://evil/a"/>' +
      "<text>" + " ".repeat(200_000) + "</text>" +
      "<rect/></svg>";
    vi.mocked(fetchTextWithLimit).mockResolvedValue(hostile);

    const [el] = await sanitizeSvgElementsForEngine([
      { type: "svg", svg: "", src: "http://host/x.svg" },
    ]);

    expect(el.src).toBe("");
    const out = el.svg as string;
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("http://evil");
    expect(LONG_RUN.test(out)).toBe(false);
    expect(vi.mocked(fetchTextWithLimit)).toHaveBeenCalledTimes(1);
  });

  it("blanks both svg and src when the fetch throws", async () => {
    vi.mocked(fetchTextWithLimit).mockRejectedValue(new Error("network down"));
    const [el] = await sanitizeSvgElementsForEngine([
      { type: "svg", svg: "", src: "http://host/x.svg" },
    ]);
    expect(el.svg).toBe("");
    expect(el.src).toBe("");
  });

  it("does not fetch for a non-http src", async () => {
    const [el] = await sanitizeSvgElementsForEngine([
      { type: "svg", svg: "", src: "asset:abc.svg" },
    ]);
    expect(el.src).toBe("asset:abc.svg");
    expect(vi.mocked(fetchTextWithLimit)).not.toHaveBeenCalled();
  });

  it("clears a live src on an inline svg that sanitizes to empty (no engine fallback fetch)", async () => {
    // `svg:"."` has no <svg> root -> sanitizer returns "". If src survived, the
    // frozen drawSvg fallback (`!svgContent && props.src`) would fetch the raw
    // attacker URL and run it through the weak frozen regex.
    const [el] = await sanitizeSvgElementsForEngine([
      { type: "svg", svg: ".", src: "http://attacker/redos.svg" },
    ]);
    expect(el.svg).toBe("");
    expect(el.src).toBe("");
    // The pass must NOT reach out to the network for an inline-svg element.
    expect(vi.mocked(fetchTextWithLimit)).not.toHaveBeenCalled();
  });

  it("clears src on a valid inline svg (src is unused by the engine when svg is present)", async () => {
    const benign =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>';
    const [el] = await sanitizeSvgElementsForEngine([
      { type: "svg", svg: benign, src: "http://host/y.svg" },
    ]);
    expect(el.src).toBe("");
    expect(el.svg as string).toContain("<path");
  });
});

describe("sanitizeSvgElementsForEngine — abort handling", () => {
  it("throws RENDER_ABORTED when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      sanitizeSvgElementsForEngine([{ type: "svg", svg: "<svg/>" }], controller.signal),
    ).rejects.toThrow("RENDER_ABORTED");
  });
});

describe("preparePipeline wiring — end-to-end via expandPipeline", () => {
  const base = {
    misc: { size: { width: 100, height: 100 }, format: "png", gridSize: "1x1" },
    features: {},
    sources: [],
  };

  it("processes the <image> ReDoS shape quickly and hands on safe bytes", async () => {
    const payload = {
      ...base,
      elements: [{ type: "svg", svg: "<svg><image" + " ".repeat(200_000) }],
    };
    const start = Date.now();
    const result = await expandPipeline(payload, null, null);
    expect(Date.now() - start).toBeLessThan(1000);
    const out = result.elements[0].svg as string;
    expect(out === "" || !LONG_RUN.test(out)).toBe(true);
  });

  it("processes the text-whitespace ReDoS shape quickly and caps runs", async () => {
    const payload = {
      ...base,
      elements: [
        { type: "svg", svg: "<svg><text>" + " ".repeat(200_000) + "</text></svg>" },
      ],
    };
    const start = Date.now();
    const result = await expandPipeline(payload, null, null);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(LONG_RUN.test(result.elements[0].svg as string)).toBe(false);
  });
});
