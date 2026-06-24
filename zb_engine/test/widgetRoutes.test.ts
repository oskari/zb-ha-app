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