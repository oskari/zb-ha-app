/** Start of local calendar day for a timestamp (ms). Duplicated here so the builder bundle does not pull in ha/calendarEvent.ts. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
