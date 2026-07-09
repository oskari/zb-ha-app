/**
 * CalendarListPreview.jsx — Konva preview for calendarList elements
 */

import { Rect, Text } from 'react-konva';
import BitmapText from '../components/BitmapText.jsx';
import { getCalendarListLayoutMetrics } from './calendarListBounds.js';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CalendarListPreview({ element, sourceData }) {
  const { width, height, lineHeight, maxLines, layout, blockHeight } = getCalendarListLayoutMetrics(element);
  const fontSize = num(element.fontSize, 16);
  const fontWeight = num(element.fontWeight, 400);
  const subtitleFontSizeRaw = num(element.subtitleFontSize, 0);
  const subtitleFontSize = subtitleFontSizeRaw > 0 ? subtitleFontSizeRaw : Math.max(8, fontSize - 2);
  const emptyText = typeof element.emptyText === 'string' ? element.emptyText : 'Ei tulevia tapahtumia';
  const fill = num(element.fill, 100);
  const opacity = num(element.opacity, 100) / 100;

  const events = Array.isArray(sourceData?.events) ? sourceData.events : [];
  const eventCount = events.length === 0 ? 1 : Math.min(maxLines, events.length);

  const rows = [];
  for (let i = 0; i < eventCount; i++) {
    const y = i * blockHeight;

    if (events.length === 0) {
      rows.push(
        <BitmapText
          key={`cal-empty-${i}`}
          x={0}
          y={y}
          text={emptyText}
          fontSize={fontSize}
          fontWeight={fontWeight}
          fill={fill}
          opacity={opacity}
          listening={false}
        />,
      );
      continue;
    }

    const event = events[i];
    const label = event?.label ?? '';
    const subtitle = event?.subtitle ?? '';

    if (label) {
      rows.push(
        <BitmapText
          key={`cal-label-${i}`}
          x={0}
          y={y}
          text={label}
          fontSize={fontSize}
          fontWeight={fontWeight}
          fill={fill}
          opacity={opacity}
          listening={false}
        />,
      );
    }

    if (layout === 'card' && subtitle) {
      rows.push(
        <BitmapText
          key={`cal-sub-${i}`}
          x={0}
          y={y + lineHeight}
          text={subtitle}
          fontSize={subtitleFontSize}
          fontWeight={300}
          fill={fill}
          opacity={opacity * 0.85}
          listening={false}
        />,
      );
    }
  }

  if (rows.length === 0) {
    rows.push(
      <Text
        key="cal-fallback"
        x={0}
        y={0}
        width={width}
        text={emptyText}
        fontSize={fontSize}
        fontStyle={fontWeight >= 600 ? 'bold' : 'normal'}
        opacity={opacity}
        listening={false}
      />,
    );
  }

  return (
    <>
      <Rect x={0} y={0} width={width} height={height} fill="transparent" />
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        stroke="#999"
        strokeWidth={1}
        dash={[4, 4]}
        listening={false}
      />
      {rows}
    </>
  );
}
