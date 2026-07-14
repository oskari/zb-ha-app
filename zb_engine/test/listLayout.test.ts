/**
 * listLayout.test.ts — calendarList row grouping tests
 */

import { describe, it, expect } from "vitest";
import { buildCalendarListRows } from "../src/data/calendar/listLayout";
import type { HaCalendarEvent } from "../src/data/sourceFetcher";

function ev(partial: Partial<HaCalendarEvent> & Pick<HaCalendarEvent, "start_ts">): HaCalendarEvent {
  return {
    summary: "Event",
    start: "",
    end: "",
    all_day: false,
    end_ts: partial.start_ts + 3_600_000,
    label: partial.label ?? "label",
    date_line: partial.date_line ?? partial.date_heading ?? "Pe 10.7",
    detail_label: partial.detail_label ?? "detail",
    subtitle: "",
    relative_label: partial.relative_label ?? "",
    date_heading: partial.date_heading ?? "Pe 10.7",
    date_label: "10.07.",
    time_label: "13:00",
    weekday_short: "pe",
    ...partial,
  };
}

describe("buildCalendarListRows", () => {
  const day = Date.parse("2026-07-10T00:00:00+03:00");

  it("renders date + detail lines for a single event", () => {
    const rows = buildCalendarListRows([
      ev({
        start_ts: day + 3_600_000,
        date_line: "Pe 10.7 (huomenna)",
        detail_label: "Team standup 13:00",
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
        date_line: "Pe 10.7 (huomenna)",
        detail_label: "Team standup",
      }),
      ev({
        start_ts: day + 7_200_000,
        date_line: "Pe 10.7 (huomenna)",
        detail_label: "Dentist",
      }),
    ], 5);
    expect(rows).toEqual([
      { kind: "date", text: "Pe 10.7 (huomenna)", fontWeight: 600 },
      { kind: "detail", text: "Team standup", fontWeight: 400 },
      { kind: "detail", text: "Dentist", fontWeight: 400 },
    ]);
  });

  it("does not emit partial event when maxLines is too small", () => {
    const rows = buildCalendarListRows([
      ev({ start_ts: day + 3_600_000, date_line: "Pe 10.7", detail_label: "A" }),
    ], 1);
    expect(rows).toHaveLength(0);
  });
});
