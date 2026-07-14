/**
 * calendarListExpand.test.ts — calendarList element expansion tests
 */

import { describe, it, expect } from "vitest";
import { createDataContext } from "@zb/expressions";
import { expandCalendarListElements } from "../src/data/calendar/expander";
import type { HaCalendarEvent, HaCalendarResult } from "../src/data/sourceFetcher";

function makeEvent(partial: Partial<HaCalendarEvent> & Pick<HaCalendarEvent, "start_ts">): HaCalendarEvent {
  return {
    summary: partial.summary ?? "Event",
    start: partial.start ?? "",
    end: partial.end ?? "",
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

const sampleSourceData: HaCalendarResult = {
  entity_id: "family_cal",
  daysAhead: 14,
  count: 3,
  truncated: false,
  events: [
    makeEvent({
      summary: "A",
      start_ts: 1,
      date_short: "Pe 10.7",
      time_suffix: " 13:00",
    }),
    makeEvent({
      summary: "B",
      start_ts: 86_400_001,
      date_short: "La 11.7",
      time_suffix: " 10:00",
    }),
    makeEvent({
      summary: "C",
      start_ts: 172_800_001,
      date_short: "Su 12.7",
      time_suffix: " 09:00",
    }),
  ],
};

describe("expandCalendarListElements", () => {
  it("expands each event into date + detail lines on different days", () => {
    const ctx = createDataContext();
    ctx.family_cal = sampleSourceData;

    const { elements, errors } = expandCalendarListElements(
      [{
        type: "calendarList",
        id: "cl1",
        sourceId: "family_cal",
        pos: { x: 24, y: 224 },
        lineHeight: 20,
        maxLines: 6,
        fontSize: 12,
        enableFill: true,
        fill: 100,
      }],
      ctx,
    );

    expect(errors).toEqual([]);
    expect(elements).toHaveLength(6);
    expect(elements[0]).toMatchObject({ type: "text", text: "Pe 10.7", fontWeight: 600 });
    expect(elements[1]).toMatchObject({ type: "text", text: "A 13:00", fontWeight: 400 });
    expect(elements[2]).toMatchObject({ type: "text", text: "La 11.7", fontWeight: 600 });
  });

  it("groups same-day events under one date line", () => {
    const ctx = createDataContext();
    const day = Date.parse("2026-07-10T00:00:00+03:00");
    ctx.family_cal = {
      ...sampleSourceData,
      count: 2,
      events: [
        makeEvent({
          summary: "Team standup",
          start_ts: day + 13 * 3_600_000,
          date_short: "Pe 10.7",
          relative_suffix: " (huomenna)",
          time_suffix: " 13:00",
        }),
        makeEvent({
          summary: "Dentist",
          start_ts: day + 15 * 3_600_000,
          date_short: "Pe 10.7",
          relative_suffix: " (huomenna)",
          time_suffix: " 15:00",
        }),
      ],
    };

    const { elements } = expandCalendarListElements(
      [{
        type: "calendarList",
        sourceId: "family_cal",
        pos: { x: 0, y: 0 },
        lineHeight: 20,
        maxLines: 5,
      }],
      ctx,
    );

    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ text: "Pe 10.7 (huomenna)", fontWeight: 600 });
    expect(elements[1]).toMatchObject({ text: "Team standup 13:00", fontWeight: 400 });
    expect(elements[2]).toMatchObject({ text: "Dentist 15:00", fontWeight: 400 });
  });

  it("emits emptyText when count is 0", () => {
    const ctx = createDataContext();
    ctx.family_cal = { ...sampleSourceData, count: 0, events: [] };

    const { elements } = expandCalendarListElements(
      [{
        type: "calendarList",
        sourceId: "family_cal",
        pos: { x: 10, y: 20 },
        emptyText: "Ei tulevia tapahtumia",
      }],
      ctx,
    );

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ type: "text", text: "Ei tulevia tapahtumia" });
  });

  it("caps output to maxLines including date rows", () => {
    const ctx = createDataContext();
    const day = Date.parse("2026-07-10T00:00:00+03:00");
    ctx.family_cal = {
      ...sampleSourceData,
      count: 2,
      events: [
        makeEvent({
          summary: "Summer holiday",
          start_ts: day,
          date_short: "Pe 10.7",
          relative_suffix: " (9 päivän päästä)",
          until_suffix: " (10.8. asti)",
          time_suffix: "",
        }),
        makeEvent({
          summary: "Other",
          start_ts: day + 86_400_000,
          date_short: "La 11.7",
          time_suffix: "",
        }),
      ],
    };

    const { elements } = expandCalendarListElements(
      [{
        type: "calendarList",
        sourceId: "family_cal",
        pos: { x: 0, y: 0 },
        maxLines: 2,
        lineHeight: 20,
      }],
      ctx,
    );

    expect(elements).toHaveLength(2);
    expect(elements[0].text).toBe("Pe 10.7 (9 päivän päästä)");
    expect(elements[1].text).toBe("Summer holiday (10.8. asti)");
  });

  it("uses element row templates when provided", () => {
    const ctx = createDataContext();
    const day = Date.parse("2026-07-10T00:00:00+03:00");
    ctx.family_cal = {
      ...sampleSourceData,
      count: 1,
      events: [
        makeEvent({
          summary: "Team standup",
          start_ts: day,
          date_short: "Pe 10.7",
          days_until: 1,
          time_suffix: " 13:00",
        }),
      ],
    };

    const { elements } = expandCalendarListElements(
      [{
        type: "calendarList",
        sourceId: "family_cal",
        pos: { x: 0, y: 0 },
        maxLines: 4,
        dateRowTemplate: "{{date_short}} [{{days_until}}]",
        detailRowTemplate: "{{summary}} @ {{time_label}}",
      }],
      ctx,
    );

    expect(elements[0].text).toBe("Pe 10.7 [1]");
    expect(elements[1].text).toBe("Team standup @ 13:00");
  });

  it("passes through non-calendarList elements", () => {
    const ctx = createDataContext();
    const rect = { type: "rect", id: "r1", pos: { x: 0, y: 0 }, sizeX: 10, sizeY: 10 };

    const { elements } = expandCalendarListElements([rect], ctx);
    expect(elements).toEqual([rect]);
  });

  it("records error when sourceId is missing", () => {
    const ctx = createDataContext();
    const { elements, errors } = expandCalendarListElements(
      [{ type: "calendarList", id: "cl1", sourceId: "", pos: { x: 0, y: 0 } }],
      ctx,
    );
    expect(elements).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("sourceId is required");
  });
});
