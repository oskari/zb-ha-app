/**
 * haDevice.ts — guided Self-Host §3 `/config` push proxy (Ingress port only)
 *
 * Exposes `POST /api/device/config` on the Ingress port (8099). It lets an
 * already-authenticated HA user have the server POST a fixed-shape self-host
 * config (Self-host-mode.md §3) to an ESP32 sitting on the LAN, so the browser
 * never talks to the device directly.
 *
 * SECURITY: this is a scoped, authenticated SSRF-by-design. Its whole purpose is
 * to reach a PRIVATE LAN IP, so the outbound fetch intentionally bypasses the
 * urlValidator SSRF layer (which blocks RFC1918) — exactly like haNetwork.ts's
 * hardcoded Supervisor-host bypass. That is only safe because of the
 * compensating controls this module enforces (post-plan.md §3.5):
 *   - Auth gate: reachable ONLY through the session-authed Ingress port. It must
 *     NEVER be registered on the unauthenticated image app / port 8000 (§3.4).
 *   - Allow-list + canonicalize-then-dial: accepts only well-formed dotted-quad
 *     RFC1918, then rebuilds the dotted-quad from the parsed integer and dials
 *     that canonical value — so the address we validate and the address fetch()
 *     connects to are byte-identical (no validate-vs-connect parser differential).
 *     Decimal/hex/IPv6 and leading-zero (octal) forms are rejected; no hostnames
 *     are accepted, so there is no DNS-rebinding vector.
 *   - Infra carve-outs: loopback, link-local, Docker and HA-Supervisor bridge
 *     ranges are blocked inside the private space.
 *   - Tight blast radius: POST to a fixed `:80/config` target only (device port
 *     is a constant, never a user-supplied field), ≤1024-byte schema-validated
 *     body, `redirect:"error"`, 10s timeout, rate-limited, ≤2KB response.
 */

import { z } from "zod";
import type { Application, Request, Response } from "express";
import { fetchWithTimeout, readResponseTextWithLimit } from "../data/safeFetch";
import { rateLimit } from "../core/rateLimiter";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_DEVICE_CONFIG, DEVICE_CONFIG_TIMEOUT_MS } from "../limits";
import { getRequestId, logWarn } from "../core/logger";

// ── Validators (pure) ──────────────────────────────────────────

/** A 400-tagged error the route turns into an HTTP 400. */
function badRequest(message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = 400;
  return e;
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1);
  // Reject leading-zero octets ("010"): the WHATWG URL parser that fetch()
  // uses treats them as OCTAL (010 -> 8) while Number() reads them as decimal
  // (010 -> 10). Validating one value and dialing another is the SEC5 hazard,
  // so forbid the ambiguity outright (see assertReachableDeviceIp / §3.5).
  if (parts.some((p) => p.length > 1 && p[0] === "0")) return null;
  const o = parts.map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}
const inRange = (ip: number, r: { base: number; mask: number }) =>
  ((ip & r.mask) >>> 0) === r.base;

// Allowed private LAN ranges (RFC1918).
const ALLOWED_PRIVATE = [
  { base: 0x0a000000, mask: 0xff000000 }, // 10.0.0.0/8
  { base: 0xac100000, mask: 0xfff00000 }, // 172.16.0.0/12
  { base: 0xc0a80000, mask: 0xffff0000 }, // 192.168.0.0/16
];
// Blocked infra ranges INSIDE the private space — checked BEFORE the allow.
const BLOCKED_INTERNAL = [
  { base: 0x7f000000, mask: 0xff000000 }, // 127.0.0.0/8 loopback
  { base: 0xa9fe0000, mask: 0xffff0000 }, // 169.254.0.0/16 link-local (cloud metadata)
  { base: 0xac110000, mask: 0xffff0000 }, // 172.17.0.0/16 docker default bridge
  { base: 0xac1e2000, mask: 0xfffffe00 }, // 172.30.32.0/23 HA supervisor bridge
];

/** Throw badRequest unless `ip` is a reachable, non-infra private LAN IPv4.
 *  Returns the CANONICAL dotted-quad to dial — rebuilt from the validated
 *  integer so the value we validate and the value fetch() connects to are
 *  byte-identical (no validate-vs-connect parser differential). */
