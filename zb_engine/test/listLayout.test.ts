/**
 * listLayout.test.ts — calendarList row grouping tests
 */

import { describe, it, expect } from "vitest";
import { buildCalendarListRows } from "../src/data/calendar/listLayout";
import type { HaCalendarEvent } from "../src/data/sourceFetcher";

function ev(partial: Partial<HaCalendarEvent> & Pick<HaCalendarEvent, "start_ts">): HaCalendarEvent {
  return {
    summary: partial.summary ?? "Event",
    start: "",
    end: "",
    all_day: partial.all_day ?? false,
    end_ts: partial.end_ts ?? partial.start_ts + 3_600_000,
    days_until: partial.days_until ?? null,
    multi_day: partial.multi_day ?? false,
    date_short: partial.date_short ?? "Pe 10.7",
    until_date_short: partial.until_date_short ?? "",
    time_label: partial.time_label ?? "13:00",
    time_suffix: partial.time_suffix ?? " 13:00",
    relative_label: partial.relative_label ?? "",
    relative_suffix: partial.relative_suffix ?? "",
    until_label: partial.until_label ?? "",
    until_suffix: partial.until_suffix ?? "",
    label: partial.label ?? "",
    date_line: partial.date_line ?? "",
    detail_label: partial.detail_label ?? "",
    subtitle: "",
    date_heading: partial.date_heading ?? partial.date_short ?? "Pe 10.7",
    date_label: partial.date_label ?? "10.07.",
    weekday_short: partial.weekday_short ?? "pe",
    ...partial,
  };
}

describe("buildCalendarListRows", () => {
  const day = Date.parse("2026-07-10T00:00:00+03:00");

  it("renders date + detail lines for a single event", () => {
    const rows = buildCalendarListRows([
      ev({
        start_ts: day + 3_600_000,
        summary: "Team standup",
        date_short: "Pe 10.7",
        relative_suffix: " (huomenna)",
        time_suffix: " 13:00",
      }),
    ], 5);
    expect(rows).toEqual([
      { kind: "date", text: "Pe 10.7 (huomenna)", fontWeight: 600 },
      { kind: "detail", text: "Team standup 13:00", fontWeight: 400 },
    ]);
  });

  it("groups two same-day events under one date line", () => {
    const rows = buildCalendarListRows([
      ev({
        start_ts: day + 3_600_000,
        summary: "Team standup",
        date_short: "Pe 10.7",
        relative_suffix: " (huomenna)",
        time_suffix: " 13:00",
      }),
      ev({
        start_ts: day + 7_200_000,
        summary: "Dentist",
        date_short: "Pe 10.7",
        relative_suffix: " (huomenna)",
        time_suffix: " 15:00",
      }),
    ], 5);
    expect(rows).toEqual([
      { kind: "date", text: "Pe 10.7 (huomenna)", fontWeight: 600 },
      { kind: "detail", text: "Team standup 13:00", fontWeight: 400 },
      { kind: "detail", text: "Dentist 15:00", fontWeight: 400 },
    ]);
  });

  it("applies custom row templates", () => {
    const rows = buildCalendarListRows([
      ev({
        start_ts: day,
        summary: "Holiday",
        date_short: "Pe 10.7",
        days_until: 9,
        until_suffix: " (10.8. asti)",
        time_suffix: "",
      }),
    ], 5, {
      dateRowTemplate: "{{date_short}} (+{{days_until}})",
      detailRowTemplate: "{{summary}}{{until_suffix}}",
    });
    expect(rows).toEqual([
      { kind: "date", text: "Pe 10.7 (+9)", fontWeight: 600 },
      { kind: "detail", text: "Holiday (10.8. asti)", fontWeight: 400 },
    ]);
  });

  it("does not emit partial event when maxLines is too small", () => {
    const rows = buildCalendarListRows([
      ev({
        start_ts: day + 3_600_000,
        summary: "A",
        date_short: "Pe 10.7",
        time_suffix: "",
      }),
    ], 1);
    expect(rows).toHaveLength(0);
  });
});
