import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import type { PlatformAdapter, StorageAdapter, WidgetMeta } from "../src/core/adapters";
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

const invalidPayload = {
  misc: {},
  features: {},
  sources: [],
  elements: [],
};

function createAdapter(): PlatformAdapter {
  const storage: StorageAdapter = {
    readWidget: async () => null,
    writeWidget: async () => {},
    deleteWidget: async () => false,
    listWidgets: async (): Promise<WidgetMeta[]> => [],
    readPayload: async () => null,
    writePayload: async () => false,
    writeCachedImage: async () => false,
    getCachedImagePath: () => null,
  };
  return {
    storage,
    registerRoutes() {},
    getBlockedHostnames: () => [],
    getSourceHandler: () => null,
  };
}

describe("POST /render schema validation", () => {
  it("rejects an invalid primary payload with 400", async () => {
    const { ingressApp } = createIngressApp(createAdapter());

    const res = await request(ingressApp).post("/render").send(invalidPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid payload schema");
  });

  it("rejects an invalid fullscreen payload with 400", async () => {
    const { ingressApp } = createIngressApp(createAdapter());

    const res = await request(ingressApp)
      .post("/render?slot=fullscreen")
      .send({ ...validFullscreenPayload, misc: { ...validFullscreenPayload.misc, gridSize: "1x1" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid payload schema");
  });

  it("rejects an invalid primary payload before RenderGuard contention", async () => {
    const { ingressApp, renderGuard } = createIngressApp(createAdapter());
    const release = renderGuard.tryAcquire()!;

    try {
      const res = await request(ingressApp).post("/render").send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid payload schema");
    } finally {
      release();
    }
  });

  it("still renders a valid primary payload", async () => {
    const { ingressApp } = createIngressApp(createAdapter());

    const res = await request(ingressApp).post("/render").send(validPayload);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });
});
