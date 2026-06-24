/**
 * sourceTestSchemaError.test.ts — POST /render/test-source field-level errors
 *
 * `sourceSchema` is a z.union, so a rejection normally surfaces as one
 * `invalid_union` issue with the path `(root)` — which tells a designer nothing
 * about what to fix. The route re-validates against the branch matching the
 * config's `kind` and returns the specific failing field(s), so the builder's
 * Test Source panel can show e.g. "entity_id: must match HA format..." instead
 * of a generic "Invalid source config schema."
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

const fieldNames = (body: { fields?: Array<{ field: string }> }) =>
  (body.fields ?? []).map((f) => f.field);

describe("POST /render/test-source — schema error detail", () => {
  it("names entity_id for an haState source with a malformed entity_id", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);

    const res = await request(ingressApp)
      .post("/render/test-source")
      .set("X-Forwarded-For", "198.51.100.30")
      .send({ id: "s1", kind: "haState", entity_id: "Not An Entity", attribute: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("entity_id");
    expect(fieldNames(res.body)).toContain("entity_id");
  });

  it("names hoursBack for an haHistory source with a non-numeric hoursBack", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);

    const res = await request(ingressApp)
      .post("/render/test-source")
      .set("X-Forwarded-For", "198.51.100.31")
      .send({ id: "s2", kind: "haHistory", entity_id: "sensor.x", hoursBack: "24" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("hoursBack");
    expect(fieldNames(res.body)).toContain("hoursBack");
  });

  it("names attribute for an haState source with attribute: null", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);

    const res = await request(ingressApp)
      .post("/render/test-source")
      .set("X-Forwarded-For", "198.51.100.33")
      .send({ id: "s4", kind: "haState", entity_id: "sensor.x", attribute: null });

    expect(res.status).toBe(400);
    expect(fieldNames(res.body)).toContain("attribute");
  });

  it("no longer returns only the generic message", async () => {
    const { ingressApp } = createIngressApp(createAdapter());
    ingressApp.set("trust proxy", true);

    const res = await request(ingressApp)
      .post("/render/test-source")
      .set("X-Forwarded-For", "198.51.100.32")
      .send({ id: "s3", kind: "haState", entity_id: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).not.toBe("Invalid source config schema.");
    expect(res.body.error).toContain("entity_id");
  });
});
