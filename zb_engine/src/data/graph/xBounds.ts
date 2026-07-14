/**
 * xBounds.ts — Resolve and apply X-axis time window bounds for graph elements
 *
 * Pure functions — no I/O. Consumed by normalizer, expander, and builder preview.
 */

import type { NormalizedPoint } from "./types";

/** Threshold above which X values are treated as Unix timestamps (seconds or ms). */
export const TIMESTAMP_X_THRESHOLD = 1e9;

const RELATIVE_NOW_RE = /^now([+-])(\d+)([mhd])$/i;

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a bound literal into epoch milliseconds.
 *
 * Accepts:
 *   - null / undefined / "" → null (auto)
 *   - finite number → epoch ms (values < 1e12 treated as seconds)
 *   - "now" → nowMs
 *   - "now+6h", "now-2h", "now+30m", "now+1d" → relative to nowMs
 *
 * Invalid strings return null.
 */
export function resolveXBound(raw: unknown, nowMs: number): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    if (trimmed.toLowerCase() === "now") return nowMs;

    const match = RELATIVE_NOW_RE.exec(trimmed);
    if (match) {
      const sign = match[1] === "+" ? 1 : -1;
      const amount = Number(match[2]);
      const unit = match[3].toLowerCase();
      const unitMs = UNIT_MS[unit];
      if (!Number.isFinite(amount) || amount < 0 || !unitMs) return null;
      return nowMs + sign * amount * unitMs;
    }

    // Plain numeric string
    const n = Number(trimmed);
    if (Number.isFinite(n)) return normalizeEpochMs(n);

    // ISO date string
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;

    return null;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return normalizeEpochMs(raw);
  }

  return null;
}

/** Normalize epoch seconds vs milliseconds to milliseconds. */
function normalizeEpochMs(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

/**
 * True when the series uses timestamp X values (not index-based).
 * Requires timePath to have been used during normalization.
 */
export function isTimestampSeries(
  points: NormalizedPoint[],
  timePath: string,
): boolean {
  if (!timePath || timePath.length === 0 || points.length === 0) return false;
  return points.some((p) => p.x > TIMESTAMP_X_THRESHOLD);
}

/** Normalize a timestamp X value to epoch milliseconds. */
export function timestampToMs(x: number): number {
  return x < 1e12 ? x * 1000 : x;
}

/** True when all timestamp points use Unix seconds (not ms). */
export function seriesUsesSecondTimestamps(points: NormalizedPoint[]): boolean {
  if (points.length === 0) return false;
  return points.every((p) => p.x < 1e12);
}

/** Convert a bound in ms to the same unit as the series X values. */
export function msBoundToSeriesUnit(ms: number, points: NormalizedPoint[]): number {
  return seriesUsesSecondTimestamps(points) ? ms / 1000 : ms;
}

/**
 * Filter points to those within [xMinMs, xMaxMs] (inclusive on both ends).
 * Null bounds mean no constraint on that side. Bounds are always in epoch ms.
 */
export function filterPointsByXWindow(
  points: NormalizedPoint[],
  xMinMs: number | null,
  xMaxMs: number | null,
): NormalizedPoint[] {
  if (xMinMs === null && xMaxMs === null) return points;
  return points.filter((p) => {
    const xMs = timestampToMs(p.x);
    if (xMinMs !== null && xMs < xMinMs) return false;
    if (xMaxMs !== null && xMs > xMaxMs) return false;
    return true;
  });
}
