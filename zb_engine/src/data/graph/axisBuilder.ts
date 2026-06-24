/**
 * axisBuilder.ts — Generate axis, grid, and label primitives
 *
 * Shared by all chart types. Produces line primitives for axes/grid
 * and text primitives for labels.
 */

import type { LayoutResult, GraphConfig, RawElement } from "./types";
import { dataXToPixel, dataYToPixel } from "./layout";

// ── Label formatting ───────────────────────────────────────────

/**
 * Format a Y-axis numeric value for display.
 * Keeps labels short: integers stay integers, floats get 1 decimal.
 */
function formatYLabel(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/**
 * Format an X-axis value for display.
 * If values look like timestamps (> 1e9), format as time or date+time
 * depending on the time range span and whether this tick is at midnight.
 *
 * When showDate is true, only midnight ticks (00:00) get the day number;
 * other ticks show time-only to reduce clipping.
 */
function formatXLabel(value: number, isTimestamp: boolean, showDate: boolean = false): string {
  if (isTimestamp) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    if (showDate && h === "00" && m === "00") {
      // Midnight tick — show just the day number as the date marker
      const day = d.getDate().toString().padStart(2, "0");
      const mon = (d.getMonth() + 1).toString().padStart(2, "0");
      return `${day}/${mon}`;
    }
    return `${h}:${m}`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/**
 * Choose a sensible auto-interval (in ms) for X-axis labels based on the time range.
 * Returns 0 if no auto-interval is appropriate.
 */
function autoXInterval(rangeMs: number, chartWidth: number): number {
  // Target: roughly one label per 50-60 pixels, minimum ~3 labels
  const maxLabels = Math.max(2, Math.floor(chartWidth / 55));

  // Candidate intervals (in ms): 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 2d
  const candidates = [
    900000,     // 15 min
    1800000,    // 30 min
    3600000,    // 1 hour
    7200000,    // 2 hours
    14400000,   // 4 hours
    21600000,   // 6 hours
    43200000,   // 12 hours
    86400000,   // 1 day
    172800000,  // 2 days
  ];

  for (const c of candidates) {
    const count = Math.floor(rangeMs / c);
    if (count <= maxLabels) return c;
  }
  return candidates[candidates.length - 1];
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Generate axis, grid, and label primitives.
 *
 * @param layout  Computed chart layout metrics
 * @param config  Graph element configuration
 * @returns Array of line and text primitives
 */
export function buildAxisElements(
  layout: LayoutResult,
  config: GraphConfig,
): RawElement[] {
  const elements: RawElement[] = [];
  const axisDither = config.axisDither;

  // ── Axis lines ─────────────────────────────────────────────

  if (config.showAxes) {
    // Y-axis (left edge of chart area)
    elements.push({
      type: "line",
      visible: true,
      pos: { x: 0, y: 0 },
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
      opacity: 100,
      points: [
        [layout.chartX, layout.chartY],
        [layout.chartX, layout.chartY + layout.chartHeight],
      ],
      enableStroke: true,
      strokeDither: axisDither,
      strokeWidth: 1,
      strokeDash: [],
      strokeCap: "butt",
      strokePosition: "center",
      strokeRadius: 0,
    });

    // X-axis (bottom edge of chart area)
    elements.push({
      type: "line",
      visible: true,
      pos: { x: 0, y: 0 },
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
      opacity: 100,
      points: [
        [layout.chartX, layout.chartY + layout.chartHeight],
        [layout.chartX + layout.chartWidth, layout.chartY + layout.chartHeight],
      ],
      enableStroke: true,
      strokeDither: axisDither,
      strokeWidth: 1,
      strokeDash: [],
      strokeCap: "butt",
      strokePosition: "center",
      strokeRadius: 0,
    });
  }

  // ── Grid lines ─────────────────────────────────────────────

  if (config.showGrid && layout.yTicks.length > 0) {
    // Draw horizontal grid lines at each interior yTick (skip min and max = axis edges)
    for (let i = 1; i < layout.yTicks.length - 1; i++) {
      const y = Math.round(dataYToPixel(layout.yTicks[i], layout));

      elements.push({
        type: "line",
        visible: true,
        pos: { x: 0, y: 0 },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        origin: { x: 0, y: 0 },
        opacity: 100,
        points: [
          [layout.chartX, y],
          [layout.chartX + layout.chartWidth, y],
        ],
        enableStroke: true,
        strokeDither: config.gridDither,
        strokeWidth: 1,
        strokeDash: config.gridDash,
        strokeCap: "butt",
        strokePosition: "center",
        strokeRadius: 0,
      });
    }
  }

  // ── Labels ─────────────────────────────────────────────────

  if (config.showLabels) {
    const fontSize = config.labelFontSize;
    const labelWeight = config.labelFontWeight;
    const labelFill = config.labelDither;

    // ── Y-axis labels at computed tick positions ───────────────

    for (let i = 0; i < layout.yTicks.length; i++) {
      const value = layout.yTicks[i];
      const y = Math.round(dataYToPixel(value, layout));
      elements.push({
        type: "text",
        visible: true,
        pos: { x: 0, y: y - Math.round(fontSize / 2) },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        origin: { x: 0, y: 0 },
        opacity: 100,
        sizeX: layout.chartX - 2,
        sizeY: fontSize + 2,
        text: formatYLabel(value),
        fallbackText: "",
        fontFamily: "Sora",
        fontSize,
        fontWeight: labelWeight,
        textAlign: "right",
        lineHeight: 1.0,
        enableFill: true,
        fill: labelFill,
      });
    }

    // ── X-axis labels ────────────────────────────────────────

    const isTimestamp = layout.xMax > 1e9;
    const rotation = config.xLabelRotation ?? 0;

    if (isTimestamp) {
      const xMinMs = layout.xMin < 1e12 ? layout.xMin * 1000 : layout.xMin;
      const xMaxMs = layout.xMax < 1e12 ? layout.xMax * 1000 : layout.xMax;
      const rangeMs = xMaxMs - xMinMs;
      // Only show date info if the range exceeds 24h AND the user has it enabled
      const showDate = rangeMs > 86400000 && config.showDateLabels !== false;

      // Determine interval: manual (hours) or auto-computed
      const manualMs = config.xLabelInterval * 3600000;
      const effectiveInterval = manualMs > 0 ? manualMs : autoXInterval(rangeMs, layout.chartWidth);
      const labelWidth = 40;

      if (effectiveInterval > 0) {
        const firstTick = Math.ceil(xMinMs / effectiveInterval) * effectiveInterval;
        for (let tick = firstTick; tick <= xMaxMs; tick += effectiveInterval) {
          const tickData = layout.xMin < 1e12 ? tick / 1000 : tick;
          const px = dataXToPixel(tickData, layout);
          if (px < layout.chartX + 4 || px > layout.chartX + layout.chartWidth - 4) continue;

          const labelText = formatXLabel(tickData, true, showDate);
          const posX = Math.round(px);
          const posY = layout.chartY + layout.chartHeight + 2;
          // For rotated labels, pivot at right edge so text extends below the axis.
          // For horizontal labels, pivot at center for symmetric centering.
          const originX = rotation === 0 ? Math.round(labelWidth / 2) : labelWidth;

          elements.push({
            type: "text",
            visible: true,
            pos: { x: posX - originX, y: posY },
            rotationDeg: rotation,
            scale: { x: 1, y: 1 },
            origin: { x: originX, y: 0 },
            opacity: 100,
            sizeX: labelWidth,
            sizeY: fontSize + 2,
            text: labelText,
            fallbackText: "",
            fontFamily: "Sora",
            fontSize,
            fontWeight: labelWeight,
            textAlign: "center",
            lineHeight: 1.0,
            enableFill: true,
            fill: labelFill,
          });
        }
      }
    } else {
      // Non-timestamp: start label + optional end label
      elements.push({
        type: "text",
        visible: true,
        pos: { x: layout.chartX, y: layout.chartY + layout.chartHeight + 2 },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        origin: { x: 0, y: 0 },
        opacity: 100,
        sizeX: config.showXEndLabel ? layout.chartWidth / 2 : layout.chartWidth,
        sizeY: fontSize + 2,
        text: formatXLabel(layout.xMin, false),
        fallbackText: "",
        fontFamily: "Sora",
        fontSize,
        fontWeight: labelWeight,
        textAlign: "left",
        lineHeight: 1.0,
        enableFill: true,
        fill: labelFill,
      });

      if (config.showXEndLabel) {
        elements.push({
          type: "text",
          visible: true,
          pos: { x: layout.chartX + layout.chartWidth / 2, y: layout.chartY + layout.chartHeight + 2 },
          rotationDeg: 0,
          scale: { x: 1, y: 1 },
          origin: { x: 0, y: 0 },
          opacity: 100,
          sizeX: layout.chartWidth / 2,
          sizeY: fontSize + 2,
          text: formatXLabel(layout.xMax, false),
          fallbackText: "",
          fontFamily: "Sora",
          fontSize,
          fontWeight: labelWeight,
          textAlign: "right",
          lineHeight: 1.0,
          enableFill: true,
          fill: labelFill,
        });
      }
    }
  }

  // ── Title ──────────────────────────────────────────────────

  if (config.showTitle && config.titleText) {
    const titleFontSize = config.titleFontSize;
    elements.push({
      type: "text",
      visible: true,
      pos: { x: layout.chartX, y: 0 },
      rotationDeg: 0,
      scale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
      opacity: 100,
      sizeX: layout.chartWidth,
      sizeY: titleFontSize + 2,
      text: config.titleText,
      fallbackText: "",
      fontFamily: "Sora",
      fontSize: titleFontSize,
      fontWeight: config.titleFontWeight,
      textAlign: "left",
      lineHeight: 1.0,
      enableFill: true,
      fill: config.titleDither,
    });
  }

  return elements;
}