export function assertReachableDeviceIp(ip: string): string {
  const n = ipv4ToInt(ip);
  if (n === null)
    throw badRequest("Device IP must be a valid dotted-quad IPv4 address (no leading zeros).");
  if (BLOCKED_INTERNAL.some((r) => inRange(n, r)))
    throw badRequest("That address is reserved/internal and cannot be targeted.");
  if (!ALLOWED_PRIVATE.some((r) => inRange(n, r)))
    throw badRequest("Device IP must be a private LAN address (10.x, 172.16–31.x, or 192.168.x).");
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

const selfHostConfigSchema = z
  .object({
    url: z.string().min(1).max(255).regex(/^https?:\/\//, "must start with http:// or https://"),
    sleepSec: z.number().int().min(5).max(86400).optional(),
    sidebar: z.boolean().optional(),
    fullRefreshFrequency: z.number().int().min(1).max(10).optional(),
    imperialUnitsEnabled: z.boolean().optional(),
    tlsInsecure: z.boolean().optional(),
  })
  .strict(); // reject unknown keys — the device is strict & case-sensitive

/** Validate against §3 and return the exact strict-JSON string to send. */
export function validateSelfHostConfig(raw: unknown): string {
  const parsed = selfHostConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw badRequest(`Invalid config — ${detail}`);
  }
  const json = JSON.stringify(parsed.data);
  if (Buffer.byteLength(json, "utf8") > 1024)
    throw badRequest("Config exceeds the 1024-byte device limit.");
  return json;
}

// ── Outbound sender ────────────────────────────────────────────

export interface DeviceConfigResult { status: number; configured?: boolean; body?: unknown; }

// The device setup server is fixed at :80 by the firmware contract
// (Self-host-mode.md §3). It is a constant, NOT a user-supplied field — a
// caller-chosen port would turn this proxy into an internal port scanner.
const DEVICE_SETUP_PORT = 80;

/**
 * POST the strict-JSON config to the device's setup server (fixed :80).
 * SECURITY: intentionally bypasses urlValidator — the target is a
 * caller-supplied PRIVATE LAN IP (validated + CANONICALIZED by
 * assertReachableDeviceIp, so `ip` here is already a plain dotted-quad),
 * which urlValidator blocks by design. Mirrors haNetwork.ts's Supervisor
 * bypass. Only ever reached via the auth'd Ingress route (never port 8000).
 */
export async function postConfigToDevice(
  ip: string, jsonBody: string, signal?: AbortSignal,
): Promise<DeviceConfigResult> {
  const res = await fetchWithTimeout(
    `http://${ip}:${DEVICE_SETUP_PORT}/config`,
    DEVICE_CONFIG_TIMEOUT_MS,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: jsonBody, redirect: "error" },
    signal,
  );
  const text = await readResponseTextWithLimit(res, 2048, DEVICE_CONFIG_TIMEOUT_MS, "Device response").catch(() => "");
  let body: unknown = text;
  let configured: boolean | undefined;
  try {
    const j = JSON.parse(text);
    body = j;
    if (j && typeof j === "object" && typeof (j as Record<string, unknown>).configured === "boolean") {
      configured = (j as Record<string, boolean>).configured;
    }
  } catch { /* non-JSON device reply — keep raw text */ }
  return { status: res.status, configured, body };
}

// ── Route ──────────────────────────────────────────────────────

// Boundary schema (Constraint SEC1 — validate the whole body with Zod first).
// NOTE: no `port` — the device port is fixed at :80 (DEVICE_SETUP_PORT). A
// user-supplied port would widen the SSRF blast radius the §3.5 exception
// relies on being narrow (fixed `:80/config` target only).
const deviceConfigRequestSchema = z.object({
  deviceIp: z.string().min(1).max(45),          // form/range checked by assertReachableDeviceIp
  config: z.unknown(),                           // shape checked by validateSelfHostConfig
}).strict();

/** Register POST /api/device/config. INGRESS APP ONLY — never port 8000 (§3.4, HA3). */
export function registerDeviceRoutes(app: Application): void {
  const limiter = rateLimit("device-config", RATE_LIMIT_WINDOW_MS, RATE_LIMIT_DEVICE_CONFIG);
  app.post("/api/device/config", limiter, async (req: Request, res: Response) => {
    try {
      const parsed = deviceConfigRequestSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("Invalid request body.");

      // Canonical dotted-quad RFC1918 allow-list (§3.5). The returned value is
      // rebuilt from the validated integer, so it is exactly what we dial.
      const deviceIp = assertReachableDeviceIp(parsed.data.deviceIp);
      const jsonBody = validateSelfHostConfig(parsed.data.config); // §3 schema + ≤1024 bytes

      try {
        const result = await postConfigToDevice(deviceIp, jsonBody);
        res.json({ ok: true, status: result.status, configured: result.configured, body: result.body });
      } catch (err) {
        logWarn("device.config.push.failed", { requestId: getRequestId(req), error: err });
        res.status(502).json({
          error: "Couldn't reach the device. Make sure it's on the Self-Host Setup screen and on the same network.",
        });
      }
    } catch (err) {
      // SEC14: only echo our own 400 validation messages; never leak internals.
      if ((err as { status?: number })?.status === 400) {
        res.status(400).json({ error: (err as Error).message });
      } else {
        logWarn("device.config.route.error", { requestId: getRequestId(req), error: err });
        res.status(500).json({ error: "Request could not be processed." });
      }
    }
  });
}

export { badRequest };
