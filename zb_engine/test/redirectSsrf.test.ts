/**
 * redirectSsrf.test.ts — Redirect SSRF re-validation tests
 *
 * §4.7: Proves that the source fetcher validates redirect target URLs
 * against SSRF patterns and refuses to follow redirects for security.
 *
 * Strategy: Mock fetchWithTimeout to return 302 responses with Location headers
 * pointing to private IPs. Mock validateUrlWithDns to pass for the initial URL
 * but reject the redirect target.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Track calls to validateUrlWithDns to verify re-validation
const validateCalls: string[] = [];

vi.mock("../src/data/urlValidator", () => ({
  validateUrl: vi.fn(),
  validateUrlWithDns: vi.fn(async (_label: string, url: string) => {
    validateCalls.push(url);
    // Parse the URL to check if it targets a private IP
    const parsed = new URL(url);
    if (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname.startsWith("192.168.") ||
      parsed.hostname.startsWith("10.")
    ) {
      throw new Error(`URL "${url}" resolves to a private/internal address.`);
    }
  }),
  configureUrlValidator: vi.fn(),
  configureBlockedHostnames: vi.fn(),
}));

// Mock fetchWithTimeout to simulate redirect responses
const mockFetch = vi.fn();

vi.mock("../src/data/safeFetch", () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  readResponseTextWithLimit: (response: Response) => response.text(),
}));

import { fetchAllSources, type SourceDef } from "../src/data/sourceFetcher";
import { createDataContext } from "@zb/expressions";

// ── Helpers ────────────────────────────────────────────────────

function makeSource(url: string): SourceDef {
  return {
    id: "redirect-test",
    kind: "http",
    method: "GET",
    url,
    response: { type: "json" },
  } as SourceDef;
}

function makeRedirectResponse(location: string) {
  return {
    ok: false,
    status: 302,
    statusText: "Found",
    headers: {
      get: (name: string) => (name.toLowerCase() === "location" ? location : null),
    },
    body: null,
    text: () => Promise.resolve(""),
  };
}

function makeOkResponse(data: unknown = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "content-length") return "2";
        return null;
      },
    },
    body: null,
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

beforeEach(() => {
  validateCalls.length = 0;
  mockFetch.mockReset();
});

// ── §4.7 Redirect SSRF re-validation ──────────────────────────

describe("redirect SSRF — private IP in Location header", () => {
  it("rejects redirect to 127.0.0.1 (loopback)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeRedirectResponse("http://127.0.0.1/secret"),
    );

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);

    expect(result.errors.length).toBeGreaterThan(0);
    // The error should mention either the redirect or the private address
    const errMsg = result.errors[0].message;
    expect(
      errMsg.includes("Redirect") ||
      errMsg.includes("private") ||
      errMsg.includes("127.0.0.1"),
    ).toBe(true);
  });

  it("rejects redirect to 192.168.x.x (private network)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeRedirectResponse("http://192.168.1.1/admin"),
    );

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);

    expect(result.errors.length).toBeGreaterThan(0);
    // Pin the re-validation branch specifically: the failure must be the
    // private-address rejection, not the generic "redirect not supported"
    // throw. That generic message echoes the 192.168 literal, so matching the
    // IP alone would pass even if private-IP re-validation regressed —
    // "private" only appears when the redirect target was actually re-checked.
    expect(result.errors[0].message).toContain("private");
  });

  it("validates redirect target URL via validateUrlWithDns", async () => {
    mockFetch.mockResolvedValueOnce(
      makeRedirectResponse("http://10.0.0.1/internal"),
    );

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    await fetchAllSources([source], ctx);

    // validateUrlWithDns should have been called for both the original URL
    // and the redirect target
    expect(validateCalls).toContain("http://example.com/api");
    expect(validateCalls).toContain("http://10.0.0.1/internal");
  });
});

describe("redirect SSRF — security policy", () => {
  it("does not follow redirects (redirect: manual)", async () => {
    // The sourceFetcher uses redirect: "manual" — it never follows redirects.
    // Even a redirect to a safe URL should be rejected.
    mockFetch.mockResolvedValueOnce(
      makeRedirectResponse("http://safe-redirect.example.com/data"),
    );

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);

    expect(result.errors.length).toBeGreaterThan(0);
    const errMsg = result.errors[0].message;
    expect(errMsg).toContain("Redirect");
    expect(errMsg).toContain("re-fetch not supported");
  });

  it("handles 301 redirect the same as 302", async () => {
    mockFetch.mockResolvedValueOnce({
      ...makeRedirectResponse("http://127.0.0.1/secret"),
      status: 301,
      statusText: "Moved Permanently",
    });

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles 307 redirect the same as 302", async () => {
    mockFetch.mockResolvedValueOnce({
      ...makeRedirectResponse("http://127.0.0.1/secret"),
      status: 307,
      statusText: "Temporary Redirect",
    });

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);

    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("redirect SSRF — successful non-redirect responses", () => {
  it("returns data normally for 200 responses (no redirect)", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ temperature: 22 }));

    const source = makeSource("http://example.com/api");
    const ctx = createDataContext();
    const result = await fetchAllSources([source], ctx);

    expect(result.errors.length).toBe(0);
    expect(ctx["redirect-test"]).toEqual({ temperature: 22 });
  });
});
