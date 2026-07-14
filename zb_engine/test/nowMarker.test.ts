/**
 * nowMarker.test.ts — Vertical now marker primitive generation
 */

import { describe, it, expect } from "vitest";
import { buildNowMarkerElements } from "../src/data/graph/nowMarker";
import type { GraphConfig, LayoutResult } from "../src/data/graph/types";

function baseLayout(overrides: Partial<LayoutResult> = {}): LayoutResult {
  return {
    chartX: 32,
    chartY: 4,
    chartWidth: 200,
    chartHeight: 100,
    xMin: 1_700_000_000_000,
    xMax: 1_700_086_400_000,
    yMin: 0,
    yMax: 10,
    yTicks: [0, 5, 10],
    ...overrides,
  };
}

function baseConfig(overrides: Partial<GraphConfig> = {}): GraphConfig {
  return {
    type: "graph",
    pos: { x: 0, y: 0 },
    sizeX: 240,
    sizeY: 120,
    chartType: "line",
    sourceId: "s",
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
    labelFontSize: 10,
    labelFontWeight: 400,
    showXEndLabel: false,
    xLabelInterval: 0,
    xLabelRotation: 0,
    showDateLabels: true,
    showTitle: false,
    titleText: "",
    titleFontSize: 10,
    titleFontWeight: 600,
    titleDither: 100,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    showNowMarker: true,
    nowMarkerDither: 60,
    nowMarkerDash: [2, 2],
    nowMarkerStrokeWidth: 1,
    lineStrokeWidth: 2,
    lineStrokeDither: 100,
    lineStrokeRadius: 0,
    barGap: 2,
    barFillDither: 100,
    barStrokeEnabled: false,
    barStrokeDither: 100,
    axisDither: 100,
    gridDither: 40,
    gridDash: [2, 3],
    labelDither: 100,
    ...overrides,
  };
}

describe("buildNowMarkerElements", () => {
  const nowMs = 1_700_043_200_000; // within default layout range

  it("returns empty when showNowMarker is false", () => {
    expect(buildNowMarkerElements(baseLayout(), baseConfig({ showNowMarker: false }), nowMs)).toEqual([]);
  });

  it("returns empty for index-based axis", () => {
    expect(buildNowMarkerElements(baseLayout({ xMax: 10 }), baseConfig(), nowMs)).toEqual([]);
  });

  it("returns empty when now is outside visible range", () => {
    expect(
      buildNowMarkerElements(
        baseLayout({ xMin: nowMs + 1000, xMax: nowMs + 2000 }),
        baseConfig(),
        nowMs,
      ),
    ).toEqual([]);
  });

  it("emits a vertical line when now is inside range", () => {
    const els = buildNowMarkerElements(baseLayout(), baseConfig(), nowMs);
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe("line");
    const pts = els[0].points as [number, number][];
    expect(pts[0][1]).toBe(4);
    expect(pts[1][1]).toBe(104);
    expect(pts[0][0]).toBe(pts[1][0]);
  });
});
