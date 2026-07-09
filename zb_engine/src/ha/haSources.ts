/**
 * haSources.ts — HA-specific source handlers (haState + haHistory)
 *
 * These source kinds call the HA Supervisor API directly using
 * SUPERVISOR_TOKEN. They are internal calls — RFC1918 restrictions
 * intentionally do not apply.
 */

import { fetchWithTimeout, readResponseJsonWithLimit } from "../data/safeFetch";
import { downsampleLTTB } from "../data/downsampling";
import { buildHistoryResult } from "./historyResult";
import { buildHaCalendarResult, extractCalendarEventsFromServiceResponse } from "./calendarEvent";
import { SourceError } from "../errors/sourceError";
import { resolveValue } from "@zb/expressions";
import {
  MAX_HA_HISTORY_RESPONSE_BYTES,
  MAX_HA_HISTORY_POINTS_PER_ENTITY,
  MAX_SOURCE_TOTAL_TIMEOUT_MS,
} from "../limits";
import type { DataContext } from "@zb/expressions";
import type {
  AnySourceDef,
  HaStateSourceDef,
  HaHistorySourceDef,
  HaCalendarSourceDef,
  HaStateResult,
  HaHistoryResult,
  HaCalendarResult,
  HaHistoryPoint,
} from "../data/sourceFetcher";

// ── HA State source ────────────────────────────────────────────

async function fetchHaStateSource(
  source: HaStateSourceDef,
  signal?: AbortSignal,
): Promise<HaStateResult> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error(
      `[haState:${source.id}] SUPERVISOR_TOKEN not available — ` +
        `cannot fetch HA state outside of the add-on environment.`,
    );
  }

  const url = `http://supervisor/core/api/states/${encodeURIComponent(source.entity_id)}`;

  const res = await fetchWithTimeout(url, 10_000, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }, signal);

  if (!res.ok) {
    throw new Error(
      `[haState:${source.id}] HA States API returned HTTP ${res.status} ` +
        `for entity "${source.entity_id}".`,
    );
  }

  const entity = await readResponseJsonWithLimit<{
    state: string;
    attributes: Record<string, unknown>;
    last_changed: string;
    last_updated: string;
  }>(
    res,
    MAX_HA_HISTORY_RESPONSE_BYTES,
    MAX_SOURCE_TOTAL_TIMEOUT_MS,
    `[haState:${source.id}] response body`,
    signal,
  );

  const rawState = String(entity.state ?? "");
  const parsed = parseFloat(rawState);
  const attributes = entity.attributes ?? {};

  // If a specific attribute was requested, override the state/value with it
  if (source.attribute && source.attribute in attributes) {
    const attrVal = String(attributes[source.attribute] ?? "");
    const attrParsed = parseFloat(attrVal);
    return {
      entity_id: source.entity_id,
      state: attrVal,
      value: Number.isNaN(attrParsed) ? null : Math.round(attrParsed * 1000) / 1000,
      attributes,
      last_changed: entity.last_changed ?? "",
      last_updated: entity.last_updated ?? "",
    };
  }

  return {
    entity_id: source.entity_id,
    state: rawState,
    value: Number.isNaN(parsed) ? null : Math.round(parsed * 1000) / 1000,
    attributes,
    last_changed: entity.last_changed ?? "",
    last_updated: entity.last_updated ?? "",
  };
}

// ── HA History source ──────────────────────────────────────────

