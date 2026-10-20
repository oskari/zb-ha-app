/**
 * calendarListBounds.test.js — builder bounds use the shared server layout.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { getCalendarListLayoutMetrics } from '../calendarListBounds.js';
import { buildCalendarListRows } from '@shared/calendar/listLayout.ts';
import { MAX_CALENDAR_LIST_LINES } from '../../../../src/limits.ts';

const day = Date.parse('2026-07-10T00:00:00+03:00');
const ev = (hour, summary) => ({
  summary,
  start_ts: day + hour * 3_600_000,
  utc_offset_minutes: 180,
  date_short: 'Pe 10.7',
  relative_suffix: '',
  time_suffix: ` ${hour}:00`,
  until_suffix: '',
});

describe('getCalendarListLayoutMetrics', () => {
  it('caps maxLines at the server MAX_CALENDAR_LIST_LINES', () => {
    const metrics = getCalendarListLayoutMetrics({ maxLines: 999 });
    expect(metrics.maxLines).toBe(MAX_CALENDAR_LIST_LINES);
  });

  it('counts rendered lines with the shared listLayout (same-day grouping)', () => {
    const events = [ev(9, 'A'), ev(10, 'B')];
    const metrics = getCalendarListLayoutMetrics({ maxLines: 5 }, events);
    expect(metrics.renderedLines).toBe(3);
    expect(buildCalendarListRows(events, 5).map((r) => r.text))
      .toEqual(['Pe 10.7', 'A 9:00', 'B 10:00']);
  });
});
