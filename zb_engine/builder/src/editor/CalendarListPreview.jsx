/**
 * CalendarListPreview.jsx — Konva preview for calendarList elements
 */

import { Rect, Text } from 'react-konva';
import BitmapText from '../components/BitmapText.jsx';
import { getCalendarListLayoutMetrics } from './calendarListBounds.js';
import { buildCalendarListRows } from './calendarListLayout.js';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CalendarListPreview({ element, sourceData }) {
  const events = Array.isArray(sourceData?.events) ? sourceData.events : [];
  const { width, lineHeight, maxLines } = getCalendarListLayoutMetrics(element, events);
  const fontSize = num(element.fontSize, 12);
  const fontWeight = num(element.fontWeight, 400);
  const emptyText = typeof element.emptyText === 'string' ? element.emptyText : 'Ei tulevia tapahtumia';
  const fill = num(element.fill, 100);
  const opacity = num(element.opacity, 100) / 100;

  const rows = events.length === 0
    ? [{ kind: 'standalone', text: emptyText, fontWeight }]
    : buildCalendarListRows(events, maxLines);

  const previewRows = rows.map((row, index) => {
    const y = index * lineHeight;
    const weight = row.fontWeight > 0 ? row.fontWeight : fontWeight;
    return (
      <BitmapText
        key={`cal-row-${index}-${row.kind}`}
        x={0}
        y={y}
        text={row.text}
        fontSize={fontSize}
        fontWeight={weight}
        fill={fill}
        opacity={opacity}
        listening={false}
      />
    );
  });

  const height = lineHeight * Math.max(previewRows.length, 1);

  if (previewRows.length === 0) {
    previewRows.push(
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
      {previewRows}
    </>
  );
}
