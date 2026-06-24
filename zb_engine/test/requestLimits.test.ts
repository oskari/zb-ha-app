/**
 * requestLimits.test.ts — Request body size limit tests
 *
 * §4.6: Proves that the Express middleware enforces the 2 MB request body limit.
 * Oversized POST bodies to /render should be rejected with 413.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import type { PlatformAdapter, StorageAdapter, WidgetMeta } from "../src/core/adapters";

// ── Setup ──────────────────────────────────────────────────────

const mockStorage: StorageAdapter = {
  readWidget: async () => null,
  writeWidget: async () => {},
  deleteWidget: async () => false,
  listWidgets: async (): Promise<WidgetMeta[]> => [],
  readPayload: async () => null,
  writePayload: async () => false,
  writeCachedImage: async () => false,
  getCachedImagePath: () => null,
};

const mockAdapter: PlatformAdapter = {
  storage: mockStorage,
  registerRoutes() {},
  getBlockedHostnames: () => [],
  getSourceHandler: () => null,
};

// ── §4.6 Body size limit tests ─────────────────────────────────

describe("request body size limits", () => {
  it("rejects POST /render with body > 2 MB (413 Payload Too Large)", async () => {
    const { ingressApp } = createIngressApp(mockAdapter);

    // Create a body slightly over 2 MB
    const oversizedBody = JSON.stringify({
      filler: "x".repeat(2.5 * 1024 * 1024),
    });

    const res = await request(ingressApp)
      .post("/render")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    expect(res.status).toBe(413);
  });

  it("rejects PUT /payload with body > 2 MB", async () => {
    const { ingressApp } = createIngressApp(mockAdapter);

    const oversizedBody = JSON.stringify({
      filler: "x".repeat(2.5 * 1024 * 1024),
    });

    const res = await request(ingressApp)
      .put("/payload")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    expect(res.status).toBe(413);
  });

  it("accepts normal-sized POST /render body (< 2 MB)", async () => {
    const { ingressApp } = createIngressApp(mockAdapter);

    // A valid-ish payload under 2MB. The render will fail on schema validation,
    // but that's a 400/500 — not a 413. We just verify it's not 413.
    const normalBody = { misc: {}, elements: [], sources: [] };

    const res = await request(ingressApp)
      .post("/render")
      .send(normalBody);

    expect(res.status).not.toBe(413);
  });
});
