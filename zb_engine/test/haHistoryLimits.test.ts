/**
 * haHistoryLimits.test.ts — bounds applied to HA Supervisor history responses
 *
 * Covers the per-entity LTTB cap, the batch-wide total-points cap, and
 * the body-size cap.
 *
 * Strategy: mock `fetchWithTimeout` from `../src/data/safeFetch` so we
 * can return whatever upstream payload we need without actually reaching
 * a Supervisor socket.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  MAX_HA_HISTORY_RESPONSE_BYTES,
  MAX_HA_HISTORY_POINTS_PER_ENTITY,
  MAX_HA_HISTORY_TOTAL_POINTS,
} from "../src/limits";

// One shared mock so every test in this file shares the same instance.
const mockFetch = vi.fn();
vi.mock("../src/data/safeFetch", async () => {
  const actual = await vi.importActual<typeof import("../src/data/safeFetch")>(
    "../src/data/safeFetch",
  );
  return {
    ...actual,
    fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  };
});

import { fetchHaHistoryBatch } from "../src/ha/haEntities";
import { haSourceHandler } from "../src/ha/haSources";
import { ResponseBodyTooLargeError } from "../src/data/safeFetch";
import { createDataContext } from "@zb/expressions";

// ── Helpers ────────────────────────────────────────────────────

/**
 * Build a fake `Response` whose body is read via `.text()`. The
 * `readResponseTextWithLimit` fallback path is taken when `body` is
 * null, which keeps the mock simple and exercises the same byte-cap
 * logic as a real streamed response.
 */
function mockResponseFromJson(payload: unknown, ok = true, status = 200): Response {
  const text = JSON.stringify(payload);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    headers: new Map(),
    body: null,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/**
 * Build a Response whose `.text()` returns `byteLength` bytes — used
 * to trigger `ResponseBodyTooLargeError` without allocating a real
 * 4 MiB JSON document up front.
 */
function mockOversizeResponse(byteLength: number): Response {
  const filler = "a".repeat(byteLength);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map(),
    body: null,
    text: () => Promise.resolve(filler),
  } as unknown as Response;
}

function makeRawHistoryEntries(entityId: string, count: number): Array<{
  entity_id?: string;
  state: string;
  last_changed: string;
}> {
  const out: Array<{ entity_id?: string; state: string; last_changed: string }> = [];
  const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < count; i++) {
    out.push({
      entity_id: i === 0 ? entityId : undefined, // Supervisor shape: id only on first entry
      state: String((i % 100) + 0.5),
      last_changed: new Date(t0 + i * 60_000).toISOString(),
    });
  }
  return out;
}

beforeEach(() => {
  process.env.SUPERVISOR_TOKEN = "test-token";
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.SUPERVISOR_TOKEN;
});

// ── Body-size cap ──────────────────────────────────────────────

