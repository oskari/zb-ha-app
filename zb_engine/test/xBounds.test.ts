/**
 * xBounds.test.ts — X-axis time window bound resolution and filtering
 */

import { describe, it, expect } from "vitest";
import {
  resolveXBound,
  filterPointsByXWindow,
  isTimestampSeries,
  timestampToMs,
  msBoundToSeriesUnit,
} from "../src/data/graph/xBounds";
import type { NormalizedPoint } from "../src/data/graph/types";

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0); // 2026-07-14 12:00 UTC

describe("resolveXBound", () => {
  it("returns null for auto values", () => {
    expect(resolveXBound(null, NOW)).toBeNull();
    expect(resolveXBound(undefined, NOW)).toBeNull();
    expect(resolveXBound("", NOW)).toBeNull();
  });

  it("resolves now", () => {
    expect(resolveXBound("now", NOW)).toBe(NOW);
    expect(resolveXBound("NOW", NOW)).toBe(NOW);
  });

  it("resolves relative offsets", () => {
    expect(resolveXBound("now+6h", NOW)).toBe(NOW + 6 * 3_600_000);
    expect(resolveXBound("now-2h", NOW)).toBe(NOW - 2 * 3_600_000);
    expect(resolveXBound("now+30m", NOW)).toBe(NOW + 30 * 60_000);
    expect(resolveXBound("now+1d", NOW)).toBe(NOW + 86_400_000);
  });

  it("returns null for invalid strings", () => {
    expect(resolveXBound("invalid", NOW)).toBeNull();
    expect(resolveXBound("now+6x", NOW)).toBeNull();
  });

  it("accepts epoch ms and seconds", () => {
    const ms = 1_700_000_000_000;
    expect(resolveXBound(ms, NOW)).toBe(ms);
    expect(resolveXBound(1_700_000_000, NOW)).toBe(1_700_000_000_000);
  });

  it("parses ISO date strings", () => {
    const iso = "2026-07-14T15:00:00+03:00";
    expect(resolveXBound(iso, NOW)).toBe(Date.parse(iso));
  });
});

describe("filterPointsByXWindow", () => {
  const points: NormalizedPoint[] = [
    { x: NOW - 3_600_000, y: 1 },
    { x: NOW, y: 2 },
    { x: NOW + 3_600_000, y: 3 },
  ];

  it("filters by xMin", () => {
    const out = filterPointsByXWindow(points, NOW, null);
    expect(out.map((p) => p.y)).toEqual([2, 3]);
  });

  it("filters by xMax", () => {
    const out = filterPointsByXWindow(points, null, NOW);
    expect(out.map((p) => p.y)).toEqual([1, 2]);
  });

  it("filters by both bounds", () => {
    const out = filterPointsByXWindow(points, NOW - 1000, NOW + 1000);
    expect(out.map((p) => p.y)).toEqual([2]);
  });

  it("handles second-based timestamps", () => {
    const secPoints: NormalizedPoint[] = [
      { x: NOW / 1000 - 3600, y: 1 },
      { x: NOW / 1000, y: 2 },
      { x: NOW / 1000 + 3600, y: 3 },
    ];
    const out = filterPointsByXWindow(secPoints, NOW, null);
    expect(out.map((p) => p.y)).toEqual([2, 3]);
  });
});

describe("isTimestampSeries", () => {
  it("is false without timePath", () => {
    expect(isTimestampSeries([{ x: 1e12, y: 1 }], "")).toBe(false);
  });

  it("is true when points have timestamp X", () => {
    expect(isTimestampSeries([{ x: 1e12, y: 1 }], "t")).toBe(true);
  });
});

describe("unit conversion helpers", () => {
  it("timestampToMs normalizes seconds", () => {
    expect(timestampToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(timestampToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("msBoundToSeriesUnit converts for second series", () => {
    const secPoints = [{ x: 1_700_000_000, y: 1 }];
    expect(msBoundToSeriesUnit(1_700_000_000_000, secPoints)).toBe(1_700_000_000);
  });
});
