/**
 * normalizer.ts — Normalize raw source data into chart-ready points
 *
 * Handles diverse data shapes from any source kind (HA history, HTTP APIs):
 *   - Nested arrays via dot-path walking
 *   - Numeric, ISO date, and Unix timestamp X values
 *   - Flat arrays (items are the Y values, index is X)
 *   - Null/missing value gaps
 *   - Downsampling to prevent element count explosion
 */

import type { NormalizedPoint } from "./types";
import { walkPath } from "../dataFieldExtractor";
import { downsampleLTTB } from "../downsampling";
import { DEFAULT_MAX_GRAPH_POINTS } from "../../limits";

// ── Time parsing ───────────────────────────────────────────────

/**
 * Parse a time/X value into a numeric value:
 *   - Already a number → return as-is (Unix ms if > 1e10, seconds if < 1e10)
 *   - ISO date string → parse to epoch ms
 *   - Any other string → attempt parseFloat
 *   - Unparseable → null
 */
function parseTimeValue(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    // Try ISO date parse first
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
    // Try plain number string
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a Y value into a number. Null/undefined/NaN → null (data gap).
 */
function parseNumericValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Downsampling ───────────────────────────────────────────────
//
// LTTB lives in `../downsampling.ts` so the HA history fetchers can
// reuse it (ENGINEERING_CONSTRAINTS §6 — single source of truth).

// ── Public API ─────────────────────────────────────────────────

/**
 * Normalize raw source data into an array of chart-ready points.
 *
 * @param sourceData  The raw data from the resolved source context
 * @param dataPath    Dot-path to the array within sourceData (empty = root)
 * @param valuePath   Dot-path within each item to extract Y value (empty = item itself)
 * @param timePath    Dot-path within each item to extract X value (empty = use index)
 * @param maxPoints       Maximum points after LTTB downsampling (default: 200)
 * @param dataRangeStart  Start of the data window as a percentage 0–100 (default: 0)
 * @param dataRangeEnd    End of the data window as a percentage 0–100 (default: 100)
 * @returns Sorted, downsampled array of NormalizedPoints
 */
export function normalizeDataPoints(
  sourceData: unknown,
  dataPath: string,
  valuePath: string,
  timePath: string,
  maxPoints: number = DEFAULT_MAX_GRAPH_POINTS,
  dataRangeStart: number = 0,
  dataRangeEnd: number = 100,
): NormalizedPoint[] {
  // Step 1: Locate the data array
  let arr: unknown = sourceData;
  if (dataPath && dataPath.length > 0) {
    arr = walkPath(sourceData, dataPath);
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    return [];
  }

  // Step 2: Extract x/y from each item
  const raw: NormalizedPoint[] = [];

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];

    // Y value
    let yRaw: unknown;
    if (valuePath && valuePath.length > 0) {
      yRaw = typeof item === "object" && item !== null ? walkPath(item, valuePath) : item;
    } else {
      yRaw = item;
    }
    const y = parseNumericValue(yRaw);

    // X value
    let x: number | null;
    if (timePath && timePath.length > 0) {
      const xRaw = typeof item === "object" && item !== null ? walkPath(item, timePath) : null;
      x = parseTimeValue(xRaw);
    } else {
      x = i; // Index-based X-axis
    }

    if (x === null) continue; // Skip points with unparseable X

    raw.push({ x, y });
  }

  // Step 3: Sort by X ascending
  raw.sort((a, b) => a.x - b.x);

  // Step 3b: Apply percentage-based data window (slice before downsampling)
  const rStart = Math.max(0, Math.min(dataRangeStart, 100));
  const rEnd = Math.max(0, Math.min(dataRangeEnd, 100));
  if (rStart > 0 || rEnd < 100) {
    const lo = Math.floor((rStart / 100) * raw.length);
    const hi = Math.ceil((rEnd / 100) * raw.length);
    raw.splice(0, raw.length, ...raw.slice(lo, hi));
  }

  if (raw.length === 0) return [];

  // Step 4: Downsample if necessary (clamp to safe range)
  const cap = Math.max(3, Math.min(maxPoints, DEFAULT_MAX_GRAPH_POINTS));
  return downsampleLTTB(raw, cap, (p) => p.x, (p) => p.y);
}
