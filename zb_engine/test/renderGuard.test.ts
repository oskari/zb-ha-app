/**
 * renderGuard.test.ts — the RenderGuard boolean mutex under contention, and
 * the render route releasing it so the next render can proceed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { RenderGuard } from "../src/core/renderService";
import { installInlineRenderWorker } from "./helpers/inlineRenderWorker";

// Run the engine inline (the worker's dist file is absent under vitest).
let restoreWorker: () => void;
beforeAll(() => {
  restoreWorker = installInlineRenderWorker();
});
afterAll(() => restoreWorker?.());

const validPayload = {
  misc: { size: { width: 8, height: 8 }, format: "png", gridSize: "1x1" },
  features: {},
  sources: [],
  elements: [],
};

const validFullscreenPayload = {
  misc: { size: { width: 800, height: 480 }, format: "png", gridSize: "3x2" },
  features: {},
  sources: [],
  elements: [],
};

// RenderGuard concurrency

describe("RenderGuard", () => {
  it("tryAcquire() succeeds when unlocked and returns a release function", () => {
    const guard = new RenderGuard();
    const release = guard.tryAcquire();
    expect(release).toBeTypeOf("function");
  });

  it("second tryAcquire() returns null while first is held", () => {
    const guard = new RenderGuard();
    const release = guard.tryAcquire();
    expect(release).not.toBeNull();

    const second = guard.tryAcquire();
    expect(second).toBeNull();

    release!();
  });

  it("after release(), next tryAcquire() succeeds again", () => {
    const guard = new RenderGuard();
    const release1 = guard.tryAcquire()!;
    release1();

    const release2 = guard.tryAcquire();
    expect(release2).toBeTypeOf("function");
    release2!();
  });

  it("multiple acquire-release cycles work correctly", () => {
    const guard = new RenderGuard();

    for (let i = 0; i < 10; i++) {
      const release = guard.tryAcquire();
      expect(release).not.toBeNull();
      release!();
    }
  });

  it("double release does not corrupt state", () => {
    const guard = new RenderGuard();
    const release = guard.tryAcquire()!;
    release();
    release(); // Second release should be harmless

    // Guard should still be acquirable
    const next = guard.tryAcquire();
    expect(next).toBeTypeOf("function");
    next!();
  });
});

// Integration: concurrent render requests via Express

describe("concurrent render requests", () => {
  // Import lazily to avoid triggering side effects during module load
  it("first render gets 200, concurrent render gets 409", async () => {
    const request = (await import("supertest")).default;
    const { createIngressApp } = await import("../src/core/server");
    const type = await import("../src/core/adapters");

    // Mock adapter with a slow render pipeline
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
      getSourceHandler: () => null,
    };

    const { ingressApp, renderGuard } = createIngressApp(mockAdapter);

    // Manually lock the guard to simulate a render in progress
    const release = renderGuard.tryAcquire()!;

    // This request should be rejected because the guard is locked
    const res = await request(ingressApp)
      .post("/render")
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("render is already in progress");

    release();
  });

  it("primary and fullscreen renders share the same mutex (slot-aware)", async () => {
    const request = (await import("supertest")).default;
    const { createIngressApp } = await import("../src/core/server");
    const type = await import("../src/core/adapters");

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
      getSourceHandler: () => null,
    };
    const { ingressApp, renderGuard } = createIngressApp(mockAdapter);

    // Hold the guard to simulate a primary render in progress.
    const release = renderGuard.tryAcquire()!;

    // A fullscreen render dispatched while primary holds the lock must 409.
    const res = await request(ingressApp)
      .post("/render?slot=fullscreen")
      .send(validFullscreenPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("render is already in progress");

    release();
  });
});

// Render route guard lifecycle

describe("render route guard lifecycle", () => {
  // Drive the real POST /render route twice: the route's finally must release
  // the guard after each render, or the second request would be wrongly
  // rejected as busy (409). This exercises the actual route code rather than
  // re-asserting JS try/finally semantics. (Release-on-throw via a real route
  // is covered in startup.test.ts — "image app releases RenderGuard when
  // render pipeline throws".)
  it("releases the guard after a completed render so the next render proceeds", async () => {
    const request = (await import("supertest")).default;
    const { createIngressApp } = await import("../src/core/server");
    const type = await import("../src/core/adapters");

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
      getSourceHandler: () => null,
    };
    const { ingressApp } = createIngressApp(mockAdapter);

    const first = await request(ingressApp).post("/render").send(validPayload);
    expect(first.status).toBe(200);

    // Would be 409 if the guard had not been released in the route's finally.
    const second = await request(ingressApp).post("/render").send(validPayload);
    expect(second.status).toBe(200);
  });
});
