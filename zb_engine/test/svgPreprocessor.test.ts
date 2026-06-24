/**
 * svgPreprocessor.test.ts — Tests for inline-SVG dimension normalization
 *
 * Verifies that `normalizeSvgDimensions` always rewrites the root <svg> tag
 * to (a) include a viewBox, (b) set width/height to the element's display
 * size, and (c) force preserveAspectRatio="none" — the three properties
 * required for librsvg to rasterize within the engine's 300 ms timeout while
 * matching the Konva preview's anisotropic stretch.
 *
 * Also verifies that `normalizeSvgElements` recurses into group children and
 * leaves non-SVG / dynamic-binding elements untouched.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSvgDimensions,
  normalizeSvgElements,
} from "../src/data/svgPreprocessor";

describe("normalizeSvgDimensions", () => {
  it("inserts width, height, and preserveAspectRatio when missing", () => {
    const input = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('width="160"');
    expect(out).toContain('height="96"');
    expect(out).toContain('preserveAspectRatio="none"');
  });

  it("derives a viewBox from explicit width/height when no viewBox is present", () => {
    const input = '<svg width="2531" height="1989"><rect/></svg>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('viewBox="0 0 2531 1989"');
    expect(out).toContain('width="160"');
    expect(out).toContain('height="96"');
    expect(out).toContain('preserveAspectRatio="none"');
  });

  it("falls back to target dimensions when neither viewBox nor numeric width/height exist", () => {
    const input = '<svg width="100%" height="100%"><circle/></svg>';
    const out = normalizeSvgDimensions(input, 200, 100);
    expect(out).toContain('viewBox="0 0 200 100"');
    expect(out).toContain('width="200"');
    expect(out).toContain('height="100"');
  });

  it("replaces existing width/height/preserveAspectRatio values", () => {
    const input =
      '<svg width="2531" height="1989" viewBox="0 0 2531 1989" preserveAspectRatio="xMidYMid meet"><g/></svg>';
    const out = normalizeSvgDimensions(input, 160, 96);
    // viewBox preserved (already valid)
    expect(out).toContain('viewBox="0 0 2531 1989"');
    expect(out).toContain('width="160"');
    expect(out).toContain('height="96"');
    expect(out).toContain('preserveAspectRatio="none"');
    // The old preserveAspectRatio value must be gone
    expect(out).not.toContain("xMidYMid meet");
  });

  it("still forces preserveAspectRatio=none when the SVG is already at target size", () => {
    // This guarantees WYSIWYG parity even for exactly-sized SVGs:
    // without preserveAspectRatio="none" librsvg would still center inside
    // the viewport rather than fill it edge-to-edge like Konva does.
    const input = '<svg width="160" height="96" viewBox="0 0 160 96"/>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('preserveAspectRatio="none"');
    expect(out).toContain('width="160"');
    expect(out).toContain('height="96"');
  });

  it("handles single-quoted attribute values", () => {
    const input = "<svg width='2531' height='1989'><path/></svg>";
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('width="160"');
    expect(out).toContain('height="96"');
    expect(out).toContain('viewBox="0 0 2531 1989"');
  });

  it("handles px-suffixed length values", () => {
    const input = '<svg width="2531px" height="1989px"><path/></svg>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('viewBox="0 0 2531 1989"');
    expect(out).toContain('width="160"');
    expect(out).toContain('height="96"');
  });

  it("preserves an XML declaration prefix", () => {
    const input =
      '<?xml version="1.0" encoding="UTF-8"?><svg viewBox="0 0 24 24"><path/></svg>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out).toContain('width="160"');
    expect(out).toContain('preserveAspectRatio="none"');
  });

  it("repairs a malformed viewBox by deriving from intrinsic dimensions", () => {
    const input =
      '<svg width="2531" height="1989" viewBox="not a viewbox"><path/></svg>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('viewBox="0 0 2531 1989"');
    expect(out).not.toContain('viewBox="not a viewbox"');
  });

  it("returns the original string when no <svg> tag is present", () => {
    const input = "<not-svg></not-svg>";
    expect(normalizeSvgDimensions(input, 160, 96)).toBe(input);
  });

  it("returns the original string when the <svg> tag is unterminated", () => {
    const input = "<svg viewBox=";
    expect(normalizeSvgDimensions(input, 160, 96)).toBe(input);
  });

  it("returns the original string when content is empty or sizes are non-positive", () => {
    expect(normalizeSvgDimensions("", 160, 96)).toBe("");
    expect(normalizeSvgDimensions("<svg/>", 0, 96)).toBe("<svg/>");
    expect(normalizeSvgDimensions("<svg/>", 160, -1)).toBe("<svg/>");
  });

  it("does not match data-* attributes when rewriting width/height", () => {
    // `data-width` must not be confused with `width`.
    const input = '<svg data-width="999" viewBox="0 0 24 24"/>';
    const out = normalizeSvgDimensions(input, 160, 96);
    expect(out).toContain('data-width="999"');
    expect(out).toContain('width="160"');
  });
});

describe("normalizeSvgElements", () => {
  it("returns non-SVG elements unchanged (referential equality)", () => {
    const elements = [
      { type: "rect", sizeX: 10, sizeY: 10 },
      { type: "text", text: "Hi", sizeX: 100, sizeY: 20 },
    ];
    const out = normalizeSvgElements(elements);
    expect(out[0]).toBe(elements[0]);
    expect(out[1]).toBe(elements[1]);
  });

  it("normalizes a top-level SVG element", () => {
    const elements = [
      {
        type: "svg",
        sizeX: 160,
        sizeY: 96,
        svg: '<svg viewBox="0 0 24 24"><path/></svg>',
      },
    ];
    const out = normalizeSvgElements(elements);
    expect(out[0]).not.toBe(elements[0]);
    const svgStr = out[0].svg as string;
    expect(svgStr).toContain('width="160"');
    expect(svgStr).toContain('height="96"');
    expect(svgStr).toContain('preserveAspectRatio="none"');
  });

  it("skips SVG elements whose `svg` field is not a literal string (binding expression)", () => {
    const elements = [
      {
        type: "svg",
        sizeX: 160,
        sizeY: 96,
        // Binding expressions arrive as objects, not strings. They are
        // resolved inside the engine and out of scope for static rewriting.
        svg: { $bind: "features.icon" },
      },
    ];
    const out = normalizeSvgElements(elements);
    expect(out[0]).toBe(elements[0]);
  });

  it("skips SVG elements whose sizes are not literal positive numbers", () => {
    const elements = [
      {
        type: "svg",
        sizeX: { $bind: "misc.w" },
        sizeY: 96,
        svg: '<svg viewBox="0 0 24 24"/>',
      },
    ];
    const out = normalizeSvgElements(elements);
    expect(out[0]).toBe(elements[0]);
  });

  it("recurses into group children and rewrites nested SVGs", () => {
    const elements = [
      {
        type: "group",
        children: [
          { type: "rect", sizeX: 10, sizeY: 10 },
          {
            type: "svg",
            sizeX: 160,
            sizeY: 96,
            svg: '<svg viewBox="0 0 24 24"><path/></svg>',
          },
        ],
      },
    ];
    const out = normalizeSvgElements(elements);
    // Top-level group object replaced because a child changed.
    expect(out[0]).not.toBe(elements[0]);
    const newChildren = (out[0] as { children: Record<string, unknown>[] }).children;
    // The rect child is unchanged → same reference preserved.
    expect(newChildren[0]).toBe(
      (elements[0] as { children: Record<string, unknown>[] }).children[0],
    );
    const nestedSvg = newChildren[1].svg as string;
    expect(nestedSvg).toContain('width="160"');
    expect(nestedSvg).toContain('preserveAspectRatio="none"');
  });

  it("preserves group reference when no descendant changed", () => {
    const elements = [
      {
        type: "group",
        children: [{ type: "rect", sizeX: 10, sizeY: 10 }],
      },
    ];
    const out = normalizeSvgElements(elements);
    expect(out[0]).toBe(elements[0]);
  });

  it("recurses through deeply nested groups (within MAX_GROUP_DEPTH)", () => {
    const inner = {
      type: "svg",
      sizeX: 50,
      sizeY: 50,
      svg: '<svg viewBox="0 0 24 24"><path/></svg>',
    };
    // 5 levels of nesting — well within the depth cap of 10.
    let nested: Record<string, unknown> = inner;
    for (let i = 0; i < 5; i++) {
      nested = { type: "group", children: [nested] };
    }
    const out = normalizeSvgElements([nested]);

    let cursor: Record<string, unknown> = out[0];
    while (cursor.type === "group") {
      cursor = (cursor.children as Record<string, unknown>[])[0];
    }
    expect(cursor.svg).toContain('width="50"');
    expect(cursor.svg).toContain('preserveAspectRatio="none"');
  });
});
