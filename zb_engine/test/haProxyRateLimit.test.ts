/**
 * haProxyRateLimit.test.ts — Throttling on the HA Supervisor proxy routes (P3.5)
 *
 * /entities and /history each fan out to the Supervisor API, so they sit
 * behind a shared rate limiter. The limiter runs BEFORE the handler, so this
 * test does not need a Supervisor — it only asserts that the (N+1)th request
 * is rejected with 429, and that both routes share the same budget.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerEntityRoutes } from "../src/ha/haEntities";
import { RATE_LIMIT_HA_PROXY } from "../src/limits";

let savedToken: string | undefined;

beforeAll(() => {
  // Ensure the handler fails fast (no Supervisor reachable) so the first N
  // requests return immediately; the assertion only cares about the limiter.
  savedToken = process.env.SUPERVISOR_TOKEN;
  delete process.env.SUPERVISOR_TOKEN;
});

afterAll(() => {
  if (savedToken !== undefined) process.env.SUPERVISOR_TOKEN = savedToken;
});

describe("HA proxy rate limiting", () => {
  it("rejects requests past the window cap and shares the budget across routes", async () => {
    const app = express();
    registerEntityRoutes(app);

    // Exhaust the shared budget via /entities. Each allowed call returns 500
    // (no Supervisor), which still consumes a slot.
    let lastStatus = 0;
    for (let i = 0; i < RATE_LIMIT_HA_PROXY; i++) {
      lastStatus = (await request(app).get("/entities")).status;
    }
    expect(lastStatus).not.toBe(429); // still within the window

    // The next /entities call is over the cap.
    expect((await request(app).get("/entities")).status).toBe(429);

    // /history shares the same limiter bucket, so it is throttled too.
    const hist = await request(app).get("/history?entity_ids=sensor.x");
    expect(hist.status).toBe(429);
  });
});
