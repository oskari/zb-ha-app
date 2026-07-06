/**
 * widgetRoutes.test.ts — HTTP-level widget save contract tests.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import type { PlatformAdapter, Slot, StorageAdapter, WidgetDoc, WidgetMeta } from "../src/core/adapters";

const validDoc = {
  misc: { size: { width: 8, height: 8 }, gridSize: "1x1" },
  features: {},
  sources: [],
  elements: [],
};

const validFullscreen = {
  misc: { size: { width: 800, height: 480 }, gridSize: "3x2" },
  features: {},
  sources: [],
  elements: [],
};

function createMemoryStorage() {
  const widgets = new Map<string, WidgetDoc>();
  const deletedSlots: Slot[] = [];
  const storage: StorageAdapter = {
    readWidget: async (id: string) => widgets.get(id) ?? null,
    writeWidget: async (widget: WidgetDoc) => { widgets.set(widget.id, widget); },
    deleteWidget: async (id: string) => widgets.delete(id),
    listWidgets: async (): Promise<WidgetMeta[]> => Array.from(widgets.values()).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
    readPayload: async () => null,
    writePayload: async () => false,
    writeCachedImage: async () => false,
    getCachedImagePath: () => null,
    deleteSlot: async (slot: Slot) => { deletedSlots.push(slot); },
  };
  return { storage, widgets, deletedSlots };
}

function createAdapter(storage: StorageAdapter): PlatformAdapter {
  return {
    storage,
    registerRoutes() {},
    getBlockedHostnames: () => [],
    getSourceHandler: () => null,
  };
}

describe("PUT /api/widgets/:id", () => {
  it("preserves an existing fullscreen companion when fullscreen is omitted", async () => {
    const { storage, widgets, deletedSlots } = createMemoryStorage();
    widgets.set("widget_aabbccdd_eeff00", {
      id: "widget_aabbccdd_eeff00",
      name: "Before",
      doc: validDoc,
      fullscreen: validFullscreen,
      updatedAt: 1,
    });
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp)
      .put("/api/widgets/widget_aabbccdd_eeff00")
      .send({ name: "After", doc: validDoc });

    expect(res.status).toBe(200);
    expect(widgets.get("widget_aabbccdd_eeff00")?.fullscreen).toMatchObject(validFullscreen);
    expect(deletedSlots).toEqual([]);
  });

  it("treats fullscreen=null as an explicit companion clear", async () => {
    const { storage, widgets, deletedSlots } = createMemoryStorage();
    widgets.set("widget_aabbccdd_eeff00", {
      id: "widget_aabbccdd_eeff00",
      name: "Before",
      doc: validDoc,
      fullscreen: validFullscreen,
      updatedAt: 1,
    });
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp)
      .put("/api/widgets/widget_aabbccdd_eeff00")
      .send({ name: "After", doc: validDoc, fullscreen: null });

    expect(res.status).toBe(200);
    expect(widgets.get("widget_aabbccdd_eeff00")?.fullscreen).toBeNull();
    expect(deletedSlots).toEqual(["fullscreen"]);
  });

  it("rejects malformed fullscreen values", async () => {
    const { storage } = createMemoryStorage();
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp)
      .put("/api/widgets/widget_aabbccdd_eeff00")
      .send({ name: "Bad", doc: validDoc, fullscreen: [] });

    expect(res.status).toBe(400);
  });
});

function docWithBearer(bearer: string) {
  return {
    misc: { size: { width: 8, height: 8 }, gridSize: "1x1" },
    features: {},
    sources: [
      {
        id: "src1",
        kind: "http",
        method: "GET",
        url: "https://api.example.com",
        auth: { type: "bearer", bearer },
        response: { type: "json" },
      },
    ],
    elements: [],
  };
}

function readBearer(widget: WidgetDoc | undefined): unknown {
  const sources = (widget?.doc as { sources?: { auth?: { bearer?: unknown } }[] })?.sources;
  return sources?.[0]?.auth?.bearer;
}

describe("source-credential masking (FIX-04)", () => {
  it("GET /api/widgets/:id masks a stored bearer and never leaks the raw token", async () => {
    const { storage, widgets } = createMemoryStorage();
    widgets.set("widget_secret01", {
      id: "widget_secret01",
      name: "S",
      doc: docWithBearer("realtok123"),
      updatedAt: 1,
    });
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp).get("/api/widgets/widget_secret01");

    expect(res.status).toBe(200);
    expect(readBearer(res.body)).toBe("__stored__");
    expect(JSON.stringify(res.body)).not.toContain("realtok123");
  });

  it("PUT with the sentinel restores the persisted real secret", async () => {
    const { storage, widgets } = createMemoryStorage();
    const { ingressApp } = createIngressApp(createAdapter(storage));

    // Seed a real secret.
    const first = await request(ingressApp)
      .put("/api/widgets/widget_secret02")
      .send({ name: "S", doc: docWithBearer("realtok123") });
    expect(first.status).toBe(200);
    expect(readBearer(widgets.get("widget_secret02"))).toBe("realtok123");

    // Save back the masked sentinel — the persisted secret must survive.
    const second = await request(ingressApp)
      .put("/api/widgets/widget_secret02")
      .send({ name: "S", doc: docWithBearer("__stored__") });
    expect(second.status).toBe(200);
    expect(readBearer(widgets.get("widget_secret02"))).toBe("realtok123");
  });

  it("PUT with a new secret value persists the new value", async () => {
    const { storage, widgets } = createMemoryStorage();
    const { ingressApp } = createIngressApp(createAdapter(storage));

    await request(ingressApp)
      .put("/api/widgets/widget_secret03")
      .send({ name: "S", doc: docWithBearer("realtok123") });

    const res = await request(ingressApp)
      .put("/api/widgets/widget_secret03")
      .send({ name: "S", doc: docWithBearer("newtok456") });

    expect(res.status).toBe(200);
    expect(readBearer(widgets.get("widget_secret03"))).toBe("newtok456");
  });

  it("GET /payload masks the deployed payload's auth and header secrets", async () => {
    const { storage } = createMemoryStorage();
    storage.readPayload = async () => ({
      misc: { size: { width: 8, height: 8 }, gridSize: "1x1" },
      features: {},
      sources: [
        {
          id: "src1",
          auth: { type: "bearer", bearer: "realtok123" },
          headers: { Authorization: "Bearer realtok123", "X-Custom": "keepme" },
        },
      ],
      elements: [],
    });
    const { ingressApp } = createIngressApp(createAdapter(storage));

    const res = await request(ingressApp).get("/payload");

    expect(res.status).toBe(200);
    expect(res.body.sources[0].auth.bearer).toBe("__stored__");
    expect(res.body.sources[0].headers.Authorization).toBe("__stored__");
    expect(res.body.sources[0].headers["X-Custom"]).toBe("keepme");
    expect(JSON.stringify(res.body)).not.toContain("realtok123");
  });
});