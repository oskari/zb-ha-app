/**
 * GraphPreview.jsx — Konva component for rendering graph elements on the builder canvas
 *
 * Uses the shared graph math modules (@shared/graph) to compute layout and
 * coordinates, then draws chart primitives using Konva shapes. This provides
 * a WYSIWYG preview that mirrors what the server-side expander produces.
 *
 * When no source data is available, renders a placeholder outline.
 */

import { Line, Rect, Text } from 'react-konva';
import BitmapText from '../components/BitmapText.jsx';
import { roundPolyline } from '../utils/polyline.js';
import { computeLayout, dataXToPixel, dataYToPixel } from '@shared/graph/layout';
import { normalizeDataPoints } from '@shared/graph/normalizer';

// ── Helpers ────────────────────────────────────────────────────

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ditherToGray(percent) {
  const n = Number(percent);
  const t = clamp01((Number.isFinite(n) ? n : 0) / 100);
  const v = Math.round(255 * (1 - t));
  return `rgb(${v} ${v} ${v})`;
}

// ── Chart renderers ────────────────────────────────────────────

function renderLineChart(points, layout, config) {
  if (points.length === 0) return null;

  // Split into contiguous segments (break on null Y)
  const segments = [];
  let current = [];
  for (const pt of points) {
    if (pt.y === null) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(pt);
    }
  }
  if (current.length >= 2) segments.push(current);

  return segments.map((seg, i) => {
    const pixelPts = seg.map((pt) => ({
      x: Math.round(dataXToPixel(pt.x, layout)),
      y: Math.round(dataYToPixel(pt.y, layout)),
    }));
    // Match the engine: lineChart sets strokeRadius = lineStrokeRadius, which the
    // line primitive applies via roundPolyline (rounded polyline corners).
    const shaped = config.lineStrokeRadius > 0 && pixelPts.length > 2
      ? roundPolyline(pixelPts, config.lineStrokeRadius)
      : pixelPts;
    const flatPoints = shaped.flatMap((p) => [p.x, p.y]);

    return (
      <Line
        key={`seg-${i}`}
        points={flatPoints}
        stroke={ditherToGray(config.lineStrokeDither)}
        strokeWidth={config.lineStrokeWidth}
        lineCap="round"
        lineJoin="round"
        // Engine applies the element opacity to the data series only (lineChart.ts).
        opacity={config.opacity / 100}
        listening={false}
      />
    );
  });
}

function renderBarChart(points, layout, config) {
  if (points.length === 0) return null;

  const gap = config.barGap;
  const n = points.length;
  // stride = chartWidth / n distributes bars evenly; barWidth = stride - gap,
  // clamped to a 1px minimum. The configured gap (config.barGap) is constant.
  const stride = n > 1
    ? Math.max(1, Math.floor(layout.chartWidth / n))
    : layout.chartWidth;
  const barWidth = Math.max(1, stride - gap);
  const baselineY = dataYToPixel(Math.max(layout.yMin, 0), layout);

  return points.map((pt, i) => {
    const value = pt.y ?? 0;
    const topY = dataYToPixel(value, layout);
    const barHeight = Math.max(0, Math.abs(baselineY - topY));
    const barY = Math.min(topY, baselineY);
    const barX = layout.chartX + i * stride;
    // The engine strokes bars INSIDE (barChart.ts strokePosition:'inside'). Konva
    // strokes are centered, so inset by half the 1px stroke to keep it inside —
    // but only for bars wide/tall enough to survive it, so thin/short bars the
    // engine still renders don't collapse to nothing.
    const inset = config.barStrokeEnabled && barWidth > 1 && barHeight > 1 ? 0.5 : 0;

    return (
      <Rect
        key={`bar-${i}`}
        x={barX + inset}
        y={barY + inset}
        width={barWidth - 2 * inset}
        height={barHeight - 2 * inset}
        fill={ditherToGray(config.barFillDither)}
        stroke={config.barStrokeEnabled ? ditherToGray(config.barStrokeDither) : undefined}
        strokeWidth={config.barStrokeEnabled ? 1 : 0}
        // Engine applies the element opacity to the data series only (barChart.ts).
        opacity={config.opacity / 100}
        listening={false}
      />
    );
  });
}

// ── Axes / Grid / Labels ───────────────────────────────────────

