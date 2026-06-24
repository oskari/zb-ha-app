/**
 * assetRedirectSsrf.test.ts — Redirect SSRF re-validation for the asset path
 *
 * The img/svg asset fetch (`fetchBufferWithLimit` / `fetchTextWithLimit` in
 * engine/primitives/assetLimits.ts) must NOT follow 3xx redirects. It fetches
 * with `redirect: "manual"`, re-validates the Location target against the same
 * SSRF rules, and refuses to follow — mirroring the source fetcher (see
 * redirectSsrf.test.ts).
 *
 * Strategy: mock validateUrlWithDns to pass for public hosts but reject
 * private targets, and stub global fetch to return crafted 3xx responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track every URL passed to validateUrlWithDns to prove the redirect target
// is re-validated (not just the initial URL).
const validateCalls: string[] = [];

vi.mock("../src/data/urlValidator", () => ({
  validateUrl: vi.fn(),
  validateUrlWithDns: vi.fn(async (_label: string, url: string) => {
    validateCalls.push(url);
    const parsed = new URL(url);
    if (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "169.254.169.254" ||
      parsed.hostname.startsWith("192.168.") ||
      parsed.hostname.startsWith("10.")
    ) {
      throw new Error(`URL "${url}" resolves to a private/internal address.`);
    }
  }),
}));

import {
  fetchBufferWithLimit,
  fetchTextWithLimit,
  MAX_IMAGE_FETCH_BYTES,
  MAX_SVG_FETCH_BYTES,
  IMAGE_FETCH_TIMEOUT_MS,
} from "../src/engine/primitives/assetLimits";

// ── Response builders ──────────────────────────────────────────

function makeRedirectResponse(location: string | null, status = 302) {
  return {
    ok: false,
    status,
    statusText: "Redirect",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "location" ? location : null,
    },
    body: null,
  };
}

function makeOkResponse(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null,
    },
    body: null,
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  };
}

const mockFetch = vi.fn();

beforeEach(() => {
  validateCalls.length = 0;
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Redirect refusal — private targets ─────────────────────────

describe("asset redirect SSRF — private Location target", () => {
  it("rejects a redirect to 127.0.0.1 (loopback)", async () => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("http://127.0.0.1/secret"));
    await expect(
      fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/private\/internal/);
  });

  it("rejects a redirect to the cloud metadata IP (169.254.169.254)", async () => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("http://169.254.169.254/latest/meta-data/"));
    await expect(
      fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/private\/internal/);
  });

  it("re-validates the redirect target via validateUrlWithDns", async () => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("http://10.0.0.1/internal"));
    await fetchBufferWithLimit(
      "http://example.com/i.png",
      "Image source",
      MAX_IMAGE_FETCH_BYTES,
      IMAGE_FETCH_TIMEOUT_MS,
    ).catch(() => undefined);

    expect(validateCalls).toContain("http://example.com/i.png");
    expect(validateCalls).toContain("http://10.0.0.1/internal");
  });

  it("resolves relative Location headers against the request URL before re-validating", async () => {
    // A relative redirect must still be refused and re-validated (resolved
    // against the base) rather than silently followed.
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("/somewhere-else"));
    await expect(
      fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/re-fetch not supported/);
    expect(validateCalls).toContain("http://example.com/somewhere-else");
  });
});

// ── Redirect refusal — security policy (never follow) ──────────

describe("asset redirect SSRF — never follows redirects", () => {
  it("refuses to follow even a redirect to a public host", async () => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("http://other-public.example.org/data"));
    await expect(
      fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/re-fetch not supported/);
    // The redirect target was validated, but the fetch was issued exactly once.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("issues the asset fetch with redirect: \"manual\"", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse("ok"));
    await fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it.each([301, 302, 303, 307, 308])("treats %i as a refused redirect", async (status) => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("http://127.0.0.1/secret", status));
    await expect(
      fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/private\/internal/);
  });

  it("refuses a redirect with no Location header", async () => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse(null));
    await expect(
      fetchBufferWithLimit("http://example.com/i.png", "Image source", MAX_IMAGE_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/re-fetch not supported/);
  });
});

// ── SVG path inherits the same protection ──────────────────────

describe("asset redirect SSRF — SVG text fetch path", () => {
  it("fetchTextWithLimit also refuses redirects to private targets", async () => {
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("http://192.168.1.1/admin.svg"));
    await expect(
      fetchTextWithLimit("http://example.com/icon.svg", "SVG source", MAX_SVG_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS),
    ).rejects.toThrow(/private\/internal/);
  });
});

// ── Happy path — no redirect ───────────────────────────────────

describe("asset redirect SSRF — non-redirect responses still work", () => {
  it("returns the body for a 200 response", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse("hello"));
    const buf = await fetchBufferWithLimit(
      "http://example.com/i.png",
      "Image source",
      MAX_IMAGE_FETCH_BYTES,
      IMAGE_FETCH_TIMEOUT_MS,
    );
    expect(buf.toString("utf8")).toBe("hello");
  });
});
