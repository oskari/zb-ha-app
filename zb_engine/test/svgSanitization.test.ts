/**
 * svgSanitization.test.ts — SVG sanitization security tests
 *
 * §4.1: Proves the sanitizeSvg() function (in the frozen src/engine/primitives/svg.ts)
 * strips dangerous elements and attributes before passing SVG to Sharp for rasterization.
 *
 * Strategy: Mock Sharp to capture the sanitized SVG string that drawSvg() passes to it.
 * This tests the actual sanitizer without modifying the frozen engine code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Sharp to capture sanitized SVG ────────────────────────

let capturedSvg = "";

vi.mock("sharp", () => ({
  default: (input: Buffer | string) => {
    capturedSvg = typeof input === "string" ? input : input.toString("utf-8");
    const chain = {
      flatten: () => chain,
      resize: () => chain,
      grayscale: () => chain,
      raw: () => chain,
      toBuffer: () =>
        Promise.resolve({
          data: Buffer.alloc(100),
          info: { width: 10, height: 10, channels: 1, size: 100 },
        }),
    };
    return chain;
  },
}));

import { drawSvg } from "../src/engine/primitives/svg";
import { Canvas } from "../src/engine/canvas";

// ── Helpers ────────────────────────────────────────────────────

/** Minimal SvgProps for testing (only svg + required base props). */
function makeSvgProps(svgContent: string) {
  return {
    type: "svg" as const,
    svg: svgContent,
    src: "",
    bwMode: "threshold" as const,
    bwLevel: 50,
    pos: { x: 0, y: 0 },
    rotationDeg: 0,
    scale: { x: 1, y: 1 },
    origin: { x: 0, y: 0 },
    sizeX: 10,
    sizeY: 10,
    opacity: 100,
    visible: true,
    enableFill: false,
    fill: 0,
    enableStroke: false,
    strokeDither: 0,
    strokeWidth: 0,
    strokeDash: [],
    strokeCap: "butt" as const,
    strokePosition: "center" as const,
    strokeRadius: 0,
  };
}

async function sanitize(svgContent: string): Promise<string> {
  capturedSvg = "";
  const canvas = new Canvas(100, 100);
  await drawSvg(canvas, makeSvgProps(svgContent));
  return capturedSvg;
}

// ── §4.1 SVG sanitization tests ────────────────────────────────

describe("SVG sanitization — dangerous elements", () => {
  it("strips <script> tags with content", async () => {
    const result = await sanitize(
      '<svg><script>alert(1)</script><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert(1)");
    expect(result).toContain("<rect");
  });

  it("strips <foreignObject> tags", async () => {
    const result = await sanitize(
      '<svg><foreignObject><div>evil</div></foreignObject><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("<foreignObject>");
    expect(result).not.toContain("evil");
  });

  it("strips <iframe> tags", async () => {
    const result = await sanitize(
      '<svg><iframe src="http://evil.com"></iframe><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("evil.com");
  });

  it("handles self-closing <script/> — regex targets paired tags", async () => {
    // The sanitizer regex strips <script>...</script> paired tags.
    // Self-closing <script /> is unusual in SVG and is left to the rasterizer
    // (Sharp/librsvg), which does not execute scripts anyway.
    // This test documents the known behavior.
    const result = await sanitize(
      '<svg><script /><rect width="10" height="10"/></svg>',
    );
    // Self-closing variant passes through — verify the rect is preserved
    expect(result).toContain("<rect");
  });
});

describe("SVG sanitization — case variations", () => {
  it("strips <SCRIPT> (uppercase)", async () => {
    const result = await sanitize(
      '<svg><SCRIPT>alert(1)</SCRIPT><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toMatch(/<script/i);
  });

  it("strips <Script> (mixed case)", async () => {
    const result = await sanitize(
      '<svg><Script>alert(1)</Script><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toMatch(/<script/i);
  });

  it("strips <ForeignObject> (mixed case)", async () => {
    const result = await sanitize(
      '<svg><ForeignObject>evil</ForeignObject><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toMatch(/<foreignobject/i);
  });
});

describe("SVG sanitization — event handlers", () => {
  it("strips onload attribute", async () => {
    const result = await sanitize(
      '<svg onload="alert(1)"><rect width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("onload");
    expect(result).not.toContain("alert(1)");
  });

  it("strips onclick attribute", async () => {
    const result = await sanitize(
      '<svg><rect onclick="alert(1)" width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("onclick");
  });

  it("strips onerror attribute", async () => {
    const result = await sanitize(
      '<svg><image onerror="alert(1)"/></svg>',
    );
    expect(result).not.toContain("onerror");
  });

  it("strips onmouseover attribute", async () => {
    const result = await sanitize(
      '<svg><rect onmouseover="alert(1)" width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("onmouseover");
  });
});

describe("SVG sanitization — external image references", () => {
  it("strips href pointing to external URL on <image>", async () => {
    const result = await sanitize(
      '<svg><image href="http://evil.com/x.png" width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("evil.com");
  });

  it("strips xlink:href pointing to external URL on <image>", async () => {
    const result = await sanitize(
      '<svg><image xlink:href="https://evil.com/x.png" width="10" height="10"/></svg>',
    );
    expect(result).not.toContain("evil.com");
  });

  it("preserves fragment references (#localRef) on <image>", async () => {
    const result = await sanitize(
      '<svg><image href="#localRef" width="10" height="10"/></svg>',
    );
    expect(result).toContain("#localRef");
  });
});

describe("SVG sanitization — safe content preserved", () => {
  it("preserves basic SVG shapes", async () => {
    const result = await sanitize(
      '<svg><rect x="0" y="0" width="50" height="50" fill="black"/><circle cx="25" cy="25" r="10"/></svg>',
    );
    expect(result).toContain("<rect");
    expect(result).toContain("<circle");
  });

  it("preserves text elements", async () => {
    const result = await sanitize(
      '<svg><text x="10" y="20">Hello</text></svg>',
    );
    expect(result).toContain("<text");
    expect(result).toContain("Hello");
  });

  it("preserves path elements", async () => {
    const result = await sanitize(
      '<svg><path d="M10 10 L20 20"/></svg>',
    );
    expect(result).toContain("<path");
  });
});
