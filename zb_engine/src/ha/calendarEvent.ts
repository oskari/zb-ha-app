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

export type CalendarLabelFormat = "compact" | "card";

export interface NormalizeCalendarOptions {
  entity_id: string;
  daysAhead: number;
  maxEvents: number;
  includeOngoing: boolean;
  locale: "en" | "fi";
  eventFilter: "all" | "timed" | "all_day";
  labelFormat?: CalendarLabelFormat;
  now?: number;
}

const FI_WEEKDAYS = ["su", "ma", "ti", "ke", "to", "pe", "la"] as const;
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const FI_MONTHS = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"] as const;

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

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
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

function formatDateHeading(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  const wd = locale === "fi" ? FI_WEEKDAYS[d.getDay()] : EN_WEEKDAYS[d.getDay()];
  if (locale === "fi") {
    return `${wd} ${d.getDate()}.${d.getMonth() + 1}.`;
  }
  return `${wd} ${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;
}

function formatUntilDate(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  if (locale === "fi") {
    return `${d.getDate()}. ${FI_MONTHS[d.getMonth()]}`;
  }
  return `${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;
}

function weekdayShort(ts: number, locale: "en" | "fi"): string {
  const d = new Date(ts);
  return locale === "fi" ? FI_WEEKDAYS[d.getDay()] : EN_WEEKDAYS[d.getDay()];
}

function sameCalendarDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function formatRelativeLabel(
  startTs: number,
  now: number,
  locale: "en" | "fi",
): string {
  const days = Math.round((startOfDay(startTs) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return "";
  if (days === 1) return locale === "fi" ? "(huomenna)" : "(in a day)";
  if (locale === "fi") return `(${days} päivän päästä)`;
  return `(in ${days} days)`;
}

function formatSubtitle(
  allDay: boolean,
  startTs: number,
  endTs: number,
  locale: "en" | "fi",
): string {
  if (allDay) {
    if (sameCalendarDay(startTs, endTs)) {
      return locale === "fi" ? "Koko päivä" : "All Day";
    }
    const until = formatUntilDate(endTs, locale);
    return locale === "fi" ? `Koko päivä, asti ${until}` : `All Day, until ${until}`;
  }
  return `${formatTimeLocal(startTs)} - ${formatTimeLocal(endTs)}`;
}

export function formatCalendarEventLabel(
  summary: string,
  startTs: number,
  endTs: number,
  allDay: boolean,
  locale: "en" | "fi",
  labelFormat: CalendarLabelFormat = "card",
  now?: number,
): Pick<HaCalendarEvent, "label" | "subtitle" | "relative_label" | "date_heading" | "date_label" | "time_label" | "weekday_short"> {
  const wd = weekdayShort(startTs, locale);
  const date_label = locale === "fi" ? formatDateLabelFi(startTs) : formatDateLabelEn(startTs);
  const time_label = allDay ? "" : formatTimeLocal(startTs);
  const date_heading = formatDateHeading(startTs, locale);
  const subtitle = labelFormat === "card" ? formatSubtitle(allDay, startTs, endTs, locale) : "";
  const relative_label = labelFormat === "card" && now != null
    ? formatRelativeLabel(startTs, now, locale)
    : "";

  let label: string;
  if (labelFormat === "card") {
    label = relative_label
      ? `${date_heading}  ${summary}  ${relative_label}`
      : `${date_heading}  ${summary}`;
  } else if (locale === "fi") {
    label = allDay
      ? `${wd} ${date_label} ${summary}`
      : `${wd} ${date_label} ${time_label} ${summary}`;
  } else {
    label = allDay
      ? `${wd} ${date_label} ${summary}`
      : `${wd} ${date_label} ${time_label} ${summary}`;
  }

  return { label, subtitle, relative_label, date_heading, date_label, time_label, weekday_short: wd };
}

export function normalizeRawCalendarEvent(
  raw: RawHaCalendarEvent,
  locale: "en" | "fi",
  labelFormat: CalendarLabelFormat = "card",
  now?: number,
): HaCalendarEvent {
  const summary = String(raw.summary ?? "").trim();
  const start = String(raw.start ?? "");
  const end = String(raw.end ?? start);
  const all_day = isAllDayStart(start);
  const start_ts = parseHaCalendarTimestamp(start, "start", all_day);
  const end_ts = parseHaCalendarTimestamp(end, "end", all_day);
  const formatted = formatCalendarEventLabel(summary, start_ts, end_ts, all_day, locale, labelFormat, now);

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
  const labelFormat = options.labelFormat ?? "card";

  let events = rawEvents.map((raw) =>
    normalizeRawCalendarEvent(raw, options.locale, labelFormat, now),
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
