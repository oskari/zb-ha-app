/**
 * renderCacheBoundary.test.ts — Save/export boundary regression tests.
 *
 * Non-deploy preview renders must never mutate the live ESP32 image cache.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import type { PlatformAdapter, Slot, StorageAdapter, WidgetDoc, WidgetMeta } from "../src/core/adapters";
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

function createTrackingStorage() {
  const calls: Array<{ format: "png" | "bin"; slot?: Slot }> = [];
  const payloadWrites: Slot[] = [];
  const storage: StorageAdapter = {
    readWidget: async () => null,
    writeWidget: async (_widget: WidgetDoc) => {},
    deleteWidget: async () => false,
    listWidgets: async (): Promise<WidgetMeta[]> => [],
    readPayload: async () => null,
    writePayload: async (_data: Buffer, slot: Slot = "primary") => {
      payloadWrites.push(slot);
      return true;
    },
    writeCachedImage: async (format: "png" | "bin", _data: Buffer, slot: Slot = "primary") => {
      calls.push({ format, slot });
      return true;
    },
    getCachedImagePath: () => null,
  };
  return { storage, calls, payloadWrites };
}

function createAdapter(storage: StorageAdapter): PlatformAdapter {
  return {
    storage,
    registerRoutes() {},
    getBlockedHostnames: () => [],
    getSourceHandler: () => null,
  };
}

describe("POST /render save/export boundary", () => {
  it("preview render returns an image but does not write live cached images", async () => {
    const { storage, calls, payloadWrites } = createTrackingStorage();
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp).post("/render").send(validPayload);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(calls).toEqual([]);
    expect(payloadWrites).toEqual([]);
  });

  it("deploy render writes payload and live cached images", async () => {
    const { storage, calls, payloadWrites } = createTrackingStorage();
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp)
      .post("/render")
      .set("X-Deploy", "true")
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(payloadWrites).toEqual(["primary"]);
    expect(calls).toEqual([
      { format: "png", slot: "primary" },
      { format: "bin", slot: "primary" },
    ]);
  });
});