describe("HA history — response body size cap", () => {
  it("throws ResponseBodyTooLargeError when one batch response exceeds the byte cap", async () => {
    mockFetch.mockResolvedValueOnce(mockOversizeResponse(MAX_HA_HISTORY_RESPONSE_BYTES + 1));
    await expect(fetchHaHistoryBatch(["sensor.a"], 24)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
  });

  it("propagates ResponseBodyTooLargeError from the single-source haHistory fetcher", async () => {
    mockFetch.mockResolvedValueOnce(mockOversizeResponse(MAX_HA_HISTORY_RESPONSE_BYTES + 1));
    await expect(
      haSourceHandler(
        {
          id: "src",
          kind: "haHistory",
          entity_id: "sensor.a",
          hoursBack: 24,
        } as never,
        createDataContext(),
      ),
    ).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });
});

// ── Per-entity LTTB cap ────────────────────────────────────────

describe("HA history — per-entity downsampling", () => {
  it("downsamples a single entity over the per-entity cap and flags truncated=true", async () => {
    const entries = makeRawHistoryEntries("sensor.big", MAX_HA_HISTORY_POINTS_PER_ENTITY + 500);
    mockFetch.mockResolvedValueOnce(mockResponseFromJson([entries]));

    const result = await fetchHaHistoryBatch(["sensor.big"], 24);

    expect(result["sensor.big"].truncated).toBe(true);
    expect(result["sensor.big"].points.length).toBe(MAX_HA_HISTORY_POINTS_PER_ENTITY);
    // Endpoints preserved by LTTB.
    expect(result["sensor.big"].points[0].t).toBe(Date.UTC(2024, 0, 1));
    expect(result["sensor.big"].points.at(-1)?.t).toBe(
      Date.UTC(2024, 0, 1) + (MAX_HA_HISTORY_POINTS_PER_ENTITY + 499) * 60_000,
    );
  });

  it("leaves a small entity untouched and flags truncated=false", async () => {
    const entries = makeRawHistoryEntries("sensor.small", 100);
    mockFetch.mockResolvedValueOnce(mockResponseFromJson([entries]));

    const result = await fetchHaHistoryBatch(["sensor.small"], 24);

    expect(result["sensor.small"].truncated).toBe(false);
    expect(result["sensor.small"].points.length).toBe(100);
  });

  it("downsamples an haHistory source over the per-entity cap and sets truncated", async () => {
    const entries = makeRawHistoryEntries("sensor.big", MAX_HA_HISTORY_POINTS_PER_ENTITY + 500);
    mockFetch.mockResolvedValueOnce(mockResponseFromJson([entries]));

    const result = (await haSourceHandler(
      {
        id: "src",
        kind: "haHistory",
        entity_id: "sensor.big",
        hoursBack: 24,
      } as never,
      createDataContext(),
    )) as { truncated: boolean; points: unknown[] };

    expect(result.truncated).toBe(true);
    expect(result.points.length).toBe(MAX_HA_HISTORY_POINTS_PER_ENTITY);
  });
});

// ── Batch-wide cap ─────────────────────────────────────────────

describe("HA history — batch-wide total-points cap", () => {
  it("shrinks tail entities so cumulative points stay within MAX_HA_HISTORY_TOTAL_POINTS", async () => {
    // Eleven entities at the per-entity cap → 22 000 raw points after
    // per-entity LTTB, which is over the 20 000 total cap. The first
    // entities should keep their full per-entity budget; later
    // entities in the requested order should be squeezed.
    const ids: string[] = [];
    const rawBatches: Array<ReturnType<typeof makeRawHistoryEntries>> = [];
    for (let i = 0; i < 11; i++) {
      const id = `sensor.e${i}`;
      ids.push(id);
      rawBatches.push(makeRawHistoryEntries(id, MAX_HA_HISTORY_POINTS_PER_ENTITY + 1));
    }
    mockFetch.mockResolvedValueOnce(mockResponseFromJson(rawBatches));

    const result = await fetchHaHistoryBatch(ids, 24);

    const totalPoints = ids.reduce((acc, id) => acc + result[id].points.length, 0);
    expect(totalPoints).toBeLessThanOrEqual(MAX_HA_HISTORY_TOTAL_POINTS);

    // At least one entity must have been squeezed below the per-entity cap
    // (proves the batch-wide budget is enforced, not just the per-entity one).
    const squeezed = ids.some((id) => result[id].points.length < MAX_HA_HISTORY_POINTS_PER_ENTITY);
    expect(squeezed).toBe(true);

    // Every result with truncated=true must actually have fewer points
    // than the upstream supplied.
    for (const id of ids) {
      if (result[id].truncated) {
        expect(result[id].points.length).toBeLessThan(MAX_HA_HISTORY_POINTS_PER_ENTITY + 1);
      }
    }
  });

  it("missing entities still get stub results with truncated=false", async () => {
    mockFetch.mockResolvedValueOnce(mockResponseFromJson([]));
    const result = await fetchHaHistoryBatch(["sensor.missing"], 24);
    expect(result["sensor.missing"]).toEqual(
      expect.objectContaining({
        entity_id: "sensor.missing",
        points: [],
        count: 0,
        truncated: false,
      }),
    );
  });
});
