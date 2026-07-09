/**
 * securityHeaders.test.ts — Regression tests for security headers and method hardening
 *
 * Covers:
 *   - Ingress app (port 8099): X-Content-Type-Options, X-Frame-Options,
 *     Referrer-Policy, Content-Security-Policy
 *   - Image app (port 8000): same headers with stricter CSP + 405 rejection
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { createIngressApp } from "../src/core/server";
import { createImageApp } from "../src/ha/index";
import type { PlatformAdapter, StorageAdapter, WidgetMeta, WidgetDoc } from "../src/core/adapters";

// ── Minimal mock adapter for the ingress app ───────────────────

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

// ── Ingress app security headers (port 8099 equivalent) ────────

describe("ingress app security headers", () => {
  const { ingressApp } = createIngressApp(mockAdapter);

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(ingressApp).get("/api/widgets");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: SAMEORIGIN (HA Ingress exception)", async () => {
    const res = await request(ingressApp).get("/api/widgets");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("sets Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const res = await request(ingressApp).get("/api/widgets");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Content-Security-Policy with unsafe-inline for script-src and style-src", async () => {
    const res = await request(ingressApp).get("/api/widgets");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src 'self'");
  });
});

// ── Image app security headers (port 8000 equivalent) ──────────

describe("image app security headers", () => {
  const imageApp = createImageApp();

  // Register a trivial route so GET requests produce a 200 instead of 404
  imageApp.get("/image.png", (_req, res) => {
    res.status(200).send("ok");
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(imageApp).get("/image.png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY", async () => {
    const res = await request(imageApp).get("/image.png");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Content-Security-Policy: default-src 'none'", async () => {
    const res = await request(imageApp).get("/image.png");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'");
  });

  it("sets Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const res = await request(imageApp).get("/image.png");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});

// ── Image app method rejection (ENGINEERING_CONSTRAINTS HA3, §13) ───────────

describe("image app method rejection", () => {
  // createImageApp() itself no longer enforces a blanket "GET/HEAD only"
  // middleware — the multi-device design moved method handling to a
  // per-route get+all-405-catchall pattern (see imageApp.ts
  // registerImageRoutes), since POST is now valid on `.bin` paths and must
  // stay invalid on `.png` paths. This registers that same pattern here to
  // prove headers + method hardening still compose correctly for a caller
  // that follows it; the full real-route method/device matrix is covered
  // in imagePort.test.ts.
  const imageApp = createImageApp();

  imageApp.get("/image.png", (_req, res) => {
    res.status(200).send("ok");
  });
  imageApp.all("/image.png", (_req, res) => {
    res.status(405).setHeader("Allow", "GET, HEAD").json({ error: "Method not allowed." });
  });

  it("rejects POST with 405 and Allow header", async () => {
    const res = await request(imageApp).post("/image.png");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, HEAD");
  });

  it("rejects PUT with 405 and Allow header", async () => {
    const res = await request(imageApp).put("/image.png");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, HEAD");
  });

  it("rejects DELETE with 405 and Allow header", async () => {
    const res = await request(imageApp).delete("/image.png");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, HEAD");
  });

  it("rejects PATCH with 405 and Allow header", async () => {
    const res = await request(imageApp).patch("/image.png");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, HEAD");
  });

  it("allows GET requests through", async () => {
    const res = await request(imageApp).get("/image.png");
    expect(res.status).toBe(200);
  });

  it("allows HEAD requests through", async () => {
    const res = await request(imageApp).head("/image.png");
    expect(res.status).toBe(200);
  });

  it("does not leak stack traces in 405 response body", async () => {
    const res = await request(imageApp).post("/image.png");
    expect(res.body.error).toBe("Method not allowed.");
    expect(res.body).not.toHaveProperty("stack");
  });
});