function renderAxes(layout, config) {
  const elements = [];
  const axisColor = ditherToGray(config.axisDither);

  if (config.showAxes) {
    // Y-axis
    elements.push(
      <Line
        key="y-axis"
        points={[layout.chartX, layout.chartY, layout.chartX, layout.chartY + layout.chartHeight]}
        stroke={axisColor}
        strokeWidth={1}
        listening={false}
      />,
    );
    // X-axis
    elements.push(
      <Line
        key="x-axis"
        points={[
          layout.chartX, layout.chartY + layout.chartHeight,
          layout.chartX + layout.chartWidth, layout.chartY + layout.chartHeight,
        ]}
        stroke={axisColor}
        strokeWidth={1}
        listening={false}
      />,
    );
  }

  if (config.showGrid && layout.yTicks && layout.yTicks.length > 0) {
    const gridColor = ditherToGray(config.gridDither);
    // Draw grid at interior ticks (skip first and last = axis edges)
    for (let i = 1; i < layout.yTicks.length - 1; i++) {
      const y = Math.round(dataYToPixel(layout.yTicks[i], layout));
      elements.push(
        <Line
          key={`grid-${i}`}
          points={[layout.chartX, y, layout.chartX + layout.chartWidth, y]}
          stroke={gridColor}
          strokeWidth={1}
          dash={config.gridDash}
          listening={false}
        />,
      );
    }
  }

  if (config.showLabels) {
    const fontSize = config.labelFontSize;
    const labelWeight = String(config.labelFontWeight ?? 400);
    const labelColor = ditherToGray(config.labelDither);

    // ── Y-axis labels at computed tick positions ─────────────

    const ticks = layout.yTicks || [];
    for (let i = 0; i < ticks.length; i++) {
      const value = ticks[i];
      const y = Math.round(dataYToPixel(value, layout));
      elements.push(
        <BitmapText
          key={`y-${i}`}
          x={0}
          y={y - Math.round(fontSize / 2)}
          width={layout.chartX - 2}
          height={fontSize + 2}
          text={formatYLabel(value)}
          fontSize={fontSize}
          fontFamily="Sora"
          fontWeight={Number(labelWeight)}
          align="right"
          fill={labelColor}
          listening={false}
        />,
      );
    }

    // ── X-axis labels ────────────────────────────────────────

    // Match the engine's timestamp detection exactly (axisBuilder.ts uses xMax),
    // otherwise canvas x-axis labels can disagree with the rendered preview.
    const isTimestamp = layout.xMax > 1e9;
    const rotation = config.xLabelRotation ?? 0;

    if (isTimestamp) {
      const xMinMs = layout.xMin < 1e12 ? layout.xMin * 1000 : layout.xMin;
      const xMaxMs = layout.xMax < 1e12 ? layout.xMax * 1000 : layout.xMax;
      const rangeMs = xMaxMs - xMinMs;
      const showDate = rangeMs > 86400000 && config.showDateLabels !== false;

      const manualMs = config.xLabelInterval * 3600000;
      const effectiveInterval = manualMs > 0 ? manualMs : autoXInterval(rangeMs, layout.chartWidth);
      const labelWidth = 40;

      if (effectiveInterval > 0) {
        const firstTick = Math.ceil(xMinMs / effectiveInterval) * effectiveInterval;
        for (let tick = firstTick; tick <= xMaxMs; tick += effectiveInterval) {
          const tickData = layout.xMin < 1e12 ? tick / 1000 : tick;
          const px = dataXToPixel(tickData, layout);
          if (px < layout.chartX + 4 || px > layout.chartX + layout.chartWidth - 4) continue;

          const posX = Math.round(px);
          const posY = layout.chartY + layout.chartHeight + 2;
          // For rotated labels, pivot at right edge so text extends below the axis.
          // For horizontal labels, pivot at center for symmetric centering.
          const pivotX = rotation === 0 ? Math.round(labelWidth / 2) : labelWidth;

          elements.push(
            <BitmapText
              key={`x-${tick}`}
              x={posX}
              y={posY}
              width={labelWidth}
              height={fontSize + 2}
              text={formatXLabel(tickData, true, showDate)}
              fontSize={fontSize}
              fontFamily="Sora"
              fontWeight={Number(labelWeight)}
              align="center"
              fill={labelColor}
              listening={false}
              rotation={rotation}
              offsetX={pivotX}
              offsetY={0}
            />,
          );
        }
      }
    } else {
      elements.push(
        <BitmapText
          key="x-start"
          x={layout.chartX}
          y={layout.chartY + layout.chartHeight + 2}
          width={config.showXEndLabel ? layout.chartWidth / 2 : layout.chartWidth}
          height={fontSize + 2}
          text={formatXLabel(layout.xMin, false)}
          fontSize={fontSize}
          fontFamily="Sora"
          fontWeight={Number(labelWeight)}
          align="left"
          fill={labelColor}
          listening={false}
        />,
      );

      if (config.showXEndLabel) {
        elements.push(
          <BitmapText
            key="x-end"
            x={layout.chartX + layout.chartWidth / 2}
            y={layout.chartY + layout.chartHeight + 2}
            width={layout.chartWidth / 2}
            height={fontSize + 2}
            text={formatXLabel(layout.xMax, false)}
            fontSize={fontSize}
            fontFamily="Sora"
            fontWeight={Number(labelWeight)}
            align="right"
            fill={labelColor}
            listening={false}
          />,
        );
      }
    }
  }

  // ── Title ──────────────────────────────────────────────────

  if (config.showTitle && config.titleText) {
    elements.push(
      <BitmapText
        key="title"
        x={layout.chartX}
        y={0}
        width={layout.chartWidth}
        height={config.titleFontSize + 2}
        text={config.titleText}
        fontSize={config.titleFontSize}
        fontFamily="Sora"
        fontWeight={config.titleFontWeight ?? 600}
        align="left"
        fill={ditherToGray(config.titleDither)}
        listening={false}
      />,
    );
  }

  return elements;
}

