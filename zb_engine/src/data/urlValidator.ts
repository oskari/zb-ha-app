/**
 * urlValidator.ts — Shared RFC1918 + domain allowlist URL validation
 *
 * Used by both sourceFetcher.ts (for HTTP sources) and
 * assetLimits.ts (for img/svg element URLs) to prevent SSRF attacks.
 *
 * Covers ALL private/reserved IP representations:
 *   - Standard dotted-decimal private and special-use IPv4 ranges
 *   - Decimal notation (http://2130706433 = 127.0.0.1)
 *   - Hexadecimal (http://0x7f000001)
 *   - Octal (http://0177.0.0.1)
 *   - IPv6 unspecified (::), loopback (::1), link-local, ULA, multicast
 *   - IPv6-mapped IPv4 (::ffff:127.0.0.1)
 *   - DNS rebinding (best-effort): hostname resolved at validation time and the
 *     resolved IP checked. The fetch re-resolves independently, so a residual
 *     TOCTOU window remains (see SECURITY.md) — this is not a complete fix.
 */

import * as dns from "dns";
import { DNS_LOOKUP_TIMEOUT_MS } from "../limits";

// ── Special-use IP helpers ─────────────────────────────────────

const SPECIAL_USE_IPV4_RANGES = [
  { base: 0x00000000, mask: 0xff000000 }, // 0.0.0.0/8
  { base: 0x0a000000, mask: 0xff000000 }, // 10.0.0.0/8
  { base: 0x64400000, mask: 0xffc00000 }, // 100.64.0.0/10
  { base: 0x7f000000, mask: 0xff000000 }, // 127.0.0.0/8
  { base: 0xa9fe0000, mask: 0xffff0000 }, // 169.254.0.0/16
  { base: 0xac100000, mask: 0xfff00000 }, // 172.16.0.0/12
  { base: 0xc0000000, mask: 0xffffff00 }, // 192.0.0.0/24
  { base: 0xc0000200, mask: 0xffffff00 }, // 192.0.2.0/24
  { base: 0xc0586300, mask: 0xffffff00 }, // 192.88.99.0/24
  { base: 0xc0a80000, mask: 0xffff0000 }, // 192.168.0.0/16
  { base: 0xc6120000, mask: 0xfffe0000 }, // 198.18.0.0/15
  { base: 0xc6336400, mask: 0xffffff00 }, // 198.51.100.0/24
  { base: 0xcb007100, mask: 0xffffff00 }, // 203.0.113.0/24
  { base: 0xe0000000, mask: 0xf0000000 }, // 224.0.0.0/4
  { base: 0xf0000000, mask: 0xf0000000 }, // 240.0.0.0/4
  { base: 0xffffffff, mask: 0xffffffff }, // 255.255.255.255/32
] as const;

let blockedHostnames = ["localhost"];

// ── Shared security config ─────────────────────────────────────

let allowedDomains: string[] = [];

/**
 * Configure the shared URL validator.
 * Called once from index.ts on startup after loading add-on options.
 *
 * Entries are normalized — lowercased, trimmed, and stripped of leading/
 * trailing dots — and empties are dropped. This prevents malformed entries
 * (e.g. `".Example.com."`, `""`) from silently widening or breaking the
 * allowlist match. NOTE: an empty resulting list means **allow-all** (no
 * allowlist enforcement); callers should surface that prominently.
 */
export function configureUrlValidator(domains: string[]): void {
  allowedDomains = (Array.isArray(domains) ? domains : [])
    .map((d) => d.toLowerCase().trim().replace(/^\.+/, "").replace(/\.+$/, ""))
    .filter((d) => d.length > 0);
}

/**
 * Configure platform-specific blocked hostnames.
 * Merges the adapter-provided list with the core defaults, normalizes to
 * lowercase, and deduplicates.
 */
export function configureBlockedHostnames(hostnames: string[]): void {
  const merged = new Set([
    "localhost",
    ...(Array.isArray(hostnames) ? hostnames : []).map((h) => h.toLowerCase()),
  ]);
  blockedHostnames = [...merged];
}

function isSpecialUseIpv4Numeric(ip: number): boolean {
  if (!Number.isInteger(ip) || ip < 0 || ip > 0xffffffff) return false;
  return SPECIAL_USE_IPV4_RANGES.some(
    ({ base, mask }) => ((ip & mask) >>> 0) === base,
  );
}

