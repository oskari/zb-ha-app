/**
 * Builder-only bounds for calendarList elements (selection / transformer).
 * The server expander ignores sizeX/sizeY and lays out lines from pos + lineHeight.
 */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getCalendarListBounds(element) {
  const lineHeight = num(element?.lineHeight, 36);
  const maxLines = Math.min(num(element?.maxLines, 5), 20);
  return {
    width: num(element?.sizeX, 400),
    height: num(element?.sizeY, lineHeight * maxLines),
  };
}
