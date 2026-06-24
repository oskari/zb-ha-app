/**
 * lineChart.ts — Generate line primitives from normalized data points
 *
 * Produces a single polyline element connecting all non-null data points.
 * Null values create gaps (separate line segments).
 */

import type { NormalizedPoint, LayoutResult, GraphConfig, RawElement } from "../types";
import { dataXToPixel, dataYToPixel } from "../layout";

/**
 * Generate line chart primitives.
 *
 * @param points  Normalized data points (sorted by X)
 * @param layout  Computed chart layout metrics
 * @param config  Graph element configuration
 * @returns Array of line primitives (one per contiguous segment)
 */
export function generateLineChart(
  points: NormalizedPoint[],
  layout: LayoutResult,
  config: GraphConfig,
): RawElement[] {
  if (points.length === 0) return [];

  // Split points into contiguous segments (break on null Y values)
  const segments: NormalizedPoint[][] = [];
  let current: NormalizedPoint[] = [];

  for (const pt of points) {
    if (pt.y === null) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(pt);
    }
  }
  if (current.length >= 2) segments.push(current);

  const elements: RawElement[] = [];

  for (const segment of segments) {
    const linePoints: [number, number][] = segment.map((pt) => [
      Math.round(dataXToPixel(pt.x, layout)),
      Math.round(dataYToPixel(pt.y as number, layout)),
    ]);

    elements.push({
      type: "line",
      visible: true,
      pos: { x: 0, y: 0 },
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
      opacity: config.opacity ?? 100,
      points: linePoints,
      enableStroke: true,
      strokeDither: config.lineStrokeDither,
      strokeWidth: config.lineStrokeWidth,
      strokeDash: [],
      strokeCap: "round",
      strokePosition: "center",
      strokeRadius: config.lineStrokeRadius,
    });
  }

  return elements;
}
