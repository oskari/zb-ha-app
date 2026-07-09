/**
 * deviceConfigRoute.test.ts — POST /api/device/config guided proxy route
 *
 * Exercises the route end-to-end against a MOCKED device (fetchWithTimeout is
 * mocked, so no real network). Proves: it forwards the device reply, validates
 * the body/IP/config at the boundary (400 before any dial), canonicalizes the
 * IP so the exact host dialed is byte-identical to the validated one, degrades
 * to 502 on a device failure, is rate-limited, and — the hard invariant — is
 * absent from the unauthenticated image app / port 8000.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock the outbound fetch so no real device is contacted. readResponseTextWithLimit
// just drains the fake Response's text() (mirrors redirectSsrf.test.ts). The var
// name must start with "mock" for vitest's vi.mock hoisting to allow the ref.
const mockFetch = vi.fn();
vi.mock("../src/data/safeFetch", () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  readResponseTextWithLimit: (response: { text: () => Promise<string> }) => response.text(),
}));

import { createIngressApp } from "../src/core/server";
import { createOnDemandImageApp } from "../src/ha/imageApp";
import { RenderGuard } from "../src/core/renderService";
import { registerDeviceRoutes } from "../src/ha/haDevice";
import { RATE_LIMIT_DEVICE_CONFIG } from "../src/limits";
import type { PlatformAdapter, StorageAdapter, WidgetMeta, RenderMeta } from "../src/core/adapters";

// ── Ingress app under test ─────────────────────────────────────

/** Minimal adapter — the device route never touches storage. */
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
    registerRoutes(app) {
      registerDeviceRoutes(app);
    },
    getBlockedHostnames: () => [],
    getSourceHandler: () => null,
  };
}

function makeApp() {
  const { ingressApp } = createIngressApp(createAdapter());
  // Honour X-Forwarded-For so each test can pick its own rate-limit bucket.
  ingressApp.set("trust proxy", true);
  return ingressApp;
}

/** A fake device Response — only the fields postConfigToDevice reads. */
function deviceResponse(status: number, body: unknown) {
  return { status, text: () => Promise.resolve(JSON.stringify(body)) };
}

const VALID_CONFIG = {
  url: "http://192.168.1.50:8080/screen",
  sleepSec: 900,
  sidebar: true,
  fullRefreshFrequency: 10,
  imperialUnitsEnabled: false,
  tlsInsecure: false,
};

// Each test uses a distinct X-Forwarded-For IP so it gets its own module-global
// rate-limit bucket (the limiter keys per ip:label).
// These are limiter keys only; the device target is the body's deviceIp.
function post(app: ReturnType<typeof makeApp>, body: unknown, clientIp: string) {
  return request(app).post("/api/device/config").set("X-Forwarded-For", clientIp).send(body);
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("POST /api/device/config — forwarding the device reply", () => {
  it("forwards a 200 {configured:true} reply as ok:true", async () => {
    mockFetch.mockResolvedValueOnce(deviceResponse(200, { configured: true }));
    const res = await post(makeApp(), { deviceIp: "192.168.1.42", config: VALID_CONFIG }, "203.0.113.1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 200, configured: true });
  });

  it("forwards a device-side 400 (config rejected) as ok:true, status:400", async () => {
    // ok:true means the PROXY worked; status:400 means the device rejected the
    // config — the dialog surfaces that distinctly.
    mockFetch.mockResolvedValueOnce(deviceResponse(400, { error: "bad config" }));
    const res = await post(makeApp(), { deviceIp: "192.168.1.42", config: VALID_CONFIG }, "203.0.113.2");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe(400);
  });

  it("dials the CANONICAL dotted-quad host on the fixed :80 port", async () => {
    mockFetch.mockResolvedValueOnce(deviceResponse(200, { configured: true }));
    await post(makeApp(), { deviceIp: "192.168.1.42", config: VALID_CONFIG }, "203.0.113.3");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("http://192.168.1.42:80/config");
  });
});

describe("POST /api/device/config — boundary validation (fetch never called)", () => {
  it("rejects a malformed request body with 400", async () => {
    const res = await post(makeApp(), { config: VALID_CONFIG }, "203.0.113.4"); // no deviceIp
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a public device IP with 400", async () => {
    const res = await post(makeApp(), { deviceIp: "8.8.8.8", config: VALID_CONFIG }, "203.0.113.5");
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a bad config with 400", async () => {
    const res = await post(makeApp(), { deviceIp: "192.168.1.42", config: { url: "not-a-url" } }, "203.0.113.6");
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects octal / leading-zero IP forms with 400 and never dials them", async () => {
    const cases: Array<[string, string]> = [
      ["010.0.0.1", "203.0.113.7"],
      ["172.021.0.2", "203.0.113.8"],
    ];
    for (const [deviceIp, clientIp] of cases) {
      const res = await post(makeApp(), { deviceIp, config: VALID_CONFIG }, clientIp);
      expect(res.status).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/device/config — failure & throttling", () => {
  it("returns 502 (no internals leaked) when the device is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await post(makeApp(), { deviceIp: "192.168.1.42", config: VALID_CONFIG }, "203.0.113.9");
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
    expect(res.body).not.toHaveProperty("stack");
  });

  it("rejects requests past the per-window cap with 429", async () => {
    // Own describe/IP so the module-global bucket isn't shared with the
    // sibling tests above; only assert that a request PAST the cap is 429.
    mockFetch.mockResolvedValue(deviceResponse(200, { configured: true }));
    const app = makeApp();
    const clientIp = "203.0.113.250";
    let lastStatus = 0;
    for (let i = 0; i < RATE_LIMIT_DEVICE_CONFIG; i++) {
      lastStatus = (await post(app, { deviceIp: "192.168.1.42", config: VALID_CONFIG }, clientIp)).status;
    }
    expect(lastStatus).not.toBe(429); // still within the window
    const rejected = await post(app, { deviceIp: "192.168.1.42", config: VALID_CONFIG }, clientIp);
    expect(rejected.status).toBe(429);
  });
});

describe("POST /api/device/config — port-8000 isolation (hard invariant)", () => {
  it("is NOT registered on the unauthenticated image app", async () => {
    const fakeMeta: RenderMeta = {
      name: "test",
      format: "png",
      width: 296,
      height: 128,
      sourceCount: 0,
      elementCount: 0,
      renderTimeMs: 1,
      sourceErrors: [],
      renderErrors: [],
    };
    const { app } = createOnDemandImageApp({
      renderGuard: new RenderGuard(),
      readPayload: async () => null,
      runPipeline: async () => ({ pngBuffer: Buffer.from(""), binBuffer: Buffer.from(""), meta: fakeMeta }),
      cooldownMs: 50,
    });

    const res = await request(app)
      .post("/api/device/config")
      .send({ deviceIp: "192.168.1.42", config: VALID_CONFIG });

    // The route simply does not exist on port 8000 → no-match 404 (never 200).
    expect([404, 405]).toContain(res.status);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
