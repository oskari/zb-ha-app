/**
 * urlValidator.test.ts — Tests for SSRF protection
 *
 * This is the most security-critical module in the codebase.
 * Every IP encoding trick and DNS rebinding vector must be covered.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validateUrl, configureUrlValidator, configureBlockedHostnames } from "../src/data/urlValidator";

// Reset allowlist and configure HA blocked hostnames before tests
beforeAll(() => {
  configureUrlValidator([]);
  configureBlockedHostnames(["localhost", "supervisor", "hassio", "homeassistant"]);
});

// ── Protocol enforcement ───────────────────────────────────────

describe("protocol enforcement", () => {
  it("allows http://", () => {
    expect(() => validateUrl("test", "http://example.com/data")).not.toThrow();
  });

  it("allows https://", () => {
    expect(() => validateUrl("test", "https://example.com/data")).not.toThrow();
  });

  it("blocks file://", () => {
    expect(() => validateUrl("test", "file:///etc/passwd")).toThrow("only http: and https:");
  });

  it("blocks ftp://", () => {
    expect(() => validateUrl("test", "ftp://example.com/data")).toThrow("only http: and https:");
  });

  it("blocks data:", () => {
    expect(() => validateUrl("test", "data:text/html,<h1>hi</h1>")).toThrow();
  });

  it("rejects malformed URLs", () => {
    expect(() => validateUrl("test", "not-a-url")).toThrow("invalid URL");
  });
});

// ── Standard private IP patterns (dotted-decimal) ──────────────

describe("standard private IPs", () => {
  // Single-IP membership per RFC-private block (127.0.0.1, 192.168.1.1,
  // 172.16.0.1, 169.254.1.1, …) is covered by the "special-use IPv4 ranges"
  // it.each table below. These cases pin the distinct boundary values and the
  // negative (allowed) case that the table does not.
  it("blocks 127.255.255.255 (loopback range)", () => {
    expect(() => validateUrl("test", "http://127.255.255.255")).toThrow("private/internal");
  });

  it("blocks 10.0.0.1 (Class A private)", () => {
    expect(() => validateUrl("test", "http://10.0.0.1")).toThrow("private/internal");
  });

  it("blocks 172.31.255.255 (Class B private high)", () => {
    expect(() => validateUrl("test", "http://172.31.255.255")).toThrow("private/internal");
  });

  it("allows 172.32.0.1 (outside Class B private)", () => {
    expect(() => validateUrl("test", "http://172.32.0.1")).not.toThrow();
  });

  it("blocks 0.0.0.0 (current network)", () => {
    expect(() => validateUrl("test", "http://0.0.0.0")).toThrow("private/internal");
  });
});

describe("special-use IPv4 ranges", () => {
  const blockedRanges = [
    ["0.0.0.0/8", "0.0.0.1"],
    ["10.0.0.0/8", "10.1.2.3"],
    ["100.64.0.0/10", "100.64.0.1"],
    ["127.0.0.0/8", "127.0.0.1"],
    ["169.254.0.0/16", "169.254.1.1"],
    ["172.16.0.0/12", "172.16.0.1"],
    ["192.0.0.0/24", "192.0.0.1"],
    ["192.0.2.0/24", "192.0.2.1"],
    ["192.88.99.0/24", "192.88.99.1"],
    ["192.168.0.0/16", "192.168.1.1"],
    ["198.18.0.0/15", "198.18.0.1"],
    ["198.51.100.0/24", "198.51.100.1"],
    ["203.0.113.0/24", "203.0.113.1"],
    ["224.0.0.0/4", "224.0.0.1"],
    ["240.0.0.0/4", "240.0.0.1"],
    ["255.255.255.255/32", "255.255.255.255"],
  ];

  it.each(blockedRanges)("blocks %s (%s)", (_range, ip) => {
    expect(() => validateUrl("test", `http://${ip}/data`)).toThrow("private/internal");
  });
});

// ── Blocked hostnames ──────────────────────────────────────────

describe("blocked hostnames", () => {
  it("blocks localhost", () => {
    expect(() => validateUrl("test", "http://localhost/api")).toThrow("private/internal");
  });

  it("blocks supervisor (HA internal)", () => {
    expect(() => validateUrl("test", "http://supervisor/api")).toThrow("private/internal");
  });

  it("blocks hassio (HA internal)", () => {
    expect(() => validateUrl("test", "http://hassio/api")).toThrow("private/internal");
  });

  it("blocks homeassistant (HA internal)", () => {
    expect(() => validateUrl("test", "http://homeassistant/api")).toThrow("private/internal");
  });
});

// ── Alternative IP encodings (SSRF bypass attempts) ────────────

describe("decimal IP encoding", () => {
  it("blocks 2130706433 (= 127.0.0.1)", () => {
    expect(() => validateUrl("test", "http://2130706433")).toThrow("private");
  });

  it("blocks 167772161 (= 10.0.0.1)", () => {
    expect(() => validateUrl("test", "http://167772161")).toThrow("private");
  });

  it("blocks 3232235521 (= 192.168.0.1)", () => {
    expect(() => validateUrl("test", "http://3232235521")).toThrow("private");
  });

  it("blocks 1681915905 (= 100.64.0.1)", () => {
    expect(() => validateUrl("test", "http://1681915905")).toThrow("private");
  });
});

describe("hexadecimal IP encoding", () => {
  it("blocks 0x7f000001 (= 127.0.0.1)", () => {
    expect(() => validateUrl("test", "http://0x7f000001")).toThrow("private");
  });

  it("blocks 0x0a000001 (= 10.0.0.1)", () => {
    expect(() => validateUrl("test", "http://0x0a000001")).toThrow("private");
  });

  it("blocks 0xc0a80001 (= 192.168.0.1)", () => {
    expect(() => validateUrl("test", "http://0xc0a80001")).toThrow("private");
  });

  it("blocks 0xc0000201 (= 192.0.2.1)", () => {
    expect(() => validateUrl("test", "http://0xc0000201")).toThrow("private");
  });
});

describe("octal IP encoding", () => {
  it("blocks 0177.0.0.1 (= 127.0.0.1)", () => {
    expect(() => validateUrl("test", "http://0177.0.0.1")).toThrow("private");
  });

  it("blocks 012.0.0.1 (= 10.0.0.1)", () => {
    expect(() => validateUrl("test", "http://012.0.0.1")).toThrow("private");
  });

  it("blocks 0300.0.02.01 (= 192.0.2.1)", () => {
    expect(() => validateUrl("test", "http://0300.0.02.01")).toThrow("private");
  });
});

// ── IPv6 ───────────────────────────────────────────────────────

describe("IPv6 addresses", () => {
  it("blocks :: (unspecified)", () => {
    expect(() => validateUrl("test", "http://[::]/api")).toThrow("private/internal");
  });

  it("blocks ::1 (loopback)", () => {
    expect(() => validateUrl("test", "http://[::1]/api")).toThrow("private/internal");
  });

  it("blocks ::ffff:127.0.0.1 (IPv4-mapped)", () => {
    expect(() => validateUrl("test", "http://[::ffff:127.0.0.1]")).toThrow("private/internal");
  });

  it("blocks fe80:: (link-local)", () => {
    expect(() => validateUrl("test", "http://[fe80::1]")).toThrow("private/internal");
  });

  it("blocks fc00:: (ULA)", () => {
    expect(() => validateUrl("test", "http://[fc00::1]")).toThrow("private/internal");
  });

  it("blocks fd00:: (ULA)", () => {
    expect(() => validateUrl("test", "http://[fd00::1]")).toThrow("private/internal");
  });

  it("blocks ff00:: (multicast)", () => {
    expect(() => validateUrl("test", "http://[ff00::1]")).toThrow("private/internal");
  });
});

// ── Domain allowlist ───────────────────────────────────────────

describe("domain allowlist", () => {
  it("allows any domain when allowlist is empty", () => {
    configureUrlValidator([]);
    expect(() => validateUrl("test", "https://api.weather.com/data")).not.toThrow();
  });

  it("blocks non-listed domains when allowlist is set", () => {
    configureUrlValidator(["api.weather.com"]);
    expect(() => validateUrl("test", "https://evil.com/data")).toThrow("not in the allowed");
  });

  it("allows exact domain match", () => {
    configureUrlValidator(["api.weather.com"]);
    expect(() => validateUrl("test", "https://api.weather.com/data")).not.toThrow();
  });

  it("allows subdomain match", () => {
    configureUrlValidator(["weather.com"]);
    expect(() => validateUrl("test", "https://api.weather.com/data")).not.toThrow();
  });

  // Reset for subsequent tests (runs even if a test above fails).
  afterAll(() => configureUrlValidator([]));
});

// ── Allowlist normalization + anchored match (P1.3) ────────────

describe("domain allowlist — normalization", () => {
  afterAll(() => configureUrlValidator([]));

  it("normalizes case, surrounding whitespace, and leading/trailing dots", () => {
    configureUrlValidator(["  .API.Weather.Com.  "]);
    expect(() => validateUrl("test", "https://api.weather.com/data")).not.toThrow();
    expect(() => validateUrl("test", "https://sub.api.weather.com/data")).not.toThrow();
    expect(() => validateUrl("test", "https://evil.com/data")).toThrow("not in the allowed");
  });

  it("drops empty / dot-only entries so they cannot widen the allowlist", () => {
    // A stray "" or "." must NOT collapse into an allow-all / match-all rule.
    configureUrlValidator(["", "  ", ".", "api.weather.com"]);
    expect(() => validateUrl("test", "https://api.weather.com/data")).not.toThrow();
    expect(() => validateUrl("test", "https://evil.com/data")).toThrow("not in the allowed");
  });

  it("an allowlist of only empty entries means allow-all (empty list)", () => {
    configureUrlValidator(["", "  ", "."]);
    expect(() => validateUrl("test", "https://anything.example.org/data")).not.toThrow();
  });

  it("does not match lookalike suffixes (notweather.com vs weather.com)", () => {
    configureUrlValidator(["weather.com"]);
    expect(() => validateUrl("test", "https://notweather.com/data")).toThrow("not in the allowed");
    expect(() => validateUrl("test", "https://weather.com.evil.com/data")).toThrow("not in the allowed");
  });

  it("a trailing-dot hostname does not bypass the allowlist", () => {
    configureUrlValidator(["weather.com"]);
    // "api.weather.com." resolves identically to "api.weather.com" — must match.
    expect(() => validateUrl("test", "https://api.weather.com./data")).not.toThrow();
    // A non-listed trailing-dot host is still blocked.
    expect(() => validateUrl("test", "https://evil.com./data")).toThrow("not in the allowed");
  });
});

// ── Public IPs (should pass) ───────────────────────────────────

describe("public IPs allowed", () => {
  it("allows 8.8.8.8 (Google DNS)", () => {
    expect(() => validateUrl("test", "http://8.8.8.8")).not.toThrow();
  });

  it("allows 1.1.1.1 (Cloudflare DNS)", () => {
    expect(() => validateUrl("test", "http://1.1.1.1")).not.toThrow();
  });

  it("allows a public domain", () => {
    expect(() => validateUrl("test", "https://api.github.com")).not.toThrow();
  });
});

// ── Configurable blocked hostnames seam ────────────────────────

describe("configureBlockedHostnames", () => {
  it("core default 'localhost' is always blocked", () => {
    // Reset to only core defaults
    configureBlockedHostnames([]);
    expect(() => validateUrl("test", "http://localhost/api")).toThrow("private/internal");
  });

  it("adapter-provided hostnames are blocked after configuration", () => {
    configureBlockedHostnames(["custom-internal"]);
    expect(() => validateUrl("test", "http://custom-internal/api")).toThrow("private/internal");
  });

  it("normalizes hostnames to lowercase", () => {
    configureBlockedHostnames(["MyHost"]);
    expect(() => validateUrl("test", "http://myhost/api")).toThrow("private/internal");
  });

  it("accepts duplicate inputs without dropping a distinct hostname", () => {
    // Dedup itself is internal (the blocked list is module-private), so it has
    // no directly observable effect. What IS observable — and what the old
    // single-assert version missed — is that a duplicated entry must not stop a
    // *distinct* hostname in the same list from being registered. Use two
    // distinct customs plus a duplicate and assert both are blocked.
    configureBlockedHostnames(["custom-a", "custom-a", "custom-b"]);
    expect(() => validateUrl("test", "http://custom-a/api")).toThrow("private/internal");
    expect(() => validateUrl("test", "http://custom-b/api")).toThrow("private/internal");
  });

  // Restore HA hostnames for any subsequent tests
  afterAll(() => {
    configureBlockedHostnames(["localhost", "supervisor", "hassio", "homeassistant"]);
  });
});
