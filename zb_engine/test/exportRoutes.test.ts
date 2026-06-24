/**
 * exportRoutes.test.ts — HTTP-level export token contract tests.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import type { PlatformAdapter, StorageAdapter, WidgetMeta } from "../src/core/adapters";

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

describe("/export token routes", () => {
  it("creates and redeems a single-use export token", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    const exportData = {
      entities: [{ entity_id: "sensor.temp", state: "22" }],
      hoursBack: 6,
    };

    const createRes = await request(ingressApp)
      .post("/export")
      .send(exportData);

    expect(createRes.status).toBe(200);
    expect(createRes.body.token).toMatch(/^[a-f0-9]{32}$/i);
    expect(createRes.body.expiresIn).toBeGreaterThan(0);

    const redeemRes = await request(ingressApp)
      .get(`/export/${createRes.body.token}`);

    expect(redeemRes.status).toBe(200);
    expect(redeemRes.body).toEqual(exportData);

    const secondRedeemRes = await request(ingressApp)
      .get(`/export/${createRes.body.token}`);

    expect(secondRedeemRes.status).toBe(404);
  });

  it("rejects non-object export request bodies", async () => {
    const { ingressApp } = createIngressApp(createAdapter());

    const res = await request(ingressApp)
      .post("/export")
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid export request.");
  });

  it("rejects malformed export token parameters", async () => {
    const { ingressApp } = createIngressApp(createAdapter());

    const res = await request(ingressApp)
      .get("/export/not-a-token");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid export token.");
  });
});
