/**
 * listLayout.ts — Shared row layout for calendarList expansion and builder preview
 */

import { startOfDay } from "../../ha/calendarEvent";
import type { HaCalendarEvent } from "../sourceFetcher";

export interface CalendarListRow {
  kind: "date" | "detail";
  text: string;
  fontWeight: number;
}

/**
 * Build rendered text rows for a calendarList.
 * Each event uses two lines (date + detail). Same-day events share one date line.
 */
export function buildCalendarListRows(
  events: HaCalendarEvent[],
  maxLines: number,
): CalendarListRow[] {
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

      const dateText = group[0].date_line || group[0].date_heading;
      rows.push({ kind: "date", text: dateText, fontWeight: 600 });
      lineCount++;

      for (const ev of group) {
        if (lineCount >= maxLines) break;
        if (!ev.detail_label) continue;
        rows.push({ kind: "detail", text: ev.detail_label, fontWeight: 400 });
        lineCount++;
      }
    } else {
      if (remaining < 2) break;

      const ev = group[0];
      rows.push({
        kind: "date",
        text: ev.date_line || ev.date_heading,
        fontWeight: 600,
      });
      lineCount++;

      if (lineCount < maxLines && ev.detail_label) {
        rows.push({ kind: "detail", text: ev.detail_label, fontWeight: 400 });
        lineCount++;
      }
    }

    i = j;
  }

  return rows;
}

/** Count rendered lines without building full row objects. */
export function countCalendarListRows(events: HaCalendarEvent[], maxLines: number): number {
  return buildCalendarListRows(events, maxLines).length;
}
