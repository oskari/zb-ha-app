import { describe, it, expect } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import { RATE_LIMIT_RENDER_EXPAND } from "../src/limits";
import type { PlatformAdapter, StorageAdapter, WidgetMeta } from "../src/core/adapters";

const validPayload = {
  misc: { size: { width: 8, height: 8 }, format: "png", gridSize: "1x1" },
  features: { title: "demo" },
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

describe("POST /render/expand", () => {
  it("rejects an invalid payload with 400", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);

    const res = await request(ingressApp)
      .post("/render/expand")
      .set("X-Forwarded-For", "198.51.100.10")
      .send(invalidPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid payload schema");
  });

  it("returns expanded payload JSON for a valid payload", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);

    const res = await request(ingressApp)
      .post("/render/expand")
      .set("X-Forwarded-For", "198.51.100.11")
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(validPayload);
  });

  it("returns 429 when requests exceed RATE_LIMIT_RENDER_EXPAND", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);
    const agent = request(ingressApp);

    for (let i = 0; i < RATE_LIMIT_RENDER_EXPAND; i++) {
      const res = await agent
        .post("/render/expand")
        .set("X-Forwarded-For", "198.51.100.12")
        .send(validPayload);
      expect(res.status).toBe(200);
    }

    const rejected = await agent
      .post("/render/expand")
      .set("X-Forwarded-For", "198.51.100.12")
      .send(validPayload);

    expect(rejected.status).toBe(429);
    expect(rejected.body.error).toContain("Too many requests");
  });
});
