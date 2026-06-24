/**
 * startup.test.ts — startup & runtime failure handling: no stored payload
 * (image 503, ingress still serves), corrupt payload (server still starts),
 * a failing image port (ingress unaffected), and render-timeout guard release.
 * Uses createOnDemandImageApp to exercise the image port without a TCP listener.
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { RenderGuard } from "../src/core/renderService";
import { createOnDemandImageApp } from "../src/ha/imageApp";
import { createIngressApp } from "../src/core/server";
import type { StorageAdapter, PlatformAdapter, WidgetMeta, RenderMeta } from "../src/core/adapters";

// Mock adapter

function createMockStorage(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    readWidget: async () => null,
    writeWidget: async () => {},
    deleteWidget: async () => false,
    listWidgets: async (): Promise<WidgetMeta[]> => [],
    readPayload: async () => null,
    writePayload: async () => false,
    writeCachedImage: async () => false,
    getCachedImagePath: () => null,
    ...overrides,
  };
}

function createMockAdapter(storageOverrides: Partial<StorageAdapter> = {}): PlatformAdapter {
  return {
    storage: createMockStorage(storageOverrides),
    registerRoutes() {},
    getBlockedHostnames: () => [],
    getSourceHandler: () => null,
  };
}

const fakeMeta: RenderMeta = {
  name: "test",
  format: "png",
  width: 100,
  height: 100,
  sourceCount: 0,
  elementCount: 1,
  renderTimeMs: 5,
  sourceErrors: [],
  renderErrors: [],
};

// Startup with no stored payload

describe("startup with no stored payload", () => {
  it("image port returns 503 when no payload is available", async () => {
    const { app } = createOnDemandImageApp({
      renderGuard: new RenderGuard(),
      readPayload: async () => null,
      runPipeline: async () => { throw new Error("should not be called"); },
    });

    const res = await request(app).get("/image.png");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("No image available yet.");
  });

  it("ingress app serves builder UI normally when no payload exists", async () => {
    const adapter = createMockAdapter({ readPayload: async () => null });
    const { ingressApp } = createIngressApp(adapter);

    // Widget API should be accessible regardless of payload state
    const res = await request(ingressApp).get("/api/widgets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /payload returns 404 when no payload is stored", async () => {
    const adapter = createMockAdapter({ readPayload: async () => null });
    const { ingressApp } = createIngressApp(adapter);

    const res = await request(ingressApp).get("/payload");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No payload.json found");
  });
});

// Startup with corrupt payload

describe("startup with corrupt/invalid payload", () => {
  it("ingress app still serves when storage returns invalid data", async () => {
    const adapter = createMockAdapter({
      // Return something that's not a valid payload (missing required fields)
      readPayload: async () => ({ invalid: true }),
    });
    const { ingressApp } = createIngressApp(adapter);

    // The API should be accessible — corrupt payloads don't crash the server
    const res = await request(ingressApp).get("/api/widgets");
    expect(res.status).toBe(200);
  });

  it("image port returns 503 when render fails on corrupt payload", async () => {
    const { app } = createOnDemandImageApp({
      renderGuard: new RenderGuard(),
      readPayload: async () => ({ corrupt: true }),
      runPipeline: async () => { throw new Error("Invalid payload"); },
    });

    const res = await request(app).get("/image.png");
    expect(res.status).toBe(503);
  });
});

// Port 8000 bind failure doesn't crash ingress

describe("port bind failure resilience", () => {
  it("ingress serves requests even when the image app is failing", async () => {
    // Isolation: a broken image port must not take ingress down. Drive a
    // failing image app (errors on every render) AND the ingress app — the
    // image port 503s while ingress still serves a real request. The old
    // version only asserted `typeof ingressApp.listen === "function"`, which
    // cannot fail as long as the object exists.
    const failingImage = createOnDemandImageApp({
      renderGuard: new RenderGuard(),
      readPayload: async () => ({ some: "payload" }),
      runPipeline: async () => { throw new Error("image app is down"); },
    });
    const { ingressApp } = createIngressApp(createMockAdapter());

    const imgRes = await request(failingImage.app).get("/image.png");
    expect(imgRes.status).toBe(503);

    const healthRes = await request(ingressApp).get("/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("ok");
  });
});

// Render timeout → guard released

describe("render timeout recovery", () => {
  it("image app releases RenderGuard when render pipeline throws", async () => {
    const guard = new RenderGuard();
    const { app } = createOnDemandImageApp({
      renderGuard: guard,
      readPayload: async () => ({ some: "payload" }),
      runPipeline: async () => { throw new Error("Pipeline exploded"); },
    });

    // The request will attempt an on-demand render, which will fail
    await request(app).get("/image.png");

    // Guard should have been released in the finally block
    const release = guard.tryAcquire();
    expect(release).toBeTypeOf("function");
    release!();
  });
});
