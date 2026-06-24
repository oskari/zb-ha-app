/**
 * haEntities.ts — HA Supervisor entity proxy routes
 *
 * Provides /entities and /history endpoints that proxy requests to the
 * HA Supervisor API. Only used on the Ingress port (8099), where HA
 * enforces session auth before any request reaches this code.
 */

import type { Application, Request, Response } from "express";
import { fetchWithTimeout, readResponseJsonWithLimit } from "../data/safeFetch";
import { downsampleLTTB } from "../data/downsampling";
import { buildHistoryResult } from "./historyResult";
import {
  MAX_HA_HISTORY_RESPONSE_BYTES,
  MAX_HA_HISTORY_POINTS_PER_ENTITY,
  MAX_HA_HISTORY_TOTAL_POINTS,
  MAX_SOURCE_TOTAL_TIMEOUT_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_HA_PROXY,
} from "../limits";
import type { HaHistoryResult, HaHistoryPoint } from "../data/sourceFetcher";
import { rateLimit } from "../core/rateLimiter";
import { getRequestId, logWarn } from "../core/logger";

/** Validated HA entity_id format: domain.object_id (e.g. sensor.temperature) */
const HA_ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;

/**
 * Fetch the full entity state list from the HA Supervisor API.
 */
export async function fetchHaEntities(signal?: AbortSignal): Promise<unknown[]> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) throw new Error("SUPERVISOR_TOKEN environment variable not available.");

  const res = await fetchWithTimeout("http://supervisor/core/api/states", 10_000, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }, signal);

  if (!res.ok) throw new Error(`HA Supervisor API returned HTTP ${res.status}`);
  return res.json() as Promise<unknown[]>;
}

/**
 * Fetch history for multiple entities in one HA Supervisor API call.
 * Returns a map of entity_id → HaHistoryResult.
 */
export async function fetchHaHistoryBatch(
  entityIds: string[],
  hoursBack: number,
  signal?: AbortSignal,
): Promise<Record<string, HaHistoryResult>> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error(
      "SUPERVISOR_TOKEN not available — cannot fetch HA history outside of the add-on environment.",
    );
  }

  const now = new Date();
  const start = new Date(now.getTime() - hoursBack * 3_600_000);

  const params = new URLSearchParams({
    filter_entity_id: entityIds.join(","),
    end_time: now.toISOString(),
    minimal_response: "true",
    no_attributes: "true",
  });

  const url =
    `http://supervisor/core/api/history/period/` +
    `${encodeURIComponent(start.toISOString())}?${params}`;

  const res = await fetchWithTimeout(url, 30_000, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }, signal);

  if (!res.ok) {
    throw new Error(`HA History API returned HTTP ${res.status}.`);
  }

  const raw = await readResponseJsonWithLimit<Array<
    Array<{ entity_id?: string; state: string; last_changed: string }>
  >>(
    res,
    MAX_HA_HISTORY_RESPONSE_BYTES,
    MAX_SOURCE_TOTAL_TIMEOUT_MS,
    "HA history batch response body",
    signal,
  );

  // First pass: parse every entity's points into HaHistoryPoint arrays
  // keyed by entity_id. We do per-entity downsampling AFTER the
  // batch-wide budget pass so truncation is deterministic in the
  // requested-id order rather than HA's response order.
  const parsedByEntity: Record<string, HaHistoryPoint[]> = {};
  for (const entityHistory of raw) {
    if (!entityHistory || entityHistory.length === 0) continue;
    const entityId = entityHistory[0].entity_id ?? "";
    if (!entityId) continue;
    parsedByEntity[entityId] = entityHistory.map((entry) => {
      const s = String(entry.state ?? "");
      const parsed = parseFloat(s);
      return {
        t: new Date(entry.last_changed).getTime(),
        v: Number.isNaN(parsed) ? null : Math.round(parsed * 1000) / 1000,
        s,
      };
    });
  }

  const result: Record<string, HaHistoryResult> = {};

  // Walk requested ids in order so the batch-wide cap shrinks the tail
  // deterministically rather than whichever entity HA happened to put
  // first in its response.
  let pointsRemaining = MAX_HA_HISTORY_TOTAL_POINTS;
  for (const entityId of entityIds) {
    const allPoints = parsedByEntity[entityId];
    if (!allPoints) continue;

    // Per-entity cap first, then squeeze further if the batch budget
    // for the remaining ids is tighter. The total budget is hard:
    // when it is exhausted, later entities get an empty `points` array
    // and `truncated: true` rather than silently exceeding the cap.
    const perEntityBudget = Math.min(
      MAX_HA_HISTORY_POINTS_PER_ENTITY,
      Math.max(0, pointsRemaining),
    );
    const truncated = allPoints.length > perEntityBudget;
    let points: HaHistoryPoint[];
    if (!truncated) {
      points = allPoints;
    } else if (perEntityBudget >= 3) {
      points = downsampleLTTB(allPoints, perEntityBudget, (p) => p.t, (p) => p.v);
    } else if (perEntityBudget === 2 && allPoints.length >= 2) {
      // LTTB needs at least 3 points; below that, keep first + last so
      // axis labels stay meaningful.
      points = [allPoints[0], allPoints[allPoints.length - 1]];
    } else if (perEntityBudget === 1) {
      points = [allPoints[allPoints.length - 1]];
    } else {
      points = [];
    }
    pointsRemaining -= points.length;

    result[entityId] = buildHistoryResult(entityId, hoursBack, points, truncated);
  }

  // Guarantee every requested entity has an entry, even if HA returned nothing
  for (const id of entityIds) {
    if (!result[id]) {
      result[id] = buildHistoryResult(id, hoursBack, [], false);
    }
  }

  return result;
}

