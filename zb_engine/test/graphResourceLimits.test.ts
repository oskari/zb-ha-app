/**
 * graphResourceLimits.test.ts — Phase 3 graph expansion preflight guards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDataContext } from "@zb/expressions";
import { expandGraphElements } from "../src/data/graph/expander";
import {
  MAX_GRAPH_GRID_LINES,
  MAX_GRAPH_X_AXIS_LABELS,
} from "../src/limits";

function makeContext(pointCount = 8) {
  const ctx = createDataContext();
  ctx.history = {
    points: Array.from({ length: pointCount }, (_, index) => ({
      t: Date.UTC(2026, 0, 1 + index),
      v: index,
    })),
  };
  return ctx;
}

function baseGraph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "graph",
    id: "resource_graph",
    pos: { x: 0, y: 0 },
    sizeX: 240,
    sizeY: 140,
    chartType: "line",
    sourceId: "history",
    dataPath: "points",
    valuePath: "v",
    timePath: "t",
    resolution: 100,
    dataRangeStart: 0,
    dataRangeEnd: 100,
    showAxes: true,
    showGrid: true,
    gridLines: 4,
    showLabels: true,
    xLabelInterval: 0,
    ...overrides,
  };
}

describe("graph expansion resource limits", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows graph settings within the builder-supported range", () => {
    const result = expandGraphElements([
      baseGraph({ gridLines: 20, xLabelInterval: 24 }),
    ], makeContext());

    expect(result.errors).toEqual([]);
    expect(result.elements.length).toBeGreaterThan(0);
  });

  it("rejects excessive grid divisions before axis expansion", () => {
    const result = expandGraphElements([
      baseGraph({ gridLines: MAX_GRAPH_GRID_LINES + 1 }),
    ], makeContext());

    expect(result.elements).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("gridLines");
  });

  it("rejects manual X-label intervals that would create too many labels", () => {
    const result = expandGraphElements([
      baseGraph({ xLabelInterval: 0.001 }),
    ], makeContext(MAX_GRAPH_X_AXIS_LABELS + 10));

    expect(result.elements).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("xLabelInterval");
  });

  it("expands with xMin now on timestamp data", () => {
    const now = Date.now();
    const ctx = createDataContext();
    ctx.history = {
      points: [
        { t: now - 7_200_000, v: 1 },
        { t: now - 3_600_000, v: 2 },
        { t: now + 3_600_000, v: 3 },
      ],
    };
    const result = expandGraphElements([
      baseGraph({ xMin: "now", showNowMarker: true }),
    ], ctx);
    expect(result.errors).toEqual([]);
    expect(result.elements.length).toBeGreaterThan(0);
  });
});
