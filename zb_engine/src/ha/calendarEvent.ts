/**
 * calendarEvent.ts — Parse, filter, sort, and format HA calendar events
 *
 * Pure functions with no I/O. Used by fetchHaCalendarSource and unit tests.
 * All datetime comparisons use millisecond timestamps in the container's
 * local timezone (inherits HA host TZ in the add-on).
 */

import type { HaCalendarEvent, HaCalendarResult } from "../data/sourceFetcher";

export interface RawHaCalendarEvent {
  start: string;
  end: string;
  summary?: string;
}

export interface NormalizeCalendarOptions {
  entity_id: string;
  daysAhead: number;
  maxEvents: number;
  includeOngoing: boolean;
  locale: "en" | "fi";
  eventFilter: "all" | "timed" | "all_day";
  now?: number;
}

const FI_WEEKDAYS = ["su", "ma", "ti", "ke", "to", "pe", "la"] as const;
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function isAllDayStart(start: string): boolean {
  return !start.includes("T");
}

/**
 * Parse an HA calendar start/end into unix ms.
 * Date-only strings are interpreted in local time (midnight start, end-of-day end).
 */
export function parseHaCalendarTimestamp(value: string, role: "start" | "end", allDay: boolean): number {
  if (allDay || !value.includes("T")) {
    const parts = value.split("T")[0].split("-").map(Number);
    const year = parts[0];
    const month = parts[1] - 1;
    const day = parts[2];
    if (role === "start") {
      return new Date(year, month, day, 0, 0, 0, 0).getTime();
    }
    return new Date(year, month, day, 23, 59, 59, 999).getTime();
  }
  return new Date(value).getTime();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTimeLocal(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateLabelFi(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}.${pad2(d.getMonth() + 1)}.`;
}

function formatDateLabelEn(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;
}

function weekdayShort(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  return locale === "fi" ? FI_WEEKDAYS[d.getDay()] : EN_WEEKDAYS[d.getDay()];
}

export function formatCalendarEventLabel(
  summary: string,
  startTs: number,
  allDay: boolean,
  locale: "en" | "fi",
): { label: string; date_label: string; time_label: string; weekday_short: string } {
  const wd = weekdayShort(startTs, locale);
  const date_label = locale === "fi" ? formatDateLabelFi(startTs) : formatDateLabelEn(startTs);
  const time_label = allDay ? "" : formatTimeLocal(startTs);

  let label: string;
  if (locale === "fi") {
    label = allDay
      ? `${wd} ${date_label} ${summary}`
      : `${wd} ${date_label} ${time_label} ${summary}`;
  } else {
    label = allDay
      ? `${wd} ${date_label} ${summary}`
      : `${wd} ${date_label} ${time_label} ${summary}`;
  }

  return { label, date_label, time_label, weekday_short: wd };
}

export function normalizeRawCalendarEvent(
  raw: RawHaCalendarEvent,
  locale: "en" | "fi",
): HaCalendarEvent {
  const summary = String(raw.summary ?? "").trim();
  const start = String(raw.start ?? "");
  const end = String(raw.end ?? start);
  const all_day = isAllDayStart(start);
  const start_ts = parseHaCalendarTimestamp(start, "start", all_day);
  const end_ts = parseHaCalendarTimestamp(end, "end", all_day);
  const formatted = formatCalendarEventLabel(summary, start_ts, all_day, locale);

  return {
    summary,
    start,
    end,
    all_day,
    start_ts,
    end_ts,
    ...formatted,
  };
}

export function buildHaCalendarResult(
  rawEvents: RawHaCalendarEvent[],
  options: NormalizeCalendarOptions,
): HaCalendarResult {
  const now = options.now ?? Date.now();
  const includeOngoing = options.includeOngoing;

  let events = rawEvents.map((raw) => normalizeRawCalendarEvent(raw, options.locale));

  events = events.filter((e) => e.end_ts > now);
  if (!includeOngoing) {
    events = events.filter((e) => e.start_ts > now);
  }

  if (options.eventFilter === "timed") {
    events = events.filter((e) => !e.all_day);
  } else if (options.eventFilter === "all_day") {
    events = events.filter((e) => e.all_day);
  }

  events.sort((a, b) => a.start_ts - b.start_ts);

  const truncated = events.length > options.maxEvents;
  const capped = events.slice(0, options.maxEvents);

  return {
    entity_id: options.entity_id,
    daysAhead: options.daysAhead,
    count: capped.length,
    truncated,
    events: capped,
  };
}
