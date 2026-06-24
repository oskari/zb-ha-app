/**
 * svgSanitizationParser.test.ts — Parser-based SVG sanitizer
 *
 * Exercises `sanitizeSvgForRasterization` (the out-of-engine canonical
 * sanitizer in `src/data/svgSanitization.ts`) directly. The frozen engine's
 * own `sanitizeSvg` is covered separately by `svgSanitization.test.ts`.
 *
 * Goals:
 *   - Dangerous constructs are dropped by allow-list, including the
 *     blocklist-bypass shapes the old regex sanitizer missed.
 *   - Adversarial input is linear-time (no ReDoS freeze).
 *   - Legitimate drawing markup survives the parse → re-serialise round trip.
 */

import { describe, it, expect } from "vitest";
import { sanitizeSvgForRasterization } from "../src/data/svgSanitization";

const clean = (svg: string) => sanitizeSvgForRasterization(svg);

describe("parser sanitizer — dangerous elements dropped", () => {
  it("drops <script> and its content", () => {
    const out = clean(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>`);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<rect");
  });

  it("drops an UNTERMINATED <script> (old regex bypass)", () => {
    // No closing </script>. The old paired-tag regex left this untouched.
    const out = clean(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)<rect width="10" height="10"/></svg>`);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(1)");
  });

  it("drops <foreignObject> subtree", () => {
    const out = clean(`<svg><foreignObject><div onclick="x">evil</div></foreignObject><rect/></svg>`);
    expect(out).not.toMatch(/foreignobject/i);
    expect(out).not.toContain("evil");
  });

  it("drops <iframe>", () => {
    const out = clean(`<svg><iframe src="http://evil.com"></iframe><rect/></svg>`);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toContain("evil.com");
  });

  it("drops SMIL animation (javascript: vector)", () => {
    const out = clean(`<svg><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="x"/><rect/></svg>`);
    expect(out).not.toMatch(/<set/i);
    expect(out).not.toMatch(/<animate/i);
    expect(out).not.toContain("javascript:");
  });

  it("drops comments (comment-smuggled markup)", () => {
    const out = clean(`<svg><!-- <script>alert(1)</script> --><rect/></svg>`);
    expect(out).not.toContain("alert(1)");
    expect(out).not.toContain("<!--");
  });

  it("does NOT re-materialise a live <script> from CDATA (round-trip bypass)", () => {
    // CDATA is unwrapped into a text node by the parser; a naive re-serialise
    // would emit it raw and turn this back into an executable <script>.
    const inputs = [
      `<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[<script>alert(1)</script>]]></style></svg>`,
      `<svg><text><![CDATA[<img src=x onerror=alert(1)>]]></text></svg>`,
      `<svg><![CDATA[</text><script>alert(1)</script>]]></svg>`,
    ];
    for (const svg of inputs) {
      const out = clean(svg);
      // Any surviving markup must be inert CDATA character data — there must
      // be no live <script> element or on* handler OUTSIDE a CDATA section.
      const outsideCdata = out.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
      expect(outsideCdata).not.toMatch(/<script/i);
      expect(outsideCdata).not.toMatch(/onerror/i);
    }
  });

  it("preserves legitimate CSS inside <style> CDATA", () => {
    const out = clean(`<svg><style><![CDATA[.a{fill:#000}]]></style><rect class="a" width="10" height="10"/></svg>`);
    expect(out).toContain(".a{fill:#000}");
    expect(out).toContain("<rect");
  });
});

describe("parser sanitizer — dangerous attributes stripped", () => {
  it("strips on* event handlers (any case)", () => {
    const out = clean(`<svg onload="a"><rect onClick="b" ONMOUSEOVER="c" width="10" height="10"/></svg>`);
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toContain("<rect");
    expect(out).toContain('width="10"');
  });

  it("strips external href / xlink:href on <image>, keeps the element", () => {
    const out = clean(`<svg><image xlink:href="http://evil.com/x.png" width="10" height="10"/></svg>`);
    expect(out).not.toContain("evil.com");
    expect(out).not.toMatch(/href/i);
    expect(out).toContain("<image");
  });

  it("strips file:// and data: href on <image>", () => {
    const out = clean(`<svg><image href="file:///etc/passwd"/><image href="data:image/svg+xml;base64,AAAA"/></svg>`);
    expect(out).not.toContain("passwd");
    expect(out).not.toContain("data:");
  });

  it("preserves fragment (#id) href on <image> and <use>", () => {
    const out = clean(`<svg><image href="#frag" width="10" height="10"/><use href="#g"/></svg>`);
    expect(out).toContain("#frag");
    expect(out).toContain("#g");
  });

  it("strips javascript: href on <a> (obfuscated with control chars)", () => {
    const out = clean(`<svg><a href="java\tscript:alert(1)"><text>hi</text></a></svg>`);
    expect(out).not.toContain("javascript:");
    expect(out).not.toMatch(/java\tscript/);
    // The <a> wrapper and its visible content are preserved.
    expect(out).toContain("hi");
  });
});

describe("parser sanitizer — legitimate markup preserved", () => {
  it("preserves basic shapes + attributes", () => {
    const out = clean(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect x="0" y="0" width="50" height="50" fill="black"/><circle cx="25" cy="25" r="10"/><path d="M10 10 L20 20"/></svg>`);
    expect(out).toContain("<rect");
    expect(out).toContain("<circle");
    expect(out).toContain("<path");
    expect(out).toContain('viewBox="0 0 50 50"');
    expect(out).toContain('d="M10 10 L20 20"');
  });

  it("preserves gradients, defs, and fill=url(#id)", () => {
    const out = clean(`<svg><defs><linearGradient id="g"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`);
    expect(out).toMatch(/lineargradient/i);
    expect(out).toContain("<stop");
    expect(out).toContain('fill="url(#g)"');
  });

  it("preserves text + tspan content and namespaces", () => {
    const out = clean(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><text x="10" y="20">Hello <tspan>World</tspan></text></svg>`);
    expect(out).toContain("Hello");
    expect(out).toContain("World");
    expect(out).toContain("<tspan");
    expect(out).toContain("xmlns:xlink");
  });

  it("preserves <style> blocks and filters", () => {
    const out = clean(`<svg><style>.a{fill:#000}</style><filter id="f"><feGaussianBlur stdDeviation="2"/></filter><rect class="a" filter="url(#f)"/></svg>`);
    expect(out).toContain("<style");
    expect(out).toMatch(/fegaussianblur/i);
    expect(out).toContain('filter="url(#f)"');
  });
});

describe("parser sanitizer — robustness", () => {
  it("returns '' for non-SVG input", () => {
    expect(clean("not xml at all")).toBe("");
    expect(clean("<html><body>hi</body></html>")).toBe("");
  });

  it("returns '' for input above the hard byte cap", () => {
    const huge = `<svg>${"<rect/>".repeat(400_000)}</svg>`; // > 1 MiB
    expect(huge.length).toBeGreaterThan(1024 * 1024);
    expect(clean(huge)).toBe("");
  });

  it("does NOT exhibit ReDoS on adversarial <image> input", () => {
    // The old regex backtracked super-linearly on many spaces before `href`.
    const adversarial = `<svg><image${" ".repeat(50_000)}href="http://evil/x"/></svg>`;
    const start = process.hrtime.bigint();
    const out = clean(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(1000);
    expect(out).not.toContain("evil");
  });
});