/**
 * Register HA-specific entity proxy routes on the Express app.
 * These routes are only available on the Ingress port.
 */
export function registerEntityRoutes(app: Application): void {
  // Throttle the Supervisor proxy routes — each call fans out to the HA
  // Supervisor API, so an authenticated client should not be able to hammer
  // them (and the Supervisor) unbounded.
  const proxyLimiter = rateLimit("ha-proxy", RATE_LIMIT_WINDOW_MS, RATE_LIMIT_HA_PROXY);

  // GET /entities — proxy HA entity list
  app.get("/entities", proxyLimiter, async (req: Request, res: Response) => {
    try {
      const entities = await fetchHaEntities();
      res.json(entities);
    } catch (err) {
      logWarn("source.fetch.failure", {
        requestId: getRequestId(req),
        route: "GET /entities",
        sourceKind: "haEntities",
        error: err,
      });
      res.status(500).json({ error: "Failed to fetch entities." });
    }
  });

  // GET /history — batch-fetch HA state history
  // Query params:
  //   entity_ids  comma-separated list of entity IDs (required)
  //   hours       1-168, default 24
  app.get("/history", proxyLimiter, async (req: Request, res: Response) => {
    const entityIdsParam = (req.query.entity_ids as string) ?? "";
    const hoursRaw = parseFloat(req.query.hours as string);
    const hours = Number.isNaN(hoursRaw)
      ? 24
      : Math.min(Math.max(Math.round(hoursRaw), 1), 168);

    const entityIds = entityIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (entityIds.length === 0) {
      res.status(400).json({ error: "Missing or empty entity_ids query parameter." });
      return;
    }

    const MAX_ENTITY_BATCH = 50;
    if (entityIds.length > MAX_ENTITY_BATCH) {
      res.status(400).json({
        error: `Too many entities (${entityIds.length}). Maximum is ${MAX_ENTITY_BATCH} per request.`,
      });
      return;
    }

    const invalid = entityIds.filter((id) => !HA_ENTITY_ID_RE.test(id));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid entity_id format: ${invalid.join(", ")}` });
      return;
    }

    try {
      const history = await fetchHaHistoryBatch(entityIds, hours);
      // Top-level `truncated` aggregates per-entity flags so callers
      // (the builder) can render a single warning pill without iterating
      // every key. Safe to add: valid HA entity IDs always contain a dot,
      // so this key cannot collide with one.
      const truncated = Object.values(history).some((r) => r.truncated);
      res.json({ ...history, truncated });
    } catch (err) {
      logWarn("source.fetch.failure", {
        requestId: getRequestId(req),
        route: "GET /history",
        sourceKind: "haHistoryBatch",
        error: err,
      });
      res.status(500).json({ error: "Failed to fetch history." });
    }
  });
}
