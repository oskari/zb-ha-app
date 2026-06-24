/**
 * renderTimeoutCancellation.test.ts — a render timeout must actually cancel
 * the inner pipeline: propagate the per-render AbortSignal to every async leaf
 * and keep RenderGuard held until the work has truly stopped, so a new render
 * cannot start while the timed-out one is still consuming CPU.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Force a tiny render timeout so the test exercises the abort path
// quickly. The mock MUST be defined before importing renderService.
vi.mock("../src/limits", async () => {
  const actual = await vi.importActual<typeof import("../src/limits")>("../src/limits");
  return {
    ...actual,
    RENDER_TIMEOUT_MS: 200,
  };
});

import { runPipeline, RenderTimeoutError } from "../src/core/renderService";
import type { SourceHandler } from "../src/core/renderService";

const tinyPayload = {
  misc: { size: { width: 8, height: 8 }, format: "png" as const, gridSize: "1x1" },
  features: {},
  sources: [
    { id: "slow", kind: "haState" as const, entity_id: "sensor.test" },
  ],
  elements: [],
};

describe("render timeout cancellation", () => {
  // Each test uses a distinct payload so the sha1-keyed render-result cache
  // does not bleed between tests.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("propagates AbortSignal to source handler and source observes cancellation", async () => {
    let inflight = 0;
    let observedAbort = false;

    const slowHandler: SourceHandler = (_source, _ctx, signal) =>
      new Promise<unknown>((resolve, reject) => {
        inflight++;
        const t = setTimeout(() => {
          inflight--;
          resolve({ value: 1 });
        }, 5_000);
        // Cancellation contract: resolve quickly when the render-level
        // signal fires. The bug we are guarding against is "loser of
        // Promise.race keeps running" — the source handler is exactly
        // the kind of leaf that used to run silently for the full 5s.
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          inflight--;
          observedAbort = true;
          reject(new Error("RENDER_ABORTED"));
        }, { once: true });
      });

    const payload = { ...tinyPayload, sources: [{ id: "slow", kind: "haState" as const, entity_id: "sensor.test" }] };

    const start = Date.now();
    await expect(runPipeline(payload, slowHandler, null)).rejects.toBeInstanceOf(RenderTimeoutError);
    const elapsed = Date.now() - start;

    // Sanity: timeout fires near 200ms (the mocked RENDER_TIMEOUT_MS),
    // not near the source handler's 5s sleep.
    expect(elapsed).toBeLessThan(2_000);

    // Inflight must drain promptly after the rejection — proves the
    // source handler observed the abort and tore its work down, rather
    // than keeping the timer alive in the background past the
    // RenderGuard release.
    await new Promise((r) => setTimeout(r, 250));
    expect(observedAbort).toBe(true);
    expect(inflight).toBe(0);
  });

  it("RenderGuard is held until the pipeline actually settles (no hidden background work)", async () => {
    const request = (await import("supertest")).default;
    const { createIngressApp } = await import("../src/core/server");
    const type = await import("../src/core/adapters");

    let secondRenderHandlerCalled = false;
    let firstRenderHandlerInflight = 0;

    // First payload: triggers the slow source handler path.
    // Second payload: empty source list, so the render completes
    // immediately once it can acquire the guard.
    const firstPayload = {
      misc: { size: { width: 8, height: 8 }, format: "png", gridSize: "1x1" },
      features: {},
      sources: [{ id: "slow", kind: "haState", entity_id: "sensor.test" }],
      elements: [],
    };
    const secondPayload = {
      misc: { size: { width: 8, height: 8 }, format: "png", gridSize: "1x1" },
      features: {},
      sources: [],
      elements: [],
    };

    const sourceHandler: SourceHandler = (source, _ctx, signal) => {
      if ((source as { kind?: string }).kind === "haState") {
        return new Promise<unknown>((resolve, reject) => {
          firstRenderHandlerInflight++;
          const t = setTimeout(() => {
            firstRenderHandlerInflight--;
            resolve({ value: 1 });
          }, 5_000);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            firstRenderHandlerInflight--;
            reject(new Error("RENDER_ABORTED"));
          }, { once: true });
        });
      }
      secondRenderHandlerCalled = true;
      return Promise.resolve(null);
    };

    const mockStorage: type.StorageAdapter = {
      readWidget: async () => null,
      writeWidget: async () => {},
      deleteWidget: async () => false,
      listWidgets: async () => [],
      readPayload: async () => null,
      writePayload: async () => false,
      writeCachedImage: async () => false,
      getCachedImagePath: () => null,
    };
    const mockAdapter: type.PlatformAdapter = {
      storage: mockStorage,
      registerRoutes() {},
      getBlockedHostnames: () => [],
      getSourceHandler: () => sourceHandler,
    };

    const { ingressApp } = createIngressApp(mockAdapter);

    // Fire-and-await the first render — it will time out around 200ms.
    const firstStart = Date.now();
    const firstRes = await request(ingressApp).post("/render").send(firstPayload);
    const firstElapsed = Date.now() - firstStart;

    // Should be a 5xx of some kind; the exact code is set by the
    // shared error mapper. We only care that it failed promptly.
    expect(firstRes.status).toBeGreaterThanOrEqual(500);
    expect(firstElapsed).toBeLessThan(2_000);

    // After the route returns, the source handler MUST have torn down.
    // If `RenderGuard` were released while the source handler was
    // still in flight (the bug), inflight would still be 1 here.
    expect(firstRenderHandlerInflight).toBe(0);

    // Second render must acquire the guard promptly. Allow a generous
    // budget but well below the slow handler's 5s sleep.
    const secondStart = Date.now();
    const secondRes = await request(ingressApp).post("/render").send(secondPayload);
    const secondElapsed = Date.now() - secondStart;

    expect(secondRes.status).toBe(200);
    expect(secondElapsed).toBeLessThan(2_000);
    expect(secondRenderHandlerCalled).toBe(false); // empty sources list
  });

  it("aborted=true is surfaced on the render.failed log entry on timeout", async () => {
    const request = (await import("supertest")).default;
    const { createIngressApp } = await import("../src/core/server");
    const type = await import("../src/core/adapters");
    const logger = await import("../src/core/logger");

    const slowHandler: SourceHandler = (_s, _c, signal) =>
      new Promise<unknown>((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error("never")), 5_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("RENDER_ABORTED"));
        }, { once: true });
      });

    const mockStorage: type.StorageAdapter = {
      readWidget: async () => null,
      writeWidget: async () => {},
      deleteWidget: async () => false,
      listWidgets: async () => [],
      readPayload: async () => null,
      writePayload: async () => false,
      writeCachedImage: async () => false,
      getCachedImagePath: () => null,
    };
    const mockAdapter: type.PlatformAdapter = {
      storage: mockStorage,
      registerRoutes() {},
      getBlockedHostnames: () => [],
      getSourceHandler: () => slowHandler,
    };

    const captured: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const spy = vi.spyOn(logger, "logWarn").mockImplementation((event, fields) => {
      captured.push({ event, fields: fields as Record<string, unknown> });
    });

    try {
      const { ingressApp } = createIngressApp(mockAdapter);
      // Use a unique payload (different element count) so the render
      // result cache from previous tests does not short-circuit.
      const payload = {
        misc: { size: { width: 8, height: 8 }, format: "png" as const, gridSize: "1x1" },
        features: {},
        sources: [{ id: "slow_log_test", kind: "haState" as const, entity_id: "sensor.test" }],
        elements: [],
      };
      await request(ingressApp).post("/render").send(payload);

      const failedEntry = captured.find((c) => c.event === "render.failed");
      expect(failedEntry).toBeDefined();
      expect(failedEntry?.fields.aborted).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