async function fetchHaHistorySource(
  source: HaHistorySourceDef,
  signal?: AbortSignal,
): Promise<HaHistoryResult> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error(
      `[haHistory:${source.id}] SUPERVISOR_TOKEN not available — ` +
        `cannot fetch HA history outside of the add-on environment.`,
    );
  }

  const now = new Date();
  const start = new Date(now.getTime() - source.hoursBack * 3_600_000);

  const params = new URLSearchParams({
    filter_entity_id: source.entity_id,
    end_time: now.toISOString(),
    minimal_response: "true",
    no_attributes: "true",
  });

  const url =
    `http://supervisor/core/api/history/period/` +
    `${encodeURIComponent(start.toISOString())}?${params}`;

  const res = await fetchWithTimeout(url, 10_000, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }, signal);

  if (!res.ok) {
    throw new Error(
      `[haHistory:${source.id}] HA History API returned HTTP ${res.status} ` +
        `for entity "${source.entity_id}".`,
    );
  }

  const raw = await readResponseJsonWithLimit<Array<Array<{ state: string; last_changed: string }>>>(
    res,
    MAX_HA_HISTORY_RESPONSE_BYTES,
    MAX_SOURCE_TOTAL_TIMEOUT_MS,
    `[haHistory:${source.id}] response body`,
    signal,
  );
  const entries = raw[0] ?? [];

  const allPoints: HaHistoryPoint[] = entries.map((entry) => {
    const s = String(entry.state ?? "");
    const parsedVal = parseFloat(s);
    return {
      t: new Date(entry.last_changed).getTime(),
      v: Number.isNaN(parsedVal) ? null : Math.round(parsedVal * 1000) / 1000,
      s,
    };
  });

  // Per-entity LTTB cap — bounds memory + downstream graph work on a Pi.
  const truncated = allPoints.length > MAX_HA_HISTORY_POINTS_PER_ENTITY;
  const points: HaHistoryPoint[] = truncated
    ? downsampleLTTB(allPoints, MAX_HA_HISTORY_POINTS_PER_ENTITY, (p) => p.t, (p) => p.v)
    : allPoints;

  return buildHistoryResult(source.entity_id, source.hoursBack, points, truncated);
}

// ── HA Calendar source ─────────────────────────────────────────

async function fetchHaCalendarSource(
  source: HaCalendarSourceDef,
  ctx: DataContext,
  signal?: AbortSignal,
): Promise<HaCalendarResult> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new SourceError(
      source.id,
      "SUPERVISOR_TOKEN not available — cannot fetch HA calendar outside of the add-on environment.",
    );
  }

  // calendar.get_events always returns response data; HA REST API requires
  // ?return_response or it responds with HTTP 400.
  const url = "http://supervisor/core/api/services/calendar/get_events?return_response";

  const res = await fetchWithTimeout(url, 10_000, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entity_id: source.entity_id,
      duration: { days: source.daysAhead },
    }),
  }, signal);

  if (!res.ok) {
    throw new SourceError(
      source.id,
      `HA calendar.get_events returned HTTP ${res.status} for entity "${source.entity_id}".`,
      res.status,
    );
  }

  const raw = await readResponseJsonWithLimit<unknown>(
    res,
    MAX_HA_HISTORY_RESPONSE_BYTES,
    MAX_SOURCE_TOTAL_TIMEOUT_MS,
    `[haCalendar:${source.id}] response body`,
    signal,
  );

  const rawEvents = extractCalendarEventsFromServiceResponse(raw, source.entity_id);

  const includeOngoing = resolveValue(source.includeOngoing ?? true, ctx) !== false;

  return buildHaCalendarResult(rawEvents, {
    entity_id: source.entity_id,
    daysAhead: source.daysAhead,
    maxEvents: source.maxEvents,
    includeOngoing,
    locale: source.locale,
    eventFilter: source.eventFilter,
    labelFormat: source.labelFormat ?? "card",
  });
}

// ── Unified source handler ─────────────────────────────────────

/**
 * Platform source handler for HA-specific source kinds.
 * Dispatches to the appropriate fetcher based on the source's `kind` field.
 * The optional `signal` is the per-render `AbortSignal` from `runPipeline`;
 * forwarding it ensures a render timeout actually cancels in-flight
 * Supervisor calls instead of leaving them running in the background.
 */
export async function haSourceHandler(
  source: AnySourceDef,
  ctx: DataContext,
  signal?: AbortSignal,
): Promise<unknown> {
  const kind = (source as { kind?: string }).kind;
  if (kind === "haState") {
    return fetchHaStateSource(source as HaStateSourceDef, signal);
  }
  if (kind === "haHistory") {
    return fetchHaHistorySource(source as HaHistorySourceDef, signal);
  }
  if (kind === "haCalendar") {
    return fetchHaCalendarSource(source as HaCalendarSourceDef, ctx, signal);
  }
  throw new Error(`Unknown HA source kind: ${kind}`);
}
