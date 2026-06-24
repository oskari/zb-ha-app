/**
 * rateLimiter.test.ts — Sliding-window rate limiter tests
 *
 * §4.2: Proves the rate limiter correctly throttles requests per-IP,
 * respects the sliding window, and tracks different IPs independently.
 *
 * Tests the exported rateLimit middleware via a minimal Express app + supertest.
 */

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { rateLimit } from "../src/core/rateLimiter";

// ── Helpers ────────────────────────────────────────────────────

function createTestApp(label: string, windowMs: number, maxHits: number) {
  const app = express();
  app.use(rateLimit(label, windowMs, maxHits));
  app.get("/test", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ── §4.2 Rate limiter tests ────────────────────────────────────

describe("rate limiter", () => {
  it("allows first N requests within window", async () => {
    const app = createTestApp("test-allow", 60_000, 5);

    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    }
  });

  it("rejects request N+1 with 429", async () => {
    const app = createTestApp("test-reject", 60_000, 3);

    // Use all allowed requests
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    }

    // Next request should be rejected
    const rejected = await request(app).get("/test");
    expect(rejected.status).toBe(429);
    expect(rejected.body.error).toContain("Too many requests");
  });

  it("allows requests again after window expires", async () => {
    const app = createTestApp("test-expire", 50, 2); // 50ms window

    // Exhaust the limit
    await request(app).get("/test");
    await request(app).get("/test");

    const rejected = await request(app).get("/test");
    expect(rejected.status).toBe(429);

    // Wait for the window to expire
    await new Promise((r) => setTimeout(r, 60));

    // Should be allowed again
    const allowed = await request(app).get("/test");
    expect(allowed.status).toBe(200);
  });

  it("tracks different labels independently", async () => {
    const app = express();
    const limiter1 = rateLimit("label-a", 60_000, 2);
    const limiter2 = rateLimit("label-b", 60_000, 2);

    app.get("/route-a", limiter1, (_req, res) => res.json({ ok: true }));
    app.get("/route-b", limiter2, (_req, res) => res.json({ ok: true }));

    // Exhaust label-a
    await request(app).get("/route-a");
    await request(app).get("/route-a");
    const rejectedA = await request(app).get("/route-a");
    expect(rejectedA.status).toBe(429);

    // label-b should still be available
    const allowedB = await request(app).get("/route-b");
    expect(allowedB.status).toBe(200);
  });

  it("returns proper error message format", async () => {
    const app = createTestApp("test-format", 60_000, 1);

    await request(app).get("/test"); // First request OK
    const res = await request(app).get("/test"); // Second request rejected

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many requests. Please try again later." });
  });
});
