/**
 * observability.test.ts — Phase 1 operational observability checks.
 *
 * Covers request correlation, ingress-only health/readiness, shutdown gating,
 * and logger redaction for sensitive operational data.
 */

import { describe, expect, it } from "vitest";
import request from "supertest";
import { createIngressApp } from "../src/core/server";
import { redactLogValue } from "../src/core/logger";
import { createImageApp } from "../src/ha/imageApp";
import type { PlatformAdapter, StorageAdapter, WidgetMeta } from "../src/core/adapters";

function createMockStorage(): StorageAdapter {
  return {
    readWidget: async () => null,
    writeWidget: async () => {},
    deleteWidget: async () => false,
    listWidgets: async (): Promise<WidgetMeta[]> => [],
    readPayload: async () => null,
    writePayload: async () => false,
    writeCachedImage: async () => false,
    getCachedImagePath: () => null,
  };
}

function createMockAdapter(): PlatformAdapter {
  return {
    storage: createMockStorage(),
    registerRoutes() {},
    getBlockedHostnames: () => [],
    getSourceHandler: () => null,
  };
}

describe("ingress observability", () => {
  it("returns a caller-supplied request correlation ID", async () => {
    const { ingressApp } = createIngressApp(createMockAdapter());

    const res = await request(ingressApp)
      .get("/api/widgets")
      .set("X-Request-Id", "phase1-test-request");

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe("phase1-test-request");
  });

  it("exposes a minimal health endpoint on the ingress app", async () => {
    const { ingressApp } = createIngressApp(createMockAdapter());

    const res = await request(ingressApp).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      components: {
        ingress: "ready",
        renderer: "ready",
        storage: "configured",
      },
    });
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain("/data");
    expect(bodyText).not.toContain("SUPERVISOR_TOKEN");
    expect(bodyText).not.toContain("payload");
  });

  it("keeps health on ingress only, not the image app", async () => {
    const imageApp = createImageApp();

    const res = await request(imageApp).get("/health");

    expect(res.status).toBe(404);
  });

  it("reports shutting_down and rejects new ingress work after shutdown starts", async () => {
    const { ingressApp, markShuttingDown, isShuttingDown } = createIngressApp(createMockAdapter());

    markShuttingDown();

    expect(isShuttingDown()).toBe(true);

    const health = await request(ingressApp).get("/health");
    expect(health.status).toBe(503);
    expect(health.body.status).toBe("shutting_down");
    expect(health.body.components.ingress).toBe("stopping");

    const widgets = await request(ingressApp).get("/api/widgets");
    expect(widgets.status).toBe(503);
    expect(widgets.body.error).toBe("Server is shutting down.");
  });
});

describe("GET /payload error handling", () => {
  it("returns 500 (not a crash) when readPayload rejects", async () => {
    const adapter = createMockAdapter();
    adapter.storage.readPayload = async () => {
      throw new Error("disk exploded");
    };
    const { ingressApp } = createIngressApp(adapter);

    const res = await request(ingressApp).get("/payload");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to read payload.");
    // The internal error detail must not leak to the client.
    expect(JSON.stringify(res.body)).not.toContain("disk exploded");
  });
});

describe("logger redaction", () => {
  it("redacts secrets, URLs, IPs, and filesystem paths", () => {
    const redacted = JSON.stringify(redactLogValue({
      token: "secret-token-value",
      nested: {
        authorization: "Bearer secret-bearer-value",
      },
      message: "failed to fetch http://192.168.1.10/private at /data/payload.json",
    }));

    expect(redacted).not.toContain("secret-token-value");
    expect(redacted).not.toContain("secret-bearer-value");
    expect(redacted).not.toContain("http://");
    expect(redacted).not.toContain("192.168.1.10");
    expect(redacted).not.toContain("/data/payload.json");
    expect(redacted).toContain("[redacted-url]");
    expect(redacted).toContain("[redacted-path]");
  });

  it("redacts all three source credential slots (bearer, apiKey.value, basic.password)", () => {
    // Pass the `auth` object directly so each slot is exercised by the
    // key-based redaction rather than the object-depth truncation limit.
    const redacted = JSON.stringify(redactLogValue({
      type: "bearer",
      bearer: "bearer-secret-aaa",
      apiKey: { in: "header", name: "X-Api-Key", value: "apikey-secret-bbb" },
      basic: { username: "alice", password: "basic-secret-ccc" },
    }));

    expect(redacted).not.toContain("bearer-secret-aaa");
    expect(redacted).not.toContain("apikey-secret-bbb");
    expect(redacted).not.toContain("basic-secret-ccc");
    expect(redacted).toContain("[redacted]");
    // Non-secret fields are preserved for diagnostics.
    expect(redacted).toContain("alice");
  });
});
