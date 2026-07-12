/**
 * calendarListExpand.test.ts — calendarList element expansion tests
 */

import { describe, it, expect } from "vitest";
import { createDataContext } from "@zb/expressions";
import { expandCalendarListElements } from "../src/data/calendar/expander";
import type { HaCalendarEvent, HaCalendarResult } from "../src/data/sourceFetcher";

function makeEvent(partial: Partial<HaCalendarEvent> & Pick<HaCalendarEvent, "start_ts" | "label">): HaCalendarEvent {
  return {
    summary: partial.summary ?? "Event",
    start: partial.start ?? "",
    end: partial.end ?? "",
    all_day: partial.all_day ?? false,
    end_ts: partial.end_ts ?? partial.start_ts + 3_600_000,
    detail_label: partial.detail_label ?? partial.label,
    subtitle: "",
    relative_label: partial.relative_label ?? "",
    date_heading: partial.date_heading ?? "pe 10.",
    date_label: partial.date_label ?? "10.07.",
    time_label: partial.time_label ?? "13:00",
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
      label: "pe 10.07. 13:00 A",
      detail_label: "13:00 A",
      date_heading: "pe 10.",
    }),
    makeEvent({
      summary: "B",
      start_ts: 86_400_001,
      label: "la 11.07. 10:00 B",
      detail_label: "10:00 B",
      date_heading: "la 11.",
    }),
    makeEvent({
      summary: "C",
      start_ts: 172_800_001,
      label: "su 12.07. 09:00 C",
      detail_label: "09:00 C",
      date_heading: "su 12.",
    }),
  ],
};

describe("expandCalendarListElements", () => {
  it("expands one standalone line per event on different days", () => {
    const ctx = createDataContext();
    ctx.family_cal = sampleSourceData;

    const { elements, errors } = expandCalendarListElements(
      [{
        type: "calendarList",
        id: "cl1",
        sourceId: "family_cal",
        pos: { x: 24, y: 224 },
        lineHeight: 20,
        maxLines: 5,
        fontSize: 12,
        enableFill: true,
        fill: 100,
      }],
      ctx,
    );

    expect(errors).toEqual([]);
    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ type: "text", text: "pe 10.07. 13:00 A", pos: { x: 24, y: 224 } });
    expect(elements[1]).toMatchObject({ type: "text", pos: { x: 24, y: 244 } });
    expect(elements[2]).toMatchObject({ type: "text", pos: { x: 24, y: 264 } });
  });

  it("groups same-day events under one date heading", () => {
    const ctx = createDataContext();
    const day = Date.parse("2026-07-10T00:00:00+03:00");
    ctx.family_cal = {
      ...sampleSourceData,
      count: 2,
      events: [
        makeEvent({
          summary: "Standup",
          start_ts: day + 13 * 3_600_000,
          label: "pe 10. 13:00 Team standup",
          detail_label: "13:00 Team standup",
          date_heading: "pe 10.",
          relative_label: "(+1pv)",
        }),
        makeEvent({
          summary: "Dentist",
          start_ts: day + 15 * 3_600_000,
          label: "pe 10. 15:00 Dentist",
          detail_label: "15:00 Dentist",
          date_heading: "pe 10.",
          relative_label: "(+1pv)",
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
    expect(elements[0]).toMatchObject({ text: "pe 10. (+1pv)", fontWeight: 600 });
    expect(elements[1]).toMatchObject({ text: "13:00 Team standup", fontWeight: 400 });
    expect(elements[2]).toMatchObject({ text: "15:00 Dentist", fontWeight: 400 });
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

  it("caps output to maxLines including group headings", () => {
    const ctx = createDataContext();
    const day = Date.parse("2026-07-10T00:00:00+03:00");
    ctx.family_cal = {
      ...sampleSourceData,
      count: 3,
      events: [
        makeEvent({
          summary: "A",
          start_ts: day + 3_600_000,
          label: "pe 10. 10:00 A",
          detail_label: "10:00 A",
          date_heading: "pe 10.",
        }),
        makeEvent({
          summary: "B",
          start_ts: day + 7_200_000,
          label: "pe 10. 11:00 B",
          detail_label: "11:00 B",
          date_heading: "pe 10.",
        }),
        makeEvent({
          summary: "C",
          start_ts: day + 86_400_000 + 3_600_000,
          label: "la 11. 10:00 C",
          detail_label: "10:00 C",
          date_heading: "la 11.",
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
    expect(elements[0].text).toBe("pe 10.");
    expect(elements[1].text).toBe("10:00 A");
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