function dottedIpv4ToNumeric(hostname: string): number | null {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  const octets = hostname.split(".").map((part) => Number(part));
  if (!octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    return null;
  }
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function dottedIpv4WithOctalToNumeric(hostname: string): number | null {
  if (!/^\d+(\.\d+){0,3}$/.test(hostname) || !/^0\d/.test(hostname)) return null;
  const octets = hostname.split(".").map((part) => (
    part.startsWith("0") && part.length > 1 ? parseInt(part, 8) : parseInt(part, 10)
  ));
  if (octets.length !== 4) return null;
  if (!octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    return null;
  }
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function isBlockedIpv6Literal(hostname: string): boolean {
  if (!hostname.includes(":")) return false;

  const ip = hostname.toLowerCase();
  if (ip === "::" || ip === "0:0:0:0:0:0:0:0") return true;
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (/^fe[89ab][0-9a-f]?:/i.test(ip)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 unique local
  if (/^ff[0-9a-f]{2}:/i.test(ip)) return true; // ff00::/8 multicast
  if (/^::ffff:/i.test(ip)) return true; // IPv4-mapped, compressed
  if (/^0:0:0:0:0:ffff:/i.test(ip)) return true; // IPv4-mapped, uncompressed

  return false;
}

/**
 * Validate a URL against the RFC1918 blocklist and domain allowlist.
 * Throws an Error if the URL is blocked.
 *
 * @param label - Human-readable label for error messages (e.g. "Image source", "Source myApi")
 * @param rawUrl - The URL to validate
 */
export function validateUrl(label: string, rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label}: invalid URL "${rawUrl}"`);
  }

  // Block non-HTTP(S) protocols (e.g. file://, ftp://, data:)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${label}: blocked — only http: and https: protocols are allowed, got "${parsed.protocol}"`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  // Strip square brackets from IPv6 literals and any trailing FQDN-root
  // dot(s). A trailing dot (e.g. "example.com." or "127.0.0.1.") resolves
  // identically but would otherwise dodge the IPv4-literal pattern checks
  // and the allowlist suffix match.
  const cleanHostname = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");

  // Check blocked hostnames
  if (blockedHostnames.includes(cleanHostname)) {
    throw new Error(
      `${label}: blocked — "${cleanHostname}" is a private/internal address. ` +
        `Only public external URLs are allowed.`,
    );
  }

  if (isBlockedIpv6Literal(cleanHostname)) {
    throw new Error(
      `${label}: blocked — "${cleanHostname}" is a private/internal address. ` +
        `Only public external URLs are allowed.`,
    );
  }

  const dottedIp = dottedIpv4ToNumeric(cleanHostname);
  if (dottedIp !== null && isSpecialUseIpv4Numeric(dottedIp)) {
    throw new Error(
      `${label}: blocked — "${cleanHostname}" is a private/internal address. ` +
        `Only public external URLs are allowed.`,
    );
  }

  // Detect decimal IP notation (e.g. http://2130706433 = 127.0.0.1)
  if (/^\d+$/.test(cleanHostname)) {
    const decimalIp = parseInt(cleanHostname, 10);
    if (isSpecialUseIpv4Numeric(decimalIp)) {
      throw new Error(
        `${label}: blocked — decimal IP "${cleanHostname}" resolves to a private address.`,
      );
    }
  }

  // Detect hex IP notation (e.g. http://0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(cleanHostname)) {
    const hexIp = parseInt(cleanHostname, 16);
    if (isSpecialUseIpv4Numeric(hexIp)) {
      throw new Error(
        `${label}: blocked — hex IP "${cleanHostname}" resolves to a private address.`,
      );
    }
  }

  // Detect octal notation in dotted-decimal (e.g. 0177.0.0.1 = 127.0.0.1)
  const octalIp = dottedIpv4WithOctalToNumeric(cleanHostname);
  if (octalIp !== null) {
    if (isSpecialUseIpv4Numeric(octalIp)) {
      throw new Error(
        `${label}: blocked — octal IP "${cleanHostname}" resolves to a private address.`,
      );
    }
  }

  // Domain allowlist enforcement
  if (allowedDomains.length > 0) {
    const allowed = allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      return cleanHostname === d || cleanHostname.endsWith(`.${d}`);
    });
    if (!allowed) {
      throw new Error(
        `${label}: blocked — "${cleanHostname}" is not in the allowed_source_domains list.`,
      );
    }
  }
}

// ── DNS rebinding protection ───────────────────────────────────

/**
 * Check if a resolved IP address string falls within private/reserved ranges.
 * Handles both IPv4 dotted-decimal and IPv6 text representations.
 */
function isPrivateIpString(ip: string): boolean {
  const cleanIp = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (isBlockedIpv6Literal(cleanIp)) return true;

  const numericIp = dottedIpv4ToNumeric(cleanIp);
  return numericIp !== null && isSpecialUseIpv4Numeric(numericIp);
}

/**
 * Validate a URL with DNS resolution — best-effort DNS-rebinding mitigation.
 *
 * Performs all the same synchronous checks as `validateUrl()`, then resolves
 * the hostname via DNS and validates the resolved IP is not private/reserved.
 *
 * NOTE: the subsequent fetch re-resolves the hostname independently, so a
 * residual DNS-rebinding (TOCTOU) window remains between this check and the
 * request. This narrows — but does not close — the attack; see SECURITY.md.
 *
 * @param label - Human-readable label for error messages
 * @param rawUrl - The URL to validate
 */
export async function validateUrlWithDns(label: string, rawUrl: string): Promise<void> {
  // Run all synchronous checks first (protocol, patterns, allowlist, etc.)
  validateUrl(label, rawUrl);

  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();

  // Skip DNS resolution for IP literals — already checked by validateUrl()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;
  if (hostname.includes(":")) return; // IPv6 literal

  // Resolve the hostname and validate the resolved IP
  try {
    const result = await Promise.race([
      dns.promises.lookup(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`DNS lookup timed out for "${hostname}"`)), DNS_LOOKUP_TIMEOUT_MS),
      ),
    ]);
    const address = (result as { address: string }).address;
    if (isPrivateIpString(address)) {
      throw new Error(
        `${label}: blocked — "${hostname}" resolves to private IP "${address}". ` +
          `DNS rebinding attack suspected.`,
      );
    }
  } catch (err) {
    // Re-throw our own validation errors
    if (err instanceof Error && err.message.includes("blocked")) throw err;
    // DNS resolution failure — block the request (fail-closed)
    throw new Error(
      `${label}: blocked — could not resolve hostname "${hostname}".`,
    );
  }
}
