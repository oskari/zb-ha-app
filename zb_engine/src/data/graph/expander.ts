/**
 * expander.ts — Graph expansion orchestrator
 *
 * Converts graph elements into arrays of primitive elements (line, rect, text).
 * Called in the render pipeline AFTER sources are fetched but BEFORE elements
 * are passed to the renderer.
 *
 * The renderer never sees a "graph" type — only the expanded primitives.
 */

import { resolveValue, type DataContext } from "@zb/expressions";
import { logError } from "../../core/logger";
import type { GraphConfig, NormalizedPoint, RawElement } from "./types";
import { normalizeDataPoints } from "./normalizer";
import { computeLayout } from "./layout";
import { buildAxisElements } from "./axisBuilder";
import { getChartGenerator } from "./charts/index";
import {
  MAX_GRAPH_GRID_LINES,
  MAX_GRAPH_X_AXIS_LABELS,
} from "../../limits";

// ── Helpers ────────────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function str(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  return fallback;
}

function assertGraphPreflight(config: GraphConfig): void {
  if (config.showGrid && config.gridLines > MAX_GRAPH_GRID_LINES) {
    throw new Error(
      `gridLines (${config.gridLines}) exceeds the ${MAX_GRAPH_GRID_LINES} limit`,
    );
  }
}

function assertXAxisLabelBudget(config: GraphConfig, layout: ReturnType<typeof computeLayout>): void {
  if (!config.showLabels || config.xLabelInterval <= 0 || layout.xMax <= 1e9) return;

  const xMinMs = layout.xMin < 1e12 ? layout.xMin * 1000 : layout.xMin;
  const xMaxMs = layout.xMax < 1e12 ? layout.xMax * 1000 : layout.xMax;
  const intervalMs = config.xLabelInterval * 3_600_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

  const firstTick = Math.ceil(xMinMs / intervalMs) * intervalMs;
  const labelCount = firstTick > xMaxMs
    ? 0
    : Math.floor((xMaxMs - firstTick) / intervalMs) + 1;

  if (labelCount > MAX_GRAPH_X_AXIS_LABELS) {
    throw new Error(
      `xLabelInterval (${config.xLabelInterval}h) would create ${labelCount} labels, exceeding the ${MAX_GRAPH_X_AXIS_LABELS} limit`,
    );
  }
}

/**
 * Resolve a graph element's raw config (which may contain bindings)
 * into a concrete GraphConfig with all values evaluated.
 */
