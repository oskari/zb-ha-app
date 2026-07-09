/**
 * CalendarListPreview.jsx — Konva preview for calendarList elements
 */

import { Text } from 'react-konva';
import BitmapText from '../components/BitmapText.jsx';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function CalendarListPreview({ element, sourceData }) {
  const baseX = num(element.pos?.x, 0);
  const baseY = num(element.pos?.y, 0);
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
        x={baseX}
        y={baseY + i * lineHeight}
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
    return (
      <Text
        x={baseX}
        y={baseY}
        text={emptyText}
        fontSize={fontSize}
        fontStyle={fontWeight >= 600 ? 'bold' : 'normal'}
        opacity={opacity}
        listening={false}
      />
    );
  }

  return <>{lines}</>;
}
