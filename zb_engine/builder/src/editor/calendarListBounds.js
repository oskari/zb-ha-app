/**
 * Builder-only bounds for calendarList elements (selection / transformer).
 * The server expander ignores sizeX/sizeY and lays out lines from pos + lineHeight.
 */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getCalendarListLayoutMetrics(element) {
  const layout = element?.layout === 'compact' ? 'compact' : 'card';
  const lineHeight = num(element?.lineHeight, 36);
  const maxLines = Math.min(num(element?.maxLines, 5), 20);
  const linesPerEvent = layout === 'card' ? 2 : 1;
  const blockHeight = lineHeight * linesPerEvent;
  return {
    layout,
    lineHeight,
    maxLines,
    linesPerEvent,
    blockHeight,
    width: num(element?.sizeX, 400),
    height: num(element?.sizeY, blockHeight * maxLines),
  };
}

export function getCalendarListBounds(element) {
  const metrics = getCalendarListLayoutMetrics(element);
  return { width: metrics.width, height: metrics.height };
}
