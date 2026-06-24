/**
 * normalizer.test.ts — Tests for graph data normalisation + LTTB downsampling
 *
 * Covers: flat arrays, nested paths, ISO/Unix timestamps, null gaps,
 * downsampling behaviour, edge cases (0/1/exact-max points).
 */

import { describe, it, expect } from "vitest";
import { normalizeDataPoints } from "../src/data/graph/normalizer";

// ── Basic flat array (index-based X) ───────────────────────────

describe("flat array normalisation", () => {
  it("returns index-based X for flat numeric arrays", () => {
    const pts = normalizeDataPoints([10, 20, 30], "", "", "");
    expect(pts).toEqual([
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 30 },
    ]);
  });

  it("handles null gaps in flat arrays", () => {
    const pts = normalizeDataPoints([10, null, 30], "", "", "");
    expect(pts).toEqual([
      { x: 0, y: 10 },
      { x: 1, y: null },
      { x: 2, y: 30 },
    ]);
  });

  it("returns empty for empty array", () => {
    expect(normalizeDataPoints([], "", "", "")).toEqual([]);
  });

  it("returns empty for non-array input", () => {
    expect(normalizeDataPoints("not-array", "", "", "")).toEqual([]);
    expect(normalizeDataPoints(null, "", "", "")).toEqual([]);
    expect(normalizeDataPoints(42, "", "", "")).toEqual([]);
  });

  it("handles single-element array", () => {
    const pts = normalizeDataPoints([99], "", "", "");
    expect(pts).toEqual([{ x: 0, y: 99 }]);
  });
});

// ── Nested data paths ──────────────────────────────────────────

describe("nested data paths", () => {
  it("resolves dataPath to an inner array", () => {
    const data = { result: { readings: [1, 2, 3] } };
    const pts = normalizeDataPoints(data, "result.readings", "", "");
    expect(pts).toHaveLength(3);
    expect(pts[0].y).toBe(1);
  });

  it("extracts Y from valuePath within objects", () => {
    const data = [
      { temp: 22, ts: 100 },
      { temp: 25, ts: 200 },
    ];
    const pts = normalizeDataPoints(data, "", "temp", "ts");
    expect(pts).toEqual([
      { x: 100, y: 22 },
      { x: 200, y: 25 },
    ]);
  });

  it("returns empty when dataPath resolves to non-array", () => {
    expect(normalizeDataPoints({ a: "str" }, "a", "", "")).toEqual([]);
  });
});

// ── Time parsing ───────────────────────────────────────────────

describe("time parsing", () => {
  it("parses ISO date strings as X values", () => {
    const data = [
      { val: 10, ts: "2024-01-01T00:00:00Z" },
      { val: 20, ts: "2024-01-02T00:00:00Z" },
    ];
    const pts = normalizeDataPoints(data, "", "val", "ts");
    expect(pts).toHaveLength(2);
    // Should be epoch ms
    expect(pts[0].x).toBe(Date.parse("2024-01-01T00:00:00Z"));
    expect(pts[1].x).toBe(Date.parse("2024-01-02T00:00:00Z"));
  });

  it("uses numeric timestamps as-is", () => {
    const data = [
      { val: 1, ts: 1000 },
      { val: 2, ts: 2000 },
    ];
    const pts = normalizeDataPoints(data, "", "val", "ts");
    expect(pts[0].x).toBe(1000);
  });

  it("skips items with unparseable X", () => {
    const data = [
      { val: 1, ts: "valid-not" },
      { val: 2, ts: 1000 },
    ];
    // "valid-not" can't be parsed as date or number, so that point is skipped
    const pts = normalizeDataPoints(data, "", "val", "ts");
    expect(pts).toHaveLength(1);
    expect(pts[0].y).toBe(2);
  });
});

// ── Sorting ────────────────────────────────────────────────────

describe("sorting", () => {
  it("sorts output by X ascending", () => {
    const data = [
      { v: 1, t: 300 },
      { v: 2, t: 100 },
      { v: 3, t: 200 },
    ];
    const pts = normalizeDataPoints(data, "", "v", "t");
    expect(pts.map((p) => p.x)).toEqual([100, 200, 300]);
    expect(pts.map((p) => p.y)).toEqual([2, 3, 1]);
  });
});

// ── Downsampling (LTTB) ────────────────────────────────────────

describe("LTTB downsampling", () => {
  it("does NOT downsample when points <= maxPoints", () => {
    const data = Array.from({ length: 10 }, (_, i) => i * 10);
    const pts = normalizeDataPoints(data, "", "", "", 200);
    expect(pts).toHaveLength(10);
  });

  it("downsamples large datasets to maxPoints", () => {
    // 500 points should be trimmed to the cap (200 by default)
    const data = Array.from({ length: 500 }, (_, i) => i);
    const pts = normalizeDataPoints(data, "", "", "");
    expect(pts.length).toBeLessThanOrEqual(200);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });

  it("preserves first and last points after downsampling", () => {
    const data = Array.from({ length: 500 }, (_, i) => i * 2);
    const pts = normalizeDataPoints(data, "", "", "");
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 499, y: 998 });
  });

  it("respects explicit maxPoints parameter", () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const pts = normalizeDataPoints(data, "", "", "", 10);
    expect(pts.length).toBeLessThanOrEqual(10);
  });

  it("clamps maxPoints to minimum of 3", () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const pts = normalizeDataPoints(data, "", "", "", 1);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });
});

// ── String Y values ────────────────────────────────────────────

describe("string Y values", () => {
  it("parses numeric strings as Y", () => {
    const pts = normalizeDataPoints(["10.5", "20.3"], "", "", "");
    expect(pts[0].y).toBe(10.5);
    expect(pts[1].y).toBe(20.3);
  });

  it("treats non-numeric strings as null gaps", () => {
    const pts = normalizeDataPoints(["abc", "10"], "", "", "");
    expect(pts[0].y).toBeNull();
    expect(pts[1].y).toBe(10);
  });
});
