/**
 * haCalendar.test.ts — haCalendar source normalization and handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sourceSchema } from "../src/schema/sourceSchema";
import {
  buildHaCalendarResult,
  extractCalendarEventsFromServiceResponse,
  normalizeRawCalendarEvent,
  parseHaCalendarTimestamp,
} from "../src/ha/calendarEvent";
import { haSourceHandler } from "../src/ha/haSources";
import { createDataContext } from "@zb/expressions";
import fixture from "./fixtures/calendarSampleEvents.json";

const mockFetch = vi.fn();
vi.mock("../src/data/safeFetch", async () => {
  const actual = await vi.importActual<typeof import("../src/data/safeFetch")>(
    "../src/data/safeFetch",
  );
  return {
    ...actual,
    fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  };
});

function mockResponseFromJson(payload: unknown, ok = true, status = 200): Response {
  const text = JSON.stringify(payload);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    headers: new Map(),
    body: null,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.SUPERVISOR_TOKEN = "test-token";
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.SUPERVISOR_TOKEN;
});

describe("sourceSchema: haCalendar", () => {
  it("accepts valid haCalendar source", () => {
    const result = sourceSchema.safeParse({
      id: "family_cal",
      kind: "haCalendar",
      entity_id: "calendar.family",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-calendar entity_id", () => {
    const result = sourceSchema.safeParse({
      id: "bad",
      kind: "haCalendar",
      entity_id: "sensor.temperature",
    });
    expect(result.success).toBe(false);
  });

  it("defaults locale to fi", () => {
    const result = sourceSchema.safeParse({
      id: "family_cal",
      kind: "haCalendar",
      entity_id: "calendar.family",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locale).toBe("fi");
      expect(result.data.daysAhead).toBe(14);
      expect(result.data.maxEvents).toBe(10);
    }
  });
});

describe("calendarEvent normalization", () => {
  const now = Date.parse("2026-07-09T12:00:00+03:00");

  it("detects all-day vs timed events", () => {
    const allDay = normalizeRawCalendarEvent(fixture[0], "fi");
    expect(allDay.all_day).toBe(true);

    const timed = normalizeRawCalendarEvent(fixture[1], "fi");
    expect(timed.all_day).toBe(false);
  });

  it("formats Finnish timed standalone label and detail", () => {
    const ts = parseHaCalendarTimestamp("2026-07-10T13:00:00+03:00", "start", false);
    const event = normalizeRawCalendarEvent(fixture[1], "fi");
    expect(event.summary).toBe("Team standup");
    expect(event.label).toBe("pe 10. 13:00 Team standup");
    expect(event.detail_label).toBe("13:00 Team standup");
    expect(event.time_label).toMatch(/^\d{2}:\d{2}$/);
    expect(event.start_ts).toBe(ts);
  });

  it("formats English labels and detail without days-until by default", () => {
    const holiday = normalizeRawCalendarEvent(fixture[0], "en", false, now);
    expect(holiday.date_heading).toBe("Mon 22 Jun");
    expect(holiday.label).toContain("Summer holiday");
    expect(holiday.detail_label).toContain("Summer holiday");
    expect(holiday.subtitle).toBe("");
    expect(holiday.relative_label).toBe("");

    const timed = normalizeRawCalendarEvent(fixture[1], "en", false, now);
    expect(timed.date_heading).toBe("Fri 10 Jul");
    expect(timed.label).toBe("Fri 10 13:00 Team standup");
    expect(timed.detail_label).toBe("13:00 Team standup");
  });

  it("appends short days-until suffix on standalone label when enabled", () => {
    const timedFi = normalizeRawCalendarEvent(fixture[1], "fi", true, now);
    expect(timedFi.relative_label).toBe("(+1pv)");
    expect(timedFi.label).toBe("pe 10. 13:00 Team standup (+1pv)");
    expect(timedFi.detail_label).toBe("13:00 Team standup");

    const timedEn = normalizeRawCalendarEvent(fixture[1], "en", true, now);
    expect(timedEn.relative_label).toBe("(+1d)");
    expect(timedEn.label).toBe("Fri 10 13:00 Team standup (+1d)");
  });

  it("omits suffix for today or past start days", () => {
    const today = normalizeRawCalendarEvent(fixture[1], "fi", true, Date.parse("2026-07-10T08:00:00+03:00"));
    expect(today.relative_label).toBe("");
    expect(today.label).toBe("pe 10. 13:00 Team standup");
  });

  it("excludes past-ended events", () => {
    const now = Date.parse("2026-07-09T12:00:00+03:00");
    const result = buildHaCalendarResult(fixture as typeof fixture, {
      entity_id: "calendar.family",
      daysAhead: 14,
      maxEvents: 10,
      includeOngoing: true,
      locale: "fi",
      eventFilter: "all",
      now,
    });
    const summaries = result.events.map((e) => e.summary);
    expect(summaries).not.toContain("Past timed event");
    expect(summaries).toContain("Team standup");
  });

  it("excludes in-progress events when includeOngoing is false", () => {
    const now = Date.parse("2026-07-10T14:00:00+03:00");
    const result = buildHaCalendarResult(fixture as typeof fixture, {
      entity_id: "calendar.family",
      daysAhead: 14,
      maxEvents: 10,
      includeOngoing: false,
      locale: "fi",
      eventFilter: "all",
      now,
    });
    expect(result.events.every((e) => e.start_ts > now)).toBe(true);
  });

  it("sorts ascending by start", () => {
    const now = Date.parse("2026-06-01T00:00:00+03:00");
    const result = buildHaCalendarResult(fixture as typeof fixture, {
      entity_id: "calendar.family",
      daysAhead: 90,
      maxEvents: 10,
      includeOngoing: true,
      locale: "fi",
      eventFilter: "all",
      now,
    });
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].start_ts).toBeGreaterThanOrEqual(result.events[i - 1].start_ts);
    }
  });

  it("sets truncated when more events than maxEvents", () => {
    const now = Date.parse("2026-06-01T00:00:00+03:00");
    const result = buildHaCalendarResult(fixture as typeof fixture, {
      entity_id: "calendar.family",
      daysAhead: 90,
      maxEvents: 1,
      includeOngoing: true,
      locale: "fi",
      eventFilter: "all",
      now,
    });
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("handles date-only end for all-day events", () => {
    const endTs = parseHaCalendarTimestamp("2026-08-10", "end", true);
    const startTs = parseHaCalendarTimestamp("2026-06-22", "start", true);
    expect(endTs).toBeGreaterThan(startTs);
    const now = Date.parse("2026-07-01T12:00:00+03:00");
    const event = normalizeRawCalendarEvent(fixture[0], "fi");
    expect(event.end_ts).toBe(endTs);
    expect(event.end_ts).toBeGreaterThan(now);
  });
});

describe("haSourceHandler: haCalendar", () => {
  it("routes haCalendar and returns normalized events", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponseFromJson({
        changed_states: [],
        service_response: {
          "calendar.family": { events: fixture },
        },
      }),
    );

    const ctx = createDataContext();
    const result = await haSourceHandler(
      {
        id: "family_cal",
        kind: "haCalendar",
        entity_id: "calendar.family",
        daysAhead: 14,
        maxEvents: 5,
        locale: "fi",
        eventFilter: "all",
      },
      ctx,
    );

    expect(result).toMatchObject({
      entity_id: "calendar.family",
      daysAhead: 14,
    });
    expect(Array.isArray((result as { events: unknown[] }).events)).toBe(true);

    const [url, , opts] = mockFetch.mock.calls[0] as [string, number, RequestInit];
    expect(url).toContain("/services/calendar/get_events?return_response");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(String(opts.body))).toEqual({
      entity_id: "calendar.family",
      duration: { days: 14 },
    });
  });

  it("parses direct automation-style response shape", () => {
    const events = extractCalendarEventsFromServiceResponse(
      { "calendar.family": { events: fixture } },
      "calendar.family",
    );
    expect(events).toHaveLength(fixture.length);
  });

  it("returns empty result for missing events key", async () => {
    mockFetch.mockResolvedValueOnce(mockResponseFromJson({}));

    const ctx = createDataContext();
    const result = await haSourceHandler(
      {
        id: "family_cal",
        kind: "haCalendar",
        entity_id: "calendar.family",
        daysAhead: 14,
        maxEvents: 5,
        locale: "fi",
        eventFilter: "all",
      },
      ctx,
    );

    expect(result).toMatchObject({ count: 0, events: [], truncated: false });
  });
});
