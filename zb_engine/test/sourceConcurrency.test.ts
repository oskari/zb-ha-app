/**
 * sourceConcurrency.test.ts — Phase 3 source fan-out resource guard tests.
 */

import { describe, expect, it } from "vitest";
import { createDataContext } from "@zb/expressions";
import {
  fetchAllSources,
  type AnySourceDef,
  type PlatformSourceHandler,
} from "../src/data/sourceFetcher";
import { MAX_SOURCE_CONCURRENCY } from "../src/limits";

function makePlatformSources(count: number): AnySourceDef[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `source_${index}`,
    kind: "haState",
    entity_id: `sensor.test_${index}`,
    enabled: true,
    dataFields: [],
  }));
}

describe("source fetching resource limits", () => {
  it("bounds in-flight platform source fetches while preserving source results", async () => {
    const sources = makePlatformSources(MAX_SOURCE_CONCURRENCY + 5);
    const ctx = createDataContext();
    let inFlight = 0;
    let maxInFlight = 0;

    const handler: PlatformSourceHandler = async (source) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { id: source.id };
    };

    const result = await fetchAllSources(sources, ctx, handler);

    expect(result.errors).toEqual([]);
    expect(maxInFlight).toBeLessThanOrEqual(MAX_SOURCE_CONCURRENCY);
    for (const source of sources) {
      expect(ctx[source.id]).toEqual({ id: source.id });
    }
  });

  it("keeps error attribution stable with bounded concurrency", async () => {
    const sources = makePlatformSources(6);
    const ctx = createDataContext();

    const handler: PlatformSourceHandler = async (source) => {
      await Promise.resolve();
      if (source.id === "source_3") throw new Error("simulated failure");
      return { id: source.id };
    };

    const result = await fetchAllSources(sources, ctx, handler);

    expect(result.errors).toEqual([{ sourceId: "source_3", message: "simulated failure" }]);
    expect(ctx.source_0).toEqual({ id: "source_0" });
    expect(ctx.source_3).toBeNull();
    expect(ctx.source_5).toEqual({ id: "source_5" });
  });
});