function resolveGraphConfig(
  raw: Record<string, unknown>,
  ctx: DataContext,
): GraphConfig {
  return {
    type: "graph",
    id: typeof raw.id === "string" ? raw.id : undefined,
    name: typeof raw.name === "string" ? raw.name : undefined,
    visible: resolveValue(raw.visible, ctx),

    pos: {
      x: num(resolveValue((raw.pos as Record<string, unknown>)?.x, ctx), 0),
      y: num(resolveValue((raw.pos as Record<string, unknown>)?.y, ctx), 0),
    },
    sizeX: num(resolveValue(raw.sizeX, ctx), 200),
    sizeY: num(resolveValue(raw.sizeY, ctx), 120),
    rotationDeg: num(resolveValue(raw.rotationDeg, ctx), 0),
    scale: {
      x: num(resolveValue((raw.scale as Record<string, unknown>)?.x, ctx), 1),
      y: num(resolveValue((raw.scale as Record<string, unknown>)?.y, ctx), 1),
    },
    origin: {
      x: num(resolveValue((raw.origin as Record<string, unknown>)?.x, ctx), 0),
      y: num(resolveValue((raw.origin as Record<string, unknown>)?.y, ctx), 0),
    },
    opacity: num(resolveValue(raw.opacity, ctx), 100),

    chartType: str(resolveValue(raw.chartType, ctx), "line") as GraphConfig["chartType"],
    sourceId: str(resolveValue(raw.sourceId, ctx), ""),
    dataPath: str(resolveValue(raw.dataPath, ctx), "points"),
    valuePath: str(resolveValue(raw.valuePath, ctx), "v"),
    timePath: str(resolveValue(raw.timePath, ctx), "t"),
    resolution: num(resolveValue(raw.resolution, ctx), 100),
    dataRangeStart: num(resolveValue(raw.dataRangeStart, ctx), 0),
    dataRangeEnd: num(resolveValue(raw.dataRangeEnd, ctx), 100),

    showAxes: bool(resolveValue(raw.showAxes, ctx), true),
    showGrid: bool(resolveValue(raw.showGrid, ctx), true),
    gridLines: num(resolveValue(raw.gridLines, ctx), 4),
    showLabels: bool(resolveValue(raw.showLabels, ctx), true),
    labelFontSize: num(resolveValue(raw.labelFontSize, ctx), 10),
    labelFontWeight: num(resolveValue(raw.labelFontWeight, ctx), 400),
    showXEndLabel: bool(resolveValue(raw.showXEndLabel, ctx), false),
    xLabelInterval: num(resolveValue(raw.xLabelInterval, ctx), 0),
    xLabelRotation: num(resolveValue(raw.xLabelRotation, ctx), 0),
    showDateLabels: bool(resolveValue(raw.showDateLabels, ctx), true),

    showTitle: bool(resolveValue(raw.showTitle, ctx), false),
    titleText: str(resolveValue(raw.titleText, ctx), ""),
    titleFontSize: num(resolveValue(raw.titleFontSize, ctx), 10),
    titleFontWeight: num(resolveValue(raw.titleFontWeight, ctx), 600),
    titleDither: num(resolveValue(raw.titleDither, ctx), 100),

    yMin: raw.yMin !== null && raw.yMin !== undefined
      ? num(resolveValue(raw.yMin, ctx), 0)
      : null,
    yMax: raw.yMax !== null && raw.yMax !== undefined
      ? num(resolveValue(raw.yMax, ctx), 0)
      : null,

    lineStrokeWidth: num(resolveValue(raw.lineStrokeWidth, ctx), 2),
    lineStrokeDither: num(resolveValue(raw.lineStrokeDither, ctx), 100),
    lineStrokeRadius: num(resolveValue(raw.lineStrokeRadius, ctx), 0),

    barGap: num(resolveValue(raw.barGap, ctx), 2),
    barFillDither: num(resolveValue(raw.barFillDither, ctx), 100),
    barStrokeEnabled: bool(resolveValue(raw.barStrokeEnabled, ctx), false),
    barStrokeDither: num(resolveValue(raw.barStrokeDither, ctx), 100),

    axisDither: num(resolveValue(raw.axisDither, ctx), 100),
    gridDither: num(resolveValue(raw.gridDither, ctx), 40),
    gridDash: (() => {
      const resolved = resolveValue(raw.gridDash, ctx);
      if (Array.isArray(resolved) && resolved.length === 2) {
        const a = Number(resolved[0]);
        const b = Number(resolved[1]);
        if (Number.isFinite(a) && Number.isFinite(b)) return [a, b] as [number, number];
      }
      return [2, 3] as [number, number];
    })(),
    labelDither: num(resolveValue(raw.labelDither, ctx), 100),
  };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Expand a single graph element into an array of primitive elements.
 *
 * @param raw  The raw graph element object from the payload
 * @param ctx  The data context (with features + fetched source data)
 * @returns Array of primitive element objects (line, rect, text)
 */
function expandGraphElement(
  raw: Record<string, unknown>,
  ctx: DataContext,
): RawElement[] {
  const config = resolveGraphConfig(raw, ctx);

  assertGraphPreflight(config);

  // Check visibility
  if (config.visible === false) return [];

  // Look up source data from context
  const sourceData = config.sourceId ? ctx[config.sourceId] : undefined;
  if (!sourceData) {
    // No source data available — return empty (nothing to render)
    return [];
  }

  // Normalize raw data into points (downsampled to config.resolution)
  const points: NormalizedPoint[] = normalizeDataPoints(
    sourceData,
    config.dataPath,
    config.valuePath,
    config.timePath,
    config.resolution,
    config.dataRangeStart,
    config.dataRangeEnd,
  );

  if (points.length === 0) return [];

  // Compute layout
  const layout = computeLayout(config, points);
  assertXAxisLabelBudget(config, layout);

  // Generate chart-specific primitives
  const generator = getChartGenerator(config.chartType);
  if (!generator) return [];

  const chartElements = generator(points, layout, config);

  // Generate axis and label primitives
  const axisElements = buildAxisElements(layout, config);

  // Combine: axes first (background), then chart data (foreground)
  // Offset all primitives by the graph element's position
  const allElements = [...axisElements, ...chartElements];

  for (const el of allElements) {
    if (el.pos && typeof el.pos === "object") {
      const pos = el.pos as { x: number; y: number };
      pos.x += config.pos.x;
      pos.y += config.pos.y;
    }
    // For line elements, offset all points
    if (el.type === "line" && Array.isArray(el.points)) {
      el.points = (el.points as [number, number][]).map(([x, y]) => [
        x + config.pos.x,
        y + config.pos.y,
      ]);
      // Lines use pos as an additional offset; reset it since we baked coords
      el.pos = { x: 0, y: 0 };
    }
  }

  return allElements;
}

/** Result of graph expansion, including any errors for elements that failed. */
export interface ExpandResult {
  elements: Record<string, unknown>[];
  errors: string[];
}

/**
 * Expand all graph elements in an elements array.
 * Non-graph elements pass through unchanged.
 *
 * @param elements  Raw elements array from the payload
 * @param ctx       The data context (with features + fetched source data)
 * @returns Expanded elements and any expansion errors
 */
export function expandGraphElements(
  elements: Record<string, unknown>[],
  ctx: DataContext,
): ExpandResult {
  const result: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const el of elements) {
    if (el.type === "graph") {
      try {
        const expanded = expandGraphElement(el, ctx);
        result.push(...expanded);
      } catch (err) {
        const id = typeof el.id === "string" ? el.id : typeof el.name === "string" ? el.name : "unknown";
        const message = err instanceof Error ? err.message : String(err);
        logError("graph.expand.failure", { id, error: err });
        errors.push(`Graph "${id}": ${message}`);
      }
    } else {
      result.push(el);
    }
  }

  return { elements: result, errors };
}
