/**
 * listLayout.ts — Shared row layout for calendarList expansion and builder preview
 */

import { startOfDay } from "../../ha/calendarEvent";
import type { HaCalendarEvent } from "../sourceFetcher";
import {
  applyCalendarRowTemplate,
  DEFAULT_CALENDAR_DATE_ROW_TEMPLATE,
  DEFAULT_CALENDAR_DETAIL_ROW_TEMPLATE,
} from "./calendarTemplates";

export interface CalendarListRow {
  kind: "date" | "detail";
  text: string;
  fontWeight: number;
}

export interface CalendarListTemplateOptions {
  dateRowTemplate?: string;
  detailRowTemplate?: string;
}

/**
 * Build rendered text rows for a calendarList.
 * Each event uses two lines (date + detail). Same-day events share one date line.
 */
export function buildCalendarListRows(
  events: HaCalendarEvent[],
  maxLines: number,
  templates: CalendarListTemplateOptions = {},
): CalendarListRow[] {
  const dateTpl = templates.dateRowTemplate || DEFAULT_CALENDAR_DATE_ROW_TEMPLATE;
  const detailTpl = templates.detailRowTemplate || DEFAULT_CALENDAR_DETAIL_ROW_TEMPLATE;
  const rows: CalendarListRow[] = [];
  let lineCount = 0;

  let i = 0;
  while (i < events.length && lineCount < maxLines) {
    const dayKey = startOfDay(events[i].start_ts);
    let j = i + 1;
    while (j < events.length && startOfDay(events[j].start_ts) === dayKey) {
      j++;
    }
    const group = events.slice(i, j);
    const remaining = maxLines - lineCount;

    if (group.length >= 2) {
      if (remaining < 2) break;

      const dateText = applyCalendarRowTemplate(dateTpl, group[0]);
      if (dateText) {
        rows.push({ kind: "date", text: dateText, fontWeight: 600 });
        lineCount++;
      }

      for (const ev of group) {
        if (lineCount >= maxLines) break;
        const detail = applyCalendarRowTemplate(detailTpl, ev);
        if (!detail) continue;
        rows.push({ kind: "detail", text: detail, fontWeight: 400 });
        lineCount++;
      }
    } else {
      if (remaining < 2) break;

      const ev = group[0];
      const dateText = applyCalendarRowTemplate(dateTpl, ev);
      if (dateText) {
        rows.push({ kind: "date", text: dateText, fontWeight: 600 });
        lineCount++;
      }

      if (lineCount < maxLines) {
        const detail = applyCalendarRowTemplate(detailTpl, ev);
        if (detail) {
          rows.push({ kind: "detail", text: detail, fontWeight: 400 });
          lineCount++;
        }
      }
    }

    i = j;
  }

  return rows;
}

/** Count rendered lines without building full row objects. */
export function countCalendarListRows(
  events: HaCalendarEvent[],
  maxLines: number,
  templates: CalendarListTemplateOptions = {},
): number {
  return buildCalendarListRows(events, maxLines, templates).length;
}