function formatYLabel(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function formatXLabel(value, isTimestamp, showDate = false) {
  if (isTimestamp) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    if (showDate && h === '00' && m === '00') {
      // Midnight tick — show just the day number as the date marker
      const day = d.getDate().toString().padStart(2, '0');
      const mon = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${day}/${mon}`;
    }
    return `${h}:${m}`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function autoXInterval(rangeMs, chartWidth) {
  const maxLabels = Math.max(2, Math.floor(chartWidth / 55));
  const candidates = [
    900000, 1800000, 3600000, 7200000, 14400000,
    21600000, 43200000, 86400000, 172800000,
  ];
  for (const c of candidates) {
    if (Math.floor(rangeMs / c) <= maxLabels) return c;
  }
  return candidates[candidates.length - 1];
}

// ── Placeholder ────────────────────────────────────────────────

function renderPlaceholder(config) {
  return (
    <>
      <Rect
        x={0}
        y={0}
        width={config.sizeX}
        height={config.sizeY}
        fill="transparent"
      />
      <Rect
        x={0}
        y={0}
        width={config.sizeX}
        height={config.sizeY}
        stroke="#999"
        strokeWidth={1}
        dash={[4, 4]}
        listening={false}
      />
      <Text
        x={0}
        y={config.sizeY / 2 - 7}
        width={config.sizeX}
        height={14}
        text={config.sourceId ? `📊 ${config.chartType}` : '📊 No source'}
        fontSize={12}
        fontFamily="sans-serif"
        align="center"
        fill="#999"
        listening={false}
      />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────

/**
 * Render a graph element preview on the Konva canvas.
 *
 * @param {object} props
 * @param {object} props.element  The graph element from the document
 * @param {object} props.sourceData  Resolved source data object (or null)
 */
export default function GraphPreview({ element, sourceData }) {
  const config = {
    sizeX: element.sizeX ?? 280,
    sizeY: element.sizeY ?? 160,
    chartType: element.chartType ?? 'line',
    sourceId: element.sourceId ?? '',
    dataPath: element.dataPath ?? '',
    valuePath: element.valuePath ?? '',
    timePath: element.timePath ?? '',
    showAxes: element.showAxes ?? true,
    showGrid: element.showGrid ?? true,
    gridLines: element.gridLines ?? 4,
    showLabels: element.showLabels ?? true,
    labelFontSize: element.labelFontSize ?? 10,
    labelFontWeight: element.labelFontWeight ?? 400,
    yMin: element.yMin ?? null,
    yMax: element.yMax ?? null,
    lineStrokeWidth: element.lineStrokeWidth ?? 2,
    lineStrokeDither: element.lineStrokeDither ?? 100,
    lineStrokeRadius: element.lineStrokeRadius ?? 0,
    barGap: element.barGap ?? 2,
    barFillDither: element.barFillDither ?? 100,
    barStrokeEnabled: element.barStrokeEnabled ?? false,
    barStrokeDither: element.barStrokeDither ?? 100,
    axisDither: element.axisDither ?? 100,
    gridDither: element.gridDither ?? 40,
    gridDash: element.gridDash ?? [2, 3],
    labelDither: element.labelDither ?? 100,
    showXEndLabel: element.showXEndLabel ?? false,
    xLabelInterval: element.xLabelInterval ?? 0,
    xLabelRotation: element.xLabelRotation ?? 0,
    showDateLabels: element.showDateLabels ?? true,
    showTitle: element.showTitle ?? false,
    titleText: element.titleText ?? '',
    titleFontSize: element.titleFontSize ?? 10,
    titleFontWeight: element.titleFontWeight ?? 600,
    titleDither: element.titleDither ?? 100,
    opacity: element.opacity ?? 100,
    resolution: element.resolution ?? 100,
    dataRangeStart: element.dataRangeStart ?? 0,
    dataRangeEnd: element.dataRangeEnd ?? 100,
  };

  // No source data → show placeholder
  if (!sourceData) {
    return renderPlaceholder(config);
  }

  // Normalize data points
  const points = normalizeDataPoints(sourceData, config.dataPath, config.valuePath, config.timePath, config.resolution, config.dataRangeStart, config.dataRangeEnd);

  if (points.length === 0) {
    return renderPlaceholder(config);
  }

  // Compute layout
  const layout = computeLayout(config, points);

  // Render chart + axes
  const chartContent =
    config.chartType === 'bar'
      ? renderBarChart(points, layout, config)
      : renderLineChart(points, layout, config);

  const axisContent = renderAxes(layout, config);

  return (
    <>
      {/* Hit area — must be listening so the parent Group receives clicks/drags */}
      <Rect
        x={0}
        y={0}
        width={config.sizeX}
        height={config.sizeY}
        fill="transparent"
      />
      {axisContent}
      {chartContent}
    </>
  );
}
