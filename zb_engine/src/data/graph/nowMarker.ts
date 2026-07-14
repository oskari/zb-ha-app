/**
 * nowMarker.ts — Vertical "now" reference line for timestamp-based graphs
 */

import type { GraphConfig, LayoutResult, RawElement } from "./types";
import { dataXToPixel } from "./layout";
import { TIMESTAMP_X_THRESHOLD } from "./xBounds";

/**
 * Build a vertical dashed line at the current time when it falls within the
 * visible X range. Returns an empty array when the marker should not render.
 */
export function buildNowMarkerElements(
  layout: LayoutResult,
  config: GraphConfig,
  nowMs: number,
): RawElement[] {
  if (!config.showNowMarker) return [];
  if (layout.xMax <= TIMESTAMP_X_THRESHOLD) return [];

  const nowX = layout.xMax < 1e12 ? nowMs / 1000 : nowMs;
  if (nowX < layout.xMin || nowX > layout.xMax) return [];

  const px = Math.round(dataXToPixel(nowX, layout));

  return [{
    type: "line",
    visible: true,
    pos: { x: 0, y: 0 },
    rotationDeg: 0,
    scale: { x: 1, y: 1 },
    origin: { x: 0, y: 0 },
    opacity: 100,
    points: [
      [px, layout.chartY],
      [px, layout.chartY + layout.chartHeight],
    ],
    enableStroke: true,
    strokeDither: config.nowMarkerDither,
    strokeWidth: config.nowMarkerStrokeWidth,
    strokeDash: config.nowMarkerDash,
    strokeCap: "butt",
    strokePosition: "center",
    strokeRadius: 0,
  }];
}
