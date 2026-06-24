/**
 * headerInjection.test.ts — HTTP header injection prevention tests
 *
 * §4.4: Proves the sourceFetcher's header validation rejects header names
 * with special characters and header values containing CR, LF, or null bytes.
 *
 * Strategy: Test through fetchAllSources with mocked URL validation and fetch.
 * The header validation runs before the actual HTTP request, so we mock
 * upstream dependencies to isolate the header checking logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock URL validator to always pass (we're testing headers, not URLs)
vi.mock("../src/data/urlValidator", () => ({
  validateUrl: vi.fn(),
  validateUrlWithDns: vi.fn().mockResolvedValue(undefined),
  configureUrlValidator: vi.fn(),
  configureBlockedHostnames: vi.fn(),
}));

// Mock fetchWithTimeout to return a valid response (we want to reach header validation)
vi.mock("../src/data/safeFetch", () => ({
  fetchWithTimeout: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map([["content-length", "2"]]),
    body: null,
    text: () => Promise.resolve("{}"),
  }),
  readResponseTextWithLimit: (response: Response) => response.text(),
}));

import { fetchAllSources, type SourceDef } from "../src/data/sourceFetcher";
import { createDataContext } from "@zb/expressions";

// ── Helpers ────────────────────────────────────────────────────

function makeSource(headers: Record<string, string>): SourceDef {
  return {
    id: "test-source",
    kind: "http",
    method: "GET",
    url: "http://example.com/api",
    headers,
    response: { type: "json" },
  } as SourceDef;
}

// ── §4.4 Header injection prevention ───────────────────────────

describe("header injection — invalid header names", () => {
  it("rejects header name with newline", async () => {
    const source = makeSource({ "X-Bad\nHeader": "value" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Invalid header name");
  });

  it("rejects header name with colon", async () => {
    const source = makeSource({ "X-Bad:Header": "value" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Invalid header name");
  });

  it("rejects header name with space", async () => {
    const source = makeSource({ "X Bad Header": "value" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Invalid header name");
  });

  it("rejects header name with equals sign", async () => {
    const source = makeSource({ "X-Header=Value": "value" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Invalid header name");
  });
});

describe("header injection — invalid header values", () => {
  it("rejects header value with CRLF", async () => {
    const source = makeSource({ "X-Custom": "value\r\nInjected: evil" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("must not contain CR, LF, or null");
  });

  it("rejects header value with bare LF", async () => {
    const source = makeSource({ "X-Custom": "value\nInjected: evil" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("must not contain CR, LF, or null");
  });

  it("rejects header value with bare CR", async () => {
    const source = makeSource({ "X-Custom": "value\rInjected: evil" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("must not contain CR, LF, or null");
  });

  it("rejects header value with null byte", async () => {
    const source = makeSource({ "X-Custom": "value\0evil" });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("must not contain CR, LF, or null");
  });
});

describe("header injection — valid headers accepted", () => {
  it("accepts standard header names and values", async () => {
    const source = makeSource({
      "Authorization": "Bearer token123",
      "X-Custom-Header": "safe-value",
      "Accept": "application/json",
    });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    // No header-related errors (there may be no errors at all,
    // or possibly fetch-related errors, but no header validation errors)
    const headerErrors = result.errors.filter((e) =>
      e.message.includes("header name") || e.message.includes("header value"),
    );
    expect(headerErrors.length).toBe(0);
  });

  it("accepts header names with hyphens and digits", async () => {
    const source = makeSource({
      "X-Request-ID": "abc-123",
      "Content-Type-2": "text/plain",
    });
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);
    const headerErrors = result.errors.filter((e) =>
      e.message.includes("header name") || e.message.includes("header value"),
    );
    expect(headerErrors.length).toBe(0);
  });
});
