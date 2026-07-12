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
    detail_label: partial.detail_label ?? "detail",
    subtitle: "",
    relative_label: partial.relative_label ?? "",
    date_heading: partial.date_heading ?? "pe 10.",
    date_label: "10.07.",
    time_label: "13:00",
    weekday_short: "pe",
    ...partial,
  };
}

describe("buildCalendarListRows", () => {
  const day = Date.parse("2026-07-10T00:00:00+03:00");

  it("uses standalone label for a single event on a day", () => {
    const rows = buildCalendarListRows([
      ev({ start_ts: day + 3_600_000, label: "pe 10. 13:00 A" }),
    ], 5);
    expect(rows).toEqual([
      { kind: "standalone", text: "pe 10. 13:00 A", fontWeight: 400 },
    ]);
  });

  it("groups two same-day events with suffix on heading", () => {
    const rows = buildCalendarListRows([
      ev({
        start_ts: day + 3_600_000,
        date_heading: "pe 10.",
        detail_label: "13:00 A",
        relative_label: "(+1pv)",
      }),
      ev({
        start_ts: day + 7_200_000,
        date_heading: "pe 10.",
        detail_label: "15:00 B",
        relative_label: "(+1pv)",
      }),
    ], 5);
    expect(rows).toEqual([
      { kind: "heading", text: "pe 10. (+1pv)", fontWeight: 600 },
      { kind: "detail", text: "13:00 A", fontWeight: 400 },
      { kind: "detail", text: "15:00 B", fontWeight: 400 },
    ]);
  });

  it("does not emit partial group when maxLines is too small", () => {
    const rows = buildCalendarListRows([
      ev({ start_ts: day + 3_600_000, date_heading: "pe 10.", detail_label: "13:00 A" }),
      ev({ start_ts: day + 7_200_000, date_heading: "pe 10.", detail_label: "15:00 B" }),
      ev({ start_ts: day + 86_400_000 + 3_600_000, label: "la 11. 10:00 C" }),
    ], 1);
    expect(rows).toHaveLength(0);
  });
});
