/**
 * historyResult.ts — shared HA history result assembly
 *
 * Both the per-render history source (`haSources.ts`) and the Ingress
 * `/history` proxy (`haEntities.ts`) turn a downsampled point array into the
 * same `HaHistoryResult` shape (min/max/avg, latest, time bounds, axis
 * labels). This module is the single source of truth for that assembly and
 * its axis-label formatters so the two paths cannot drift.
 */

import type { HaHistoryResult, HaHistoryPoint } from "../data/sourceFetcher";

/** Format a numeric value for axis labels (integers as-is, floats to 1 decimal). */
export function formatValueLabel(v: number | null): string {
  if (v === null) return "--";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Format a Unix ms timestamp as HH:MM for axis labels. */
export function formatTimeLabel(ms: number | undefined): string {
  if (ms === undefined) return "--";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Assemble a `HaHistoryResult` from an already-downsampled point array.
 * Computes the min/max/avg over the numeric points, the latest value/state,
 * the time bounds, and the formatted axis labels. An empty `points` array
 * yields the canonical "no data" result (all-null stats, "--" labels).
 */
export function buildHistoryResult(
  entityId: string,
  hoursBack: number,
  points: HaHistoryPoint[],
  truncated: boolean,
): HaHistoryResult {
  const numeric = points.map((p) => p.v).filter((v): v is number => v !== null);
  const min = numeric.length ? Math.min(...numeric) : null;
  const max = numeric.length ? Math.max(...numeric) : null;
  const avg =
    numeric.length
      ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 100) / 100
      : null;
  const last = points.at(-1);

  const tMin = points.length > 0 ? points[0].t : 0;
  const tMax = points.length > 0 ? points[points.length - 1].t : 0;

  return {
    entity_id: entityId,
    hoursBack,
    points,
    min,
    max,
    avg,
    latest: last?.v ?? null,
    latestState: last?.s ?? "",
    count: points.length,
    tMin,
    tMax,
    labels: {
      tStart: formatTimeLabel(points[0]?.t),
      tEnd: formatTimeLabel(points.at(-1)?.t),
      vMin: formatValueLabel(min),
      vMax: formatValueLabel(max),
    },
    truncated,
  };
}
