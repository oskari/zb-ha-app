/**
 * calendarEvent.ts — Parse, filter, sort, and format HA calendar events
 *
 * Pure functions with no I/O. Used by fetchHaCalendarSource and unit tests.
 * Comparisons use absolute millisecond timestamps. Calendar-day math and
 * display formatting are timezone-explicit (expression engine convention:
 * UTC + explicit offset): timed events use the offset HA put on their ISO
 * string (HA serializes them in its configured timezone), and all-day dates
 * use the calendar's reference offset. The process local timezone is only a
 * last-resort fallback.
 *
 * Events expose structured fields for bindings; display text for calendarList
 * is composed via row templates (see calendarTemplates.ts).
 */

import type { HaCalendarEvent, HaCalendarResult } from "../data/sourceFetcher";
import {
  applyCalendarRowTemplate,
  DEFAULT_CALENDAR_DATE_ROW_TEMPLATE,
  DEFAULT_CALENDAR_DETAIL_ROW_TEMPLATE,
} from "../data/calendar/calendarTemplates";
import { localOffsetMinutes, startOfDay } from "../data/calendar/startOfDay";

export { localOffsetMinutes, startOfDay } from "../data/calendar/startOfDay";
export {
  applyCalendarRowTemplate,
  DEFAULT_CALENDAR_DATE_ROW_TEMPLATE,
  DEFAULT_CALENDAR_DETAIL_ROW_TEMPLATE,
} from "../data/calendar/calendarTemplates";

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
  showDaysUntil?: boolean;
  now?: number;
  /**
   * Reference UTC offset (minutes east of UTC) for all-day dates. Defaults to
   * the offset of the first timed event, then the process local timezone.
   */
  utcOffsetMinutes?: number;
}

const FI_WEEKDAYS = ["su", "ma", "ti", "ke", "to", "pe", "la"] as const;
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function isAllDayStart(start: string): boolean {
  return !start.includes("T");
}

/**
 * UTC offset (minutes east of UTC) carried by an ISO datetime string, e.g.
 * `+03:00` → 180, `Z` → 0. Null for date-only or offset-less strings.
 */
