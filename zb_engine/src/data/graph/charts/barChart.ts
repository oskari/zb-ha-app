/**
 * barChart.ts — Generate rect primitives for bar chart visualization
 *
 * Produces one rect element per data point, sized proportionally to value.
 * Null values produce zero-height bars (visible as a baseline marker).
 */

import type { NormalizedPoint, LayoutResult, GraphConfig, RawElement } from "../types";
import { dataYToPixel } from "../layout";

/**
 * Generate bar chart primitives.
 *
 * @param points  Normalized data points (sorted by X)
 * @param layout  Computed chart layout metrics
 * @param config  Graph element configuration
 * @returns Array of rect primitives (one per data point)
 */
export function generateBarChart(
  points: NormalizedPoint[],
  layout: LayoutResult,
  config: GraphConfig,
): RawElement[] {
  if (points.length === 0) return [];

  const gap = config.barGap;
  const n = points.length;
  // stride = chartWidth / n distributes bars evenly; barWidth = stride - gap,
  // clamped to a 1px minimum. The configured gap (config.barGap) is constant.
  const stride = n > 1
    ? Math.max(1, Math.floor(layout.chartWidth / n))
    : layout.chartWidth;
  const barWidth = Math.max(1, stride - gap);
  const baselineY = dataYToPixel(Math.max(layout.yMin, 0), layout);

  const elements: RawElement[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const value = pt.y ?? 0;

    const topY = dataYToPixel(value, layout);
    const barHeight = Math.max(0, Math.abs(baselineY - topY));
    const barY = Math.min(topY, baselineY);

    // Distribute bars evenly across chart width
    const barX = layout.chartX + i * stride;

    elements.push({
      type: "rect",
      visible: true,
      pos: { x: barX, y: barY },
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
      opacity: config.opacity ?? 100,
      sizeX: barWidth,
      sizeY: barHeight,
      enableFill: true,
      fill: config.barFillDither,
      enableStroke: config.barStrokeEnabled,
      strokeDither: config.barStrokeDither,
      strokeWidth: 1,
      strokeDash: [],
      strokeCap: "butt",
      strokePosition: "inside",
      strokeRadius: 0,
    });
  }

  return elements;
}
