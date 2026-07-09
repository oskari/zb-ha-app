/**
 * CalendarListPreview.jsx — Konva preview for calendarList elements
 */

import { Rect, Text } from 'react-konva';
import BitmapText from '../components/BitmapText.jsx';
import { getCalendarListBounds } from './calendarListBounds.js';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CalendarListPreview({ element, sourceData }) {
  const { width, height } = getCalendarListBounds(element);
  const lineHeight = num(element.lineHeight, 36);
  const maxLines = Math.min(num(element.maxLines, 5), 20);
  const fontSize = num(element.fontSize, 16);
  const fontWeight = num(element.fontWeight, 400);
  const emptyText = typeof element.emptyText === 'string' ? element.emptyText : 'Ei tulevia tapahtumia';
  const fill = num(element.fill, 100);
  const opacity = num(element.opacity, 100) / 100;

  const events = Array.isArray(sourceData?.events) ? sourceData.events : [];
  const lineCount = events.length === 0 ? 1 : Math.min(maxLines, events.length);

  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const label = events.length === 0
      ? (i === 0 ? emptyText : '')
      : (events[i]?.label ?? '');
    if (!label) continue;
    lines.push(
      <BitmapText
        key={`cal-line-${i}`}
        x={0}
        y={i * lineHeight}
        text={label}
        fontSize={fontSize}
        fontWeight={fontWeight}
        fill={fill}
        opacity={opacity}
        listening={false}
      />,
    );
  }

  if (lines.length === 0) {
    lines.push(
      <Text
        key="cal-empty"
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
      {/* Hit area — parent Group receives clicks/drags; text does not listen */}
      <Rect x={0} y={0} width={width} height={height} fill="transparent" />
      {/* Builder outline so the layer box is visible before selection */}
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
      {lines}
    </>
  );
}
