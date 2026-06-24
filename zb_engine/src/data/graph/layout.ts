/**
 * layout.ts — Pure math for mapping data coordinates to pixel coordinates
 *
 * This is the SINGLE SOURCE OF TRUTH for chart coordinate computation.
 * Both the server-side expander and the builder's canvas preview consume it.
 *
 * No Node.js or browser dependencies — only arithmetic on plain data.
 */

import type { GraphConfig, LayoutResult, NormalizedPoint } from "./types";

// ── Margins ────────────────────────────────────────────────────

/** Default margin in pixels reserved for axis labels and padding. */
const MARGIN_LEFT_WITH_LABELS = 32;
const MARGIN_BOTTOM_WITH_LABELS = 16;
const MARGIN_LEFT_NO_LABELS = 4;
const MARGIN_BOTTOM_NO_LABELS = 4;
const MARGIN_TOP = 4;
const MARGIN_RIGHT = 4;

// ── Nice number algorithm ──────────────────────────────────────

/**
 * Round a number to a "nice" value (1, 2, 5, 10, 20, 50, etc.) for axis labels.
 * If `round` is true, round to nearest; otherwise ceil to next nice.
 */
function niceNum(value: number, round: boolean): number {
  if (value === 0) return 0;
  const exp = Math.floor(Math.log10(Math.abs(value)));
  const frac = Math.abs(value) / Math.pow(10, exp);

  let nice: number;
  if (round) {
    nice = frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10;
  } else {
    nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  }
  return nice * Math.pow(10, exp);
}

/**
 * Compute nice Y-axis range and tick values for a given data range and divisions.
 * Returns { niceMin, niceMax, ticks[] } where ticks are evenly spaced nice values.
 */
function computeNiceTicks(
  dataMin: number,
  dataMax: number,
  divisions: number,
): { niceMin: number; niceMax: number; ticks: number[] } {
  const range = dataMax - dataMin;
  if (range === 0) {
    return { niceMin: dataMin - 0.5, niceMax: dataMax + 0.5, ticks: [dataMin] };
  }

  const tickSpacing = niceNum(range / Math.max(1, divisions), true);
  const niceMin = Math.floor(dataMin / tickSpacing) * tickSpacing;
  const niceMax = Math.ceil(dataMax / tickSpacing) * tickSpacing;

  const ticks: number[] = [];
  // Use a small epsilon to avoid floating-point overshoot
  for (let v = niceMin; v <= niceMax + tickSpacing * 0.001; v += tickSpacing) {
    // Round to avoid floating-point artifacts (e.g. 20.000000001)
    ticks.push(Math.round(v * 1e9) / 1e9);
  }

  return { niceMin, niceMax, ticks };
}

/**
 * Compute bottom margin based on X-axis label rotation.
 * Rotated labels need more vertical space below the axis.
 */
function computeBottomMargin(config: GraphConfig): number {
  if (!config.showLabels) return MARGIN_BOTTOM_NO_LABELS;
  const rotation = Math.abs(config.xLabelRotation ?? 0);
  if (rotation === 0) return MARGIN_BOTTOM_WITH_LABELS;
  // For rotated labels, reserve space based on angle and label width
  const labelWidth = 40;
  const rad = (rotation * Math.PI) / 180;
  const fontSize = config.labelFontSize ?? 10;
  return Math.round(Math.sin(rad) * labelWidth + Math.cos(rad) * fontSize) + 4;
}

// ── Layout computation ─────────────────────────────────────────

/**
 * Compute the chart layout: margins, plotting area, and data range.
 *
 * @param config  Graph element configuration (position, size, axis settings)
 * @param points  Normalized data points (x/y numeric values)
 * @returns       Layout metrics for use by chart generators and axis builder
 */
export function computeLayout(
  config: GraphConfig,
  points: NormalizedPoint[],
): LayoutResult {
  const marginLeft = config.showLabels ? MARGIN_LEFT_WITH_LABELS : MARGIN_LEFT_NO_LABELS;
  const marginBottom = computeBottomMargin(config);
  const marginTop = config.showTitle && config.titleText
    ? (config.titleFontSize ?? 10) + 4
    : MARGIN_TOP;

  const chartX = marginLeft;
  const chartY = marginTop;
  const chartWidth = Math.max(1, config.sizeX - marginLeft - MARGIN_RIGHT);
  const chartHeight = Math.max(1, config.sizeY - marginTop - marginBottom);

  // Compute data ranges from points (skip nulls for Y)
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const pt of points) {
    if (pt.x < xMin) xMin = pt.x;
    if (pt.x > xMax) xMax = pt.x;
    if (pt.y !== null) {
      if (pt.y < yMin) yMin = pt.y;
      if (pt.y > yMax) yMax = pt.y;
    }
  }

  // Handle edge cases: no points or all-null
  if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }

  // Single-value range: pad so the chart isn't a flat line at edge
  if (xMin === xMax) { xMin -= 0.5; xMax += 0.5; }
  if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }

  // Apply manual Y overrides if provided
  const hasManualYMin = config.yMin !== null && config.yMin !== undefined && Number.isFinite(config.yMin);
  const hasManualYMax = config.yMax !== null && config.yMax !== undefined && Number.isFinite(config.yMax);
  if (hasManualYMin) yMin = config.yMin as number;
  if (hasManualYMax) yMax = config.yMax as number;

  // Compute nice Y ticks. When both min and max are manual, use uniform divisions.
  const divisions = (config.showGrid && config.gridLines > 0) ? config.gridLines : 4;
  let yTicks: number[];

  if (hasManualYMin && hasManualYMax) {
    // Both manual — use uniform divisions across the fixed range
    yTicks = [];
    for (let i = 0; i <= divisions; i++) {
      const v = yMin + (i / divisions) * (yMax - yMin);
      yTicks.push(Math.round(v * 1e9) / 1e9);
    }
  } else {
    // Auto range — compute nice ticks and expand range to fit
    const nice = computeNiceTicks(yMin, yMax, divisions);
    if (!hasManualYMin) yMin = nice.niceMin;
    if (!hasManualYMax) yMax = nice.niceMax;
    yTicks = nice.ticks;
  }

  return { chartX, chartY, chartWidth, chartHeight, xMin, xMax, yMin, yMax, yTicks };
}

// ── Coordinate mapping ─────────────────────────────────────────

/**
 * Map a data X value to pixel X within the chart area.
 * The returned value is relative to the graph element's top-left pos.
 */
export function dataXToPixel(x: number, layout: LayoutResult): number {
  const range = layout.xMax - layout.xMin;
  if (range === 0) return layout.chartX;
  const t = (x - layout.xMin) / range;
  return layout.chartX + t * layout.chartWidth;
}

/**
 * Map a data Y value to pixel Y within the chart area.
 * Y is inverted: data yMax maps to chartY (top), data yMin maps to chartY + chartHeight (bottom).
 * The returned value is relative to the graph element's top-left pos.
 */
export function dataYToPixel(y: number, layout: LayoutResult): number {
  const range = layout.yMax - layout.yMin;
  if (range === 0) return layout.chartY + layout.chartHeight;
  const t = (y - layout.yMin) / range;
  return layout.chartY + layout.chartHeight - t * layout.chartHeight;
}
