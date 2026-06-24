/**
 * types.ts — Shared interfaces for the graph expansion pipeline
 *
 * These types are consumed by:
 *   - Server: src/data/graph/ modules (TypeScript, direct import)
 *   - Builder: builder/src/ via Vite alias @shared/graph (for canvas preview)
 *
 * IMPORTANT: This file must remain pure — no Node.js APIs, no browser APIs,
 * no imports outside this directory. Only plain TypeScript interfaces/types.
 */

// ── Graph element configuration (stored in payload) ────────────

/** Supported chart types. New types are registered in charts/index.ts. */
export type ChartType = "line" | "bar";

/**
 * Graph element configuration as stored in the JSON payload.
 * Every property here is a rendering instruction consumed by the expander —
 * none are editor-only (satisfies ENGINEERING_CONSTRAINTS rule 9).
 */
export interface GraphConfig {
  type: "graph";

  /** Unique element identifier (round-trip fidelity). */
  id?: string;
  /** Human-readable name for the layers panel. */
  name?: string;
  /** Visibility toggle (supports bindings). */
  visible?: unknown;

  // ── Position & size ────────────────────────────────────────
  pos: { x: number; y: number };
  sizeX: number;
  sizeY: number;
  rotationDeg?: number;
  scale?: { x: number; y: number };
  origin?: { x: number; y: number };
  opacity?: number;

  // ── Chart configuration ────────────────────────────────────
  /** Which chart type to render. */
  chartType: ChartType;
  /** Source ID to read data from (key into the data context). */
  sourceId: string;
  /** Dot-path into the source data to find the data array. Empty = root. */
  dataPath: string;
  /** Dot-path within each data point to extract the Y-axis value. Empty = item itself. */
  valuePath: string;
  /** Dot-path within each data point to extract the X-axis value. Empty = use index. */
  timePath: string;
  /** Maximum number of data points to render after LTTB downsampling (10–200). */
  resolution: number;
  /** Start of the data window as a percentage (0–100). Points before this are excluded before downsampling. */
  dataRangeStart: number;
  /** End of the data window as a percentage (0–100). Points after this are excluded before downsampling. */
  dataRangeEnd: number;

  // ── Axis & grid ────────────────────────────────────────────
  /** Show axis lines (Y-left + X-bottom). */
  showAxes: boolean;
  /** Show horizontal grid lines. */
  showGrid: boolean;
  /** Number of horizontal grid divisions (e.g. 4 = 5 grid lines including top/bottom). */
  gridLines: number;
  /** Show min/max labels on Y-axis and start/end on X-axis. */
  showLabels: boolean;
  /** Font size for axis labels in pixels. */
  labelFontSize: number;
  /** Font weight for axis labels (numeric: 300=Light, 400=Regular, 600=SemiBold). */
  labelFontWeight: number;
  /** Show the X-axis end label (right side). */
  showXEndLabel: boolean;
  /** X-axis label interval in hours (0 = start+end only). */
  xLabelInterval: number;
  /** Rotation angle for X-axis labels: 0 (horizontal), 45 (diagonal), 90 (vertical). */
  xLabelRotation: number;
  /** Show date on X-axis labels when the time range exceeds 24 hours. */
  showDateLabels: boolean;

  // ── Title ──────────────────────────────────────────────────
  /** Show a title above the chart. */
  showTitle: boolean;
  /** Title text content. */
  titleText: string;
  /** Font size for the title in pixels. */
  titleFontSize: number;
  /** Font weight for the title (numeric: 300=Light, 400=Regular, 600=SemiBold). */
  titleFontWeight: number;
  /** Dither intensity (0–100) for the title text. */
  titleDither: number;

  // ── Y-axis range ───────────────────────────────────────────
  /** Manual Y minimum. null = auto-detect from data. */
  yMin: number | null;
  /** Manual Y maximum. null = auto-detect from data. */
  yMax: number | null;

  // ── Line chart styling ─────────────────────────────────────
  /** Stroke width for line chart data series. */
  lineStrokeWidth: number;
  /** Stroke dither intensity (0–100) for line chart data series. */
  lineStrokeDither: number;
  /** Rounded corners on polyline joints (0 = sharp). */
  lineStrokeRadius: number;

  // ── Bar chart styling ──────────────────────────────────────
  /** Gap in pixels between adjacent bars. */
  barGap: number;
  /** Fill dither intensity (0–100) for bars. */
  barFillDither: number;
  /** Enable stroke on bars. */
  barStrokeEnabled: boolean;
  /** Stroke dither intensity for bar outlines. */
  barStrokeDither: number;

  // ── Dither for axes/grid/labels ─────────────────────────────
  /** Stroke dither intensity for axes and grid lines (0–100). */
  axisDither: number;
  /** Stroke dither intensity for grid lines (0–100). Separate from axes. */
  gridDither: number;
  /** Dash pattern [on, off] for grid lines. */
  gridDash: [number, number];
  /** Dither intensity for axis label text (0–100). */
  labelDither: number;
}

// ── Internal pipeline types ────────────────────────────────────

/** A single data point after normalization. */
export interface NormalizedPoint {
  /** X-axis value (numeric timestamp, index, or parsed value). */
  x: number;
  /** Y-axis value (numeric). null = gap in data. */
  y: number | null;
}

/** Computed layout metrics for the chart area within the element bounds. */
export interface LayoutResult {
  /** Pixel offset of the chart area from the element's top-left corner. */
  chartX: number;
  chartY: number;
  /** Pixel dimensions of the chart plotting area. */
  chartWidth: number;
  chartHeight: number;

  /** Data range mapped to the chart area. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;

  /** Pre-computed nice Y-axis tick values (from yMin to yMax inclusive). */
  yTicks: number[];
}

/**
 * A raw element object ready for the renderer.
 * Uses generic Record to avoid importing engine types (keeps this file portable).
 */
export type RawElement = Record<string, unknown>;

/** Chart generator function signature. Registered in charts/index.ts. */
export type ChartGenerator = (
  points: NormalizedPoint[],
  layout: LayoutResult,
  config: GraphConfig,
) => RawElement[];
