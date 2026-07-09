/**
 * haDevice.test.ts — pure validators behind the guided Self-Host /config proxy
 *
 * Covers the two pure functions the route relies on for its SSRF containment
 * (post-plan.md §3.5): `assertReachableDeviceIp` (dotted-quad RFC1918 allow-list
 * + canonicalize-then-dial, infra carve-outs, leading-zero/octal rejection) and
 * `validateSelfHostConfig` (§3 field schema + strict keys + ≤1024-byte cap).
 * These are where the security-relevant logic lives, so they are tested
 * directly — no Express, no network.
 */

import { describe, it, expect } from "vitest";
import { assertReachableDeviceIp, validateSelfHostConfig } from "../src/ha/haDevice";

/** Assert `fn` throws a badRequest (HTTP 400) error. */
function expectBadRequest(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as { status?: number }).status).toBe(400);
}

describe("assertReachableDeviceIp", () => {
  it("accepts RFC1918 addresses and returns the canonical dotted-quad", () => {
    expect(assertReachableDeviceIp("192.168.1.42")).toBe("192.168.1.42");
    expect(assertReachableDeviceIp("10.0.0.5")).toBe("10.0.0.5");
    expect(assertReachableDeviceIp("172.16.0.1")).toBe("172.16.0.1");
    expect(assertReachableDeviceIp("172.31.255.254")).toBe("172.31.255.254");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(assertReachableDeviceIp("  192.168.1.42  ")).toBe("192.168.1.42");
  });

  it("rejects a public address", () => {
    expectBadRequest(() => assertReachableDeviceIp("8.8.8.8"));
  });

  it("rejects loopback, link-local, docker, and supervisor infra ranges", () => {
    expectBadRequest(() => assertReachableDeviceIp("127.0.0.1")); // loopback
    expectBadRequest(() => assertReachableDeviceIp("169.254.169.254")); // link-local (cloud metadata)
    expectBadRequest(() => assertReachableDeviceIp("172.17.0.2")); // docker default bridge
    expectBadRequest(() => assertReachableDeviceIp("172.30.32.2")); // HA supervisor bridge
  });

  it("rejects malformed / out-of-range addresses", () => {
    expectBadRequest(() => assertReachableDeviceIp("192.168.1.999"));
    expectBadRequest(() => assertReachableDeviceIp("not.an.ip"));
    expectBadRequest(() => assertReachableDeviceIp(""));
  });

  it("rejects leading-zero / octal octet forms (fetch() would re-parse them as octal)", () => {
    // 010 -> 8, 021 -> 17, 040 -> 32 under the WHATWG URL parser fetch() uses;
    // Number() reads them as decimal. Accepting either would validate one host
    // and dial another — the exact SEC5 hazard the allow-list forbids.
    expectBadRequest(() => assertReachableDeviceIp("010.0.0.1"));
    expectBadRequest(() => assertReachableDeviceIp("172.021.0.2"));
    expectBadRequest(() => assertReachableDeviceIp("172.30.040.2"));
  });
});

const DEFAULT_CONFIG = {
  url: "http://192.168.1.50:8080/screen",
  sleepSec: 900,
  sidebar: true,
  fullRefreshFrequency: 10,
  imperialUnitsEnabled: false,
  tlsInsecure: false,
};

describe("validateSelfHostConfig", () => {
  it("accepts the §3 default config and returns strict JSON", () => {
    const json = validateSelfHostConfig(DEFAULT_CONFIG);
    expect(typeof json).toBe("string");
    expect(JSON.parse(json)).toEqual(DEFAULT_CONFIG);
  });

  it("accepts a minimal config carrying only the required url", () => {
    expect(() => validateSelfHostConfig({ url: "https://example.local/x" })).not.toThrow();
  });

  it("rejects a missing url", () => {
    expectBadRequest(() => validateSelfHostConfig({ sleepSec: 900 }));
  });

  it("rejects a url longer than 255 chars", () => {
    expectBadRequest(() => validateSelfHostConfig({ url: `http://${"a".repeat(260)}` }));
  });

  it("rejects a non-http(s) url", () => {
    expectBadRequest(() => validateSelfHostConfig({ url: "ftp://192.168.1.50/x" }));
  });

  it("rejects sleepSec out of range", () => {
    expectBadRequest(() => validateSelfHostConfig({ ...DEFAULT_CONFIG, sleepSec: 4 }));
    expectBadRequest(() => validateSelfHostConfig({ ...DEFAULT_CONFIG, sleepSec: 86401 }));
  });

  it("rejects fullRefreshFrequency of 0 or 11", () => {
    expectBadRequest(() => validateSelfHostConfig({ ...DEFAULT_CONFIG, fullRefreshFrequency: 0 }));
    expectBadRequest(() => validateSelfHostConfig({ ...DEFAULT_CONFIG, fullRefreshFrequency: 11 }));
  });

  it("rejects an unknown key (strict schema)", () => {
    expectBadRequest(() => validateSelfHostConfig({ ...DEFAULT_CONFIG, extra: true }));
  });

  it("keeps a schema-valid config well under the 1024-byte device limit", () => {
    // The 1024-byte cap in validateSelfHostConfig is defense-in-depth: the
    // 255-char `url` cap (the only near-unbounded field) keeps every
    // schema-valid body far below 1024 bytes, so a valid config can never trip
    // the cap. Pin that relationship so a future url-cap change cannot silently
    // let an over-limit body reach the device.
    const maxUrlConfig = { ...DEFAULT_CONFIG, url: `http://${"a".repeat(248)}` }; // 255-char url
    const json = validateSelfHostConfig(maxUrlConfig);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(1024);
  });
});
