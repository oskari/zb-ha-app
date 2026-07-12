/**
 * listLayout.ts — Shared row layout for calendarList expansion and builder preview
 */

import { startOfDay } from "../../ha/calendarEvent";
import type { HaCalendarEvent } from "../sourceFetcher";

export interface CalendarListRow {
  kind: "heading" | "detail" | "standalone";
  text: string;
  fontWeight: number;
}

/**
 * Build rendered text rows for a calendarList, grouping consecutive events
 * on the same start calendar day.
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

    if (group.length >= 2) {
      const remaining = maxLines - lineCount;
      if (remaining < 2) break;

      const headingSuffix = group[0].relative_label;
      const headingText = headingSuffix
        ? `${group[0].date_heading} ${headingSuffix}`
        : group[0].date_heading;

      rows.push({ kind: "heading", text: headingText, fontWeight: 600 });
      lineCount++;

      for (const ev of group) {
        if (lineCount >= maxLines) break;
        if (!ev.detail_label) continue;
        rows.push({ kind: "detail", text: ev.detail_label, fontWeight: 400 });
        lineCount++;
      }
    } else {
      const ev = group[0];
      rows.push({ kind: "standalone", text: ev.label, fontWeight: 400 });
      lineCount++;
    }

    i = j;
  }

  return rows;
}

/** Count rendered lines without building full row objects. */
export function countCalendarListRows(events: HaCalendarEvent[], maxLines: number): number {
  return buildCalendarListRows(events, maxLines).length;
}