export function parseIsoOffsetMinutes(value: string): number | null {
  const tIndex = value.indexOf("T");
  if (tIndex < 0) return null;
  const time = value.slice(tIndex + 1);
  if (/z$/i.test(time)) return 0;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(time);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * Parse an HA calendar start/end into unix ms.
 * Date-only strings are calendar dates in a timezone `offsetMinutes` east of
 * UTC (midnight start, end-of-day end); without an offset the process local
 * timezone is used.
 */
export function parseHaCalendarTimestamp(
  value: string,
  role: "start" | "end",
  allDay: boolean,
  offsetMinutes?: number,
): number {
  if (allDay || !value.includes("T")) {
    const parts = value.split("T")[0].split("-").map(Number);
    const year = parts[0];
    const month = parts[1] - 1;
    const day = parts[2];
    const utcMidnight = Date.UTC(year, month, day);
    const offset = offsetMinutes ?? (utcMidnight - new Date(year, month, day).getTime()) / 60_000;
    const dayStart = utcMidnight - offset * 60_000;
    if (role === "start") {
      return dayStart;
    }
    return dayStart + 86_400_000 - 1;
  }
  return new Date(value).getTime();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Wall-clock components of `ts` in a timezone `offsetMinutes` east of UTC. */
function wallClock(ts: number, offsetMinutes: number) {
  const d = new Date(ts + offsetMinutes * 60_000);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    weekday: d.getUTCDay(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

function formatTime(ts: number, offsetMinutes: number): string {
  const c = wallClock(ts, offsetMinutes);
  return `${pad2(c.hours)}:${pad2(c.minutes)}`;
}

function weekdayShort(ts: number, locale: "en" | "fi", offsetMinutes: number): string {
  const { weekday } = wallClock(ts, offsetMinutes);
  return locale === "fi" ? FI_WEEKDAYS[weekday] : EN_WEEKDAYS[weekday];
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact calendar date: `Ma 22.7` / `Mon 22.7` */
export function formatDateShort(
  ts: number,
  locale: "en" | "fi",
  offsetMinutes: number = localOffsetMinutes(ts),
): string {
  const c = wallClock(ts, offsetMinutes);
  const wd = locale === "fi"
    ? capitalize(FI_WEEKDAYS[c.weekday])
    : EN_WEEKDAYS[c.weekday];
  return `${wd} ${c.day}.${c.month + 1}`;
}

function formatDateLabelFi(ts: number, offsetMinutes: number): string {
  const c = wallClock(ts, offsetMinutes);
  return `${c.day}.${pad2(c.month + 1)}.`;
}

function formatDateLabelEn(ts: number, offsetMinutes: number): string {
  const c = wallClock(ts, offsetMinutes);
  return `${c.day} ${EN_MONTHS[c.month]}`;
}

/** Compact end date for multi-day events: `10.8.` / `10.8` */
export function formatUntilDateShort(
  ts: number,
  locale: "en" | "fi",
  offsetMinutes: number = localOffsetMinutes(ts),
): string {
  const c = wallClock(ts, offsetMinutes);
  if (locale === "fi") {
    return `${c.day}.${c.month + 1}.`;
  }
  return `${c.day}.${c.month + 1}`;
}

function sameCalendarDay(a: number, b: number, offsetMinutes: number): boolean {
  return startOfDay(a, offsetMinutes) === startOfDay(b, offsetMinutes);
}

export function computeDaysUntil(
  startTs: number,
  now: number,
  offsetMinutes: number = localOffsetMinutes(startTs),
): number | null {
  const days = Math.round(
    (startOfDay(startTs, offsetMinutes) - startOfDay(now, offsetMinutes)) / 86_400_000,
  );
  return days > 0 ? days : null;
}

/** Long relative phrase when showDaysUntil is enabled. */
export function formatRelativeLabel(
  startTs: number,
  now: number,
  locale: "en" | "fi",
  offsetMinutes: number = localOffsetMinutes(startTs),
): string {
  const days = computeDaysUntil(startTs, now, offsetMinutes);
  if (days == null) return "";
  if (days === 1) return locale === "fi" ? "(huomenna)" : "(in a day)";
  if (locale === "fi") return `(${days} päivän päästä)`;
  return `(in ${days} days)`;
}

function formatUntilLabel(endTs: number, locale: "en" | "fi", offsetMinutes: number): string {
  const c = wallClock(endTs, offsetMinutes);
  if (locale === "fi") {
    return `(${c.day}.${c.month + 1}. asti)`;
  }
  return `(until ${c.day}.${c.month + 1})`;
}

function withLeadingSpace(value: string): string {
  return value ? ` ${value}` : "";
}

export function buildCalendarEventFields(
  summary: string,
  startTs: number,
  endTs: number,
  allDay: boolean,
  locale: "en" | "fi",
  showDaysUntil: boolean,
  now?: number,
  offsetMinutes: number = localOffsetMinutes(startTs),
): Omit<HaCalendarEvent, "summary" | "start" | "end" | "all_day" | "start_ts" | "end_ts"> {
  const off = offsetMinutes;
  const wd = weekdayShort(startTs, locale, off);
  const date_short = formatDateShort(startTs, locale, off);
  const date_label = locale === "fi" ? formatDateLabelFi(startTs, off) : formatDateLabelEn(startTs, off);
  const time_label = allDay ? "" : formatTime(startTs, off);
  const date_heading = date_short;
  const multi_day = allDay && !sameCalendarDay(startTs, endTs, off);
  const until_date_short = multi_day ? formatUntilDateShort(endTs, locale, off) : "";
  const days_until = now != null ? computeDaysUntil(startTs, now, off) : null;

  const relative_label = showDaysUntil && now != null
    ? formatRelativeLabel(startTs, now, locale, off)
    : "";
  const relative_suffix = withLeadingSpace(relative_label);
  const time_suffix = withLeadingSpace(time_label);
  const until_label = multi_day ? formatUntilLabel(endTs, locale, off) : "";
  const until_suffix = withLeadingSpace(until_label);

  const partial: HaCalendarEvent = {
    summary,
    start: "",
    end: "",
    all_day: allDay,
    start_ts: startTs,
    end_ts: endTs,
    days_until,
    multi_day,
    date_short,
    until_date_short,
    time_label,
    time_suffix,
    relative_label,
    relative_suffix,
    until_label,
    until_suffix,
    subtitle: "",
    date_heading,
    date_label,
    weekday_short: wd,
    utc_offset_minutes: off,
    label: "",
    date_line: "",
    detail_label: "",
  };

  const date_line = applyCalendarRowTemplate(DEFAULT_CALENDAR_DATE_ROW_TEMPLATE, partial);
  const detail_label = applyCalendarRowTemplate(DEFAULT_CALENDAR_DETAIL_ROW_TEMPLATE, partial);
  const label = detail_label ? `${date_line}  ${detail_label}` : date_line;

  return {
    days_until,
    multi_day,
    date_short,
    until_date_short,
    time_label,
    time_suffix,
    relative_label,
    relative_suffix,
    until_label,
    until_suffix,
    subtitle: "",
    date_heading,
    date_label,
    weekday_short: wd,
    utc_offset_minutes: off,
    label,
    date_line,
    detail_label,
  };
}

/** @deprecated Use buildCalendarEventFields — kept for tests referencing the old name. */
export function formatCalendarEventLabel(
  summary: string,
  startTs: number,
  endTs: number,
  allDay: boolean,
  locale: "en" | "fi",
  showDaysUntil: boolean,
  now?: number,
  offsetMinutes?: number,
): ReturnType<typeof buildCalendarEventFields> {
  return buildCalendarEventFields(summary, startTs, endTs, allDay, locale, showDaysUntil, now, offsetMinutes);
}

export function normalizeRawCalendarEvent(
  raw: RawHaCalendarEvent,
  locale: "en" | "fi",
  showDaysUntil = false,
  now?: number,
  /** Reference offset for all-day dates; timed events use their own ISO offset. */
  offsetMinutes?: number,
): HaCalendarEvent {
  const summary = String(raw.summary ?? "").trim();
  const start = String(raw.start ?? "");
  const end = String(raw.end ?? start);
  const all_day = isAllDayStart(start);
  const eventOffset = all_day ? offsetMinutes : (parseIsoOffsetMinutes(start) ?? offsetMinutes);
  const start_ts = parseHaCalendarTimestamp(start, "start", all_day, eventOffset);
  const end_ts = parseHaCalendarTimestamp(end, "end", all_day, eventOffset);
  const offset = eventOffset ?? localOffsetMinutes(start_ts);
  const fields = buildCalendarEventFields(summary, start_ts, end_ts, all_day, locale, showDaysUntil, now, offset);

  return {
    summary,
    start,
    end,
    all_day,
    start_ts,
    end_ts,
    ...fields,
  };
}

/**
 * Calendar timezone offset inferred from the first timed event: HA serializes
 * timed events in its configured timezone, so their offset anchors all-day
 * dates to the same zone.
 */
function referenceOffsetMinutes(rawEvents: RawHaCalendarEvent[]): number | undefined {
  for (const raw of rawEvents) {
    const offset = parseIsoOffsetMinutes(String(raw.start ?? ""));
    if (offset != null) return offset;
  }
  return undefined;
}

export function buildHaCalendarResult(
  rawEvents: RawHaCalendarEvent[],
  options: NormalizeCalendarOptions,
): HaCalendarResult {
  const now = options.now ?? Date.now();
  const includeOngoing = options.includeOngoing;
  const showDaysUntil = options.showDaysUntil ?? false;
  const referenceOffset = options.utcOffsetMinutes ?? referenceOffsetMinutes(rawEvents);

  let events = rawEvents.map((raw) =>
    normalizeRawCalendarEvent(raw, options.locale, showDaysUntil, now, referenceOffset),
  );

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

/** HA REST `calendar.get_events?return_response` envelope. */
export interface CalendarGetEventsApiResponse {
  changed_states?: unknown[];
  service_response?: Record<string, { events?: RawHaCalendarEvent[] }>;
}

/**
 * Extract events from a calendar.get_events HTTP response.
 * Supports the REST envelope (`service_response`) and the direct automation
 * response shape (`{ "calendar.x": { events: [...] } }`).
 */
export function extractCalendarEventsFromServiceResponse(
  raw: unknown,
  entity_id: string,
): RawHaCalendarEvent[] {
  if (!raw || typeof raw !== "object") return [];

  const obj = raw as Record<string, unknown>;

  const serviceResponse = obj.service_response;
  if (serviceResponse && typeof serviceResponse === "object") {
    const bucket = (serviceResponse as Record<string, unknown>)[entity_id];
    if (bucket && typeof bucket === "object") {
      const events = (bucket as { events?: unknown }).events;
      if (Array.isArray(events)) return events as RawHaCalendarEvent[];
    }
  }

  const direct = obj[entity_id];
  if (direct && typeof direct === "object") {
    const events = (direct as { events?: unknown }).events;
    if (Array.isArray(events)) return events as RawHaCalendarEvent[];
  }

  return [];
}
