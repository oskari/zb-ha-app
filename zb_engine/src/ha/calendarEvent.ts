/**
 * calendarEvent.ts — Parse, filter, sort, and format HA calendar events
 *
 * Pure functions with no I/O. Used by fetchHaCalendarSource and unit tests.
 * All datetime comparisons use millisecond timestamps in the container's
 * local timezone (inherits HA host TZ in the add-on).
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

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatTimeLocal(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function weekdayShort(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  return locale === "fi" ? FI_WEEKDAYS[d.getDay()] : EN_WEEKDAYS[d.getDay()];
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact calendar date: `Ma 22.7` / `Mon 22.7` */
export function formatDateShort(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  const wd = locale === "fi"
    ? capitalize(FI_WEEKDAYS[d.getDay()])
    : EN_WEEKDAYS[d.getDay()];
  return `${wd} ${d.getDate()}.${d.getMonth() + 1}`;
}

function formatDateHeading(ts: number, locale: "en" | "fi"): string {
  return formatDateShort(ts, locale);
}

function formatDateLabelFi(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}.${pad2(d.getMonth() + 1)}.`;
}

function formatDateLabelEn(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;
}

/** Compact end date for multi-day events: `10.8.` / `10.8` */
export function formatUntilDateShort(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  if (locale === "fi") {
    return `${d.getDate()}.${d.getMonth() + 1}.`;
  }
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function sameCalendarDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function computeDaysUntil(startTs: number, now: number): number | null {
  const days = Math.round((startOfDay(startTs) - startOfDay(now)) / 86_400_000);
  return days > 0 ? days : null;
}

/** Long relative phrase when showDaysUntil is enabled. */
export function formatRelativeLabel(
  startTs: number,
  now: number,
  locale: "en" | "fi",
): string {
  const days = computeDaysUntil(startTs, now);
  if (days == null) return "";
  if (days === 1) return locale === "fi" ? "(huomenna)" : "(in a day)";
  if (locale === "fi") return `(${days} päivän päästä)`;
  return `(in ${days} days)`;
}

function formatUntilLabel(endTs: number, locale: "en" | "fi"): string {
  const d = new Date(endTs);
  if (locale === "fi") {
    return `(${d.getDate()}.${d.getMonth() + 1}. asti)`;
  }
  return `(until ${d.getDate()}.${d.getMonth() + 1})`;
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
): Omit<HaCalendarEvent, "summary" | "start" | "end" | "all_day" | "start_ts" | "end_ts"> {
  const wd = weekdayShort(startTs, locale);
  const date_short = formatDateShort(startTs, locale);
  const date_label = locale === "fi" ? formatDateLabelFi(startTs) : formatDateLabelEn(startTs);
  const time_label = allDay ? "" : formatTimeLocal(startTs);
  const date_heading = formatDateHeading(startTs, locale);
  const multi_day = allDay && !sameCalendarDay(startTs, endTs);
  const until_date_short = multi_day ? formatUntilDateShort(endTs, locale) : "";
  const days_until = now != null ? computeDaysUntil(startTs, now) : null;

  const relative_label = showDaysUntil && now != null
    ? formatRelativeLabel(startTs, now, locale)
    : "";
  const relative_suffix = withLeadingSpace(relative_label);
  const time_suffix = withLeadingSpace(time_label);
  const until_label = multi_day ? formatUntilLabel(endTs, locale) : "";
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
): ReturnType<typeof buildCalendarEventFields> {
  return buildCalendarEventFields(summary, startTs, endTs, allDay, locale, showDaysUntil, now);
}

export function normalizeRawCalendarEvent(
  raw: RawHaCalendarEvent,
  locale: "en" | "fi",
  showDaysUntil = false,
  now?: number,
): HaCalendarEvent {
  const summary = String(raw.summary ?? "").trim();
  const start = String(raw.start ?? "");
  const end = String(raw.end ?? start);
  const all_day = isAllDayStart(start);
  const start_ts = parseHaCalendarTimestamp(start, "start", all_day);
  const end_ts = parseHaCalendarTimestamp(end, "end", all_day);
  const fields = buildCalendarEventFields(summary, start_ts, end_ts, all_day, locale, showDaysUntil, now);

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

export function buildHaCalendarResult(
  rawEvents: RawHaCalendarEvent[],
  options: NormalizeCalendarOptions,
): HaCalendarResult {
  const now = options.now ?? Date.now();
  const includeOngoing = options.includeOngoing;
  const showDaysUntil = options.showDaysUntil ?? false;

  let events = rawEvents.map((raw) =>
    normalizeRawCalendarEvent(raw, options.locale, showDaysUntil, now),
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
