/**
 * calendarListExpand.test.ts — calendarList element expansion tests
 */

import { describe, it, expect } from "vitest";
import { createDataContext } from "@zb/expressions";
import { expandCalendarListElements } from "../src/data/calendar/expander";
import type { HaCalendarResult } from "../src/data/sourceFetcher";

const sampleSourceData: HaCalendarResult = {
  entity_id: "family_cal",
  daysAhead: 14,
  count: 3,
  truncated: false,
  events: [
    {
      summary: "A",
      start: "2026-07-10T13:00:00+03:00",
      end: "2026-07-10T15:00:00+03:00",
      all_day: false,
      start_ts: 1,
      end_ts: 2,
      label: "pe 10.07. 13:00 A",
      subtitle: "13:00 - 15:00",
      relative_label: "",
      date_heading: "pe 10.7.",
      date_label: "10.07.",
      time_label: "13:00",
      weekday_short: "pe",
    },
    {
      summary: "B",
      start: "2026-07-11T10:00:00+03:00",
      end: "2026-07-11T11:00:00+03:00",
      all_day: false,
      start_ts: 3,
      end_ts: 4,
      label: "la 11.07. 10:00 B",
      subtitle: "10:00 - 11:00",
      relative_label: "",
      date_heading: "la 11.7.",
      date_label: "11.07.",
      time_label: "10:00",
      weekday_short: "la",
    },
    {
      summary: "C",
      start: "2026-07-12T09:00:00+03:00",
      end: "2026-07-12T10:00:00+03:00",
      all_day: false,
      start_ts: 5,
      end_ts: 6,
      label: "su 12.07. 09:00 C",
      subtitle: "09:00 - 10:00",
      relative_label: "",
      date_heading: "su 12.7.",
      date_label: "12.07.",
      time_label: "09:00",
      weekday_short: "su",
    },
  ],
};

describe("expandCalendarListElements", () => {
  it("expands card layout into title + subtitle lines", () => {
    const ctx = createDataContext();
    ctx.family_cal = sampleSourceData;

    const { elements, errors } = expandCalendarListElements(
      [{
        type: "calendarList",
        id: "cl1",
        sourceId: "family_cal",
        pos: { x: 24, y: 224 },
        lineHeight: 36,
        maxLines: 5,
        layout: "card",
        fontSize: 16,
        enableFill: true,
        fill: 100,
      }],
      ctx,
    );

    expect(errors).toEqual([]);
    expect(elements).toHaveLength(6);
    expect(elements[0]).toMatchObject({ type: "text", text: "pe 10.07. 13:00 A", pos: { x: 24, y: 224 } });
    expect(elements[1]).toMatchObject({ type: "text", text: "13:00 - 15:00", pos: { x: 24, y: 260 } });
    expect(elements[2]).toMatchObject({ type: "text", pos: { x: 24, y: 296 } });
    expect(elements[3]).toMatchObject({ type: "text", pos: { x: 24, y: 332 } });
  });

  it("expands compact layout into one line per event", () => {
    const ctx = createDataContext();
    ctx.family_cal = sampleSourceData;

    const { elements } = expandCalendarListElements(
      [{
        type: "calendarList",
        sourceId: "family_cal",
        pos: { x: 24, y: 224 },
        lineHeight: 36,
        maxLines: 5,
        layout: "compact",
      }],
      ctx,
    );

    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ type: "text", text: "pe 10.07. 13:00 A", pos: { x: 24, y: 224 } });
    expect(elements[1]).toMatchObject({ type: "text", pos: { x: 24, y: 260 } });
    expect(elements[2]).toMatchObject({ type: "text", pos: { x: 24, y: 296 } });
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

  it("caps output to maxLines", () => {
    const ctx = createDataContext();
    ctx.family_cal = sampleSourceData;

    const { elements } = expandCalendarListElements(
      [{
        type: "calendarList",
        sourceId: "family_cal",
        pos: { x: 0, y: 0 },
        maxLines: 2,
        lineHeight: 20,
        layout: "compact",
      }],
      ctx,
    );

    expect(elements).toHaveLength(2);
    expect(elements[0].text).toBe("pe 10.07. 13:00 A");
    expect(elements[1].text).toBe("la 11.07. 10:00 B");
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
