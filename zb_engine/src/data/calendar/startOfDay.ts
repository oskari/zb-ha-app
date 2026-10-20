/**
 * startOfDay.ts — Timezone-explicit calendar-day helpers (ms timestamps).
 *
 * Kept free of server-only imports so the builder bundle can share it via the
 * `@shared/calendar` alias. Follows the expression engine convention: shift the
 * instant by an explicit UTC offset, then read UTC components.
 */

const DAY_MS = 86_400_000;

/** UTC offset (minutes east of UTC) of the process local timezone at `ts`. */
export function localOffsetMinutes(ts: number): number {
  return -new Date(ts).getTimezoneOffset();
}

/**
 * Start of the calendar day containing `ts` in a timezone `offsetMinutes` east
 * of UTC. Falls back to the process local offset when none is given.
 */
export function startOfDay(ts: number, offsetMinutes: number = localOffsetMinutes(ts)): number {
  const shifted = ts + offsetMinutes * 60_000;
  const dayStart = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS);
  return dayStart - offsetMinutes * 60_000;
}
