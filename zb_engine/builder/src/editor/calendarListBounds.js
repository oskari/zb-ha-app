/**
 * Builder-only bounds for calendarList elements (selection / transformer).
 * The server expander ignores sizeX/sizeY and lays out lines from pos + lineHeight.
 */

import { countCalendarListRows } from './calendarListLayout.js';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getCalendarListLayoutMetrics(element, events = null) {
  const lineHeight = num(element?.lineHeight, 20);
  const maxLines = Math.min(num(element?.maxLines, 5), 20);
  const eventList = Array.isArray(events) ? events : [];
  const renderedLines = eventList.length === 0
    ? 1
    : countCalendarListRows(eventList, maxLines, {
      dateRowTemplate: element?.dateRowTemplate,
      detailRowTemplate: element?.detailRowTemplate,
    });

  return {
    lineHeight,
    maxLines,
    renderedLines,
    width: num(element?.sizeX, 400),
    height: num(element?.sizeY, lineHeight * maxLines),
  };
}

export function getCalendarListBounds(element, events = null) {
  const metrics = getCalendarListLayoutMetrics(element, events);
  const height = metrics.lineHeight * (events?.length ? metrics.renderedLines : metrics.maxLines);
  return { width: metrics.width, height };
}
