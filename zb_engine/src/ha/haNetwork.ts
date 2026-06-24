/**
 * haNetwork.ts — HA Supervisor host network info
 *
 * Exposes GET /api/host-ip on the Ingress port (8099). It asks the Supervisor
 * `/network/info` endpoint for the host's network interfaces and returns the
 * best-guess LAN IPv4 address, so the UI can show ESP32 devices a reachable
 * "http://<ip>:8000/image.bin" URL. ESP32 firmware typically cannot resolve the
 * "homeassistant.local" mDNS name, so it needs the numeric IP form.
 *
 * Requires `hassio_api: true` in config.yaml — the SUPERVISOR_TOKEN is only
 * authorized for Supervisor management endpoints (like /network/info) when that
 * flag is set. The default `hassio_role` is sufficient (read-only /info access).
 *
 * Mounted only on the Ingress port, where HA enforces session auth before any
 * request reaches this code. Like haEntities / haSources, the Supervisor call
 * targets the bare `http://supervisor` host and therefore bypasses the
 * urlValidator SSRF layer (which would block the supervisor bridge address as
 * an RFC1918 host) — the URL is hardcoded, never user-controlled.
 */

import type { Application, Request, Response } from "express";
import { fetchWithTimeout } from "../data/safeFetch";
import { rateLimit } from "../core/rateLimiter";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_HA_PROXY } from "../limits";
import { getRequestId, logWarn } from "../core/logger";

const SUPERVISOR_NETWORK_INFO_URL = "http://supervisor/network/info";
const NETWORK_INFO_TIMEOUT_MS = 10_000;

/**
 * Interface name prefixes that never represent the host's LAN interface:
 * loopback, the Docker / hassio bridges, virtual ethernet pairs, and common
 * VPN / overlay tunnels (WireGuard, Tailscale, ZeroTier, generic tun/tap).
 * These can carry valid-looking private IPs that are NOT the LAN address.
 */
const EXCLUDED_IFACE_PREFIXES = [
  "lo",
  "docker",
  "veth",
  "hassio",
  "wg",
  "tailscale",
  "tun",
  "tap",
  "zt",
];

/** One network interface as returned by the Supervisor /network/info API. */
export interface SupervisorInterface {
  interface?: string;
  type?: string;
  enabled?: boolean;
  connected?: boolean;
  primary?: boolean;
  ipv4?: { address?: string[]; ready?: boolean } | null;
}

/** A single usable LAN IPv4 candidate, derived from one interface. */
export interface HostIpCandidate {
  /** Interface name (e.g. "eth0", "wlan0"). */
  interface: string;
  /** IPv4 address with the CIDR suffix stripped (e.g. "192.168.1.50"). */
  ip: string;
  /** Whether the Supervisor flagged this as the primary interface. */
  primary: boolean;
}

/** Result of {@link selectHostIp}: the best-guess IP plus all candidates. */
export interface HostIpResult {
  /** Best-guess host LAN IPv4, or null when none could be determined. */
  ip: string | null;
  /** Every usable candidate, primary interface(s) first. */
  candidates: HostIpCandidate[];
}

/** Strip a trailing CIDR suffix ("192.168.1.50/24" → "192.168.1.50"). */
function stripCidr(address: string): string {
  return String(address).split("/")[0].trim();
}

/** True for addresses that can never be a device-reachable LAN IP. */
function isUsableIpv4(address: string): boolean {
  if (!address) return false;
  // Loopback and link-local (APIPA) are never reachable by an ESP32.
  if (address.startsWith("127.")) return false;
  if (address.startsWith("169.254.")) return false;
  // Coarse IPv4 dotted-quad shape check — the Supervisor only ever returns
  // well-formed addresses here, so this just guards against empty / garbage.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}

/** True when an interface name matches an excluded prefix. */
function isExcludedInterfaceName(name: string): boolean {
  return EXCLUDED_IFACE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Pick the host's best-guess LAN IPv4 from the Supervisor interface list.
 *
 * Selection rules (pure, fully unit-tested):
 *   1. Skip disabled / disconnected interfaces and infra/VPN interfaces.
 *   2. Take each remaining interface's first usable IPv4 (CIDR stripped).
 *   3. Prefer interfaces the Supervisor flagged `primary`; otherwise keep the
 *      Supervisor's declaration order (Array.prototype.sort is stable).
 *
 * Never throws — returns `{ ip: null, candidates: [] }` when nothing qualifies.
 */
export function selectHostIp(interfaces: SupervisorInterface[] | undefined): HostIpResult {
  const candidates: HostIpCandidate[] = [];

  for (const iface of interfaces ?? []) {
    const name = String(iface?.interface ?? "");
    if (!name || isExcludedInterfaceName(name)) continue;
    if (iface?.enabled === false || iface?.connected === false) continue;

    const ip = (iface?.ipv4?.address ?? []).map(stripCidr).find(isUsableIpv4);
    if (!ip) continue;

    candidates.push({ interface: name, ip, primary: iface?.primary === true });
  }

  // Stable sort: primary interfaces first, everything else in original order.
  candidates.sort((a, b) => Number(b.primary) - Number(a.primary));

  return { ip: candidates[0]?.ip ?? null, candidates };
}

// ── Image host-port mapping ────────────────────────────────────

const SUPERVISOR_ADDON_INFO_URL = "http://supervisor/addons/self/info";

/**
 * Container port (as declared in config.yaml `ports:`) that serves the ESP32
 * image endpoint. The Supervisor maps this to a host port the user can change
 * in the add-on Network settings; the device URL must use that host port.
 */
const IMAGE_CONTAINER_PORT = "8000/tcp";

/**
 * Pick the host port the image container port is mapped to, from a Supervisor
 * add-on `network` map (e.g. `{ "8000/tcp": 8123 }`). Returns the mapped port,
 * or null when the key is absent, unmapped (null), or not a valid 1–65535
 * integer. Pure and unit-tested — only the fetch wrapper around it is impure.
 */
export function selectAddonImagePort(
  network: Record<string, number | null> | undefined,
): number | null {
  const port = network?.[IMAGE_CONTAINER_PORT];
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : null;
}

/**
 * Fetch the host port this add-on's image endpoint (container 8000/tcp) is
 * mapped to, from the Supervisor's own-addon info. Users can remap this in the
 * add-on Network settings, so the ESP32 URL must reflect the host-mapped port
 * rather than the fixed container port. Returns null when it can't be resolved.
 *
 * Requires `hassio_api: true`; throws if SUPERVISOR_TOKEN is missing or the
 * Supervisor returns a non-2xx status. Callers treat the port as best-effort.
 * `/addons/self/info` is accessible to an add-on regardless of `hassio_role`
 * (the Supervisor api_bypasses self-info), so the default role is sufficient.
 */
export async function fetchAddonImagePort(signal?: AbortSignal): Promise<number | null> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) throw new Error("SUPERVISOR_TOKEN environment variable not available.");

  const res = await fetchWithTimeout(
    SUPERVISOR_ADDON_INFO_URL,
    NETWORK_INFO_TIMEOUT_MS,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    signal,
  );

  if (!res.ok) throw new Error(`HA Supervisor addon info API returned HTTP ${res.status}`);

  const body = (await res.json()) as { data?: { network?: Record<string, number | null> } };
  return selectAddonImagePort(body?.data?.network);
}

/**
 * Fetch the host's network interfaces from the HA Supervisor API.
 * Requires `hassio_api: true`; throws if SUPERVISOR_TOKEN is missing or the
 * Supervisor returns a non-2xx status.
 */
export async function fetchHostNetworkInfo(signal?: AbortSignal): Promise<SupervisorInterface[]> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) throw new Error("SUPERVISOR_TOKEN environment variable not available.");

  const res = await fetchWithTimeout(
    SUPERVISOR_NETWORK_INFO_URL,
    NETWORK_INFO_TIMEOUT_MS,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    signal,
  );

  if (!res.ok) throw new Error(`HA Supervisor network API returned HTTP ${res.status}`);

  const body = (await res.json()) as { data?: { interfaces?: SupervisorInterface[] } };
  return body?.data?.interfaces ?? [];
}

/**
 * Register the host-network route on the Express app.
 * Only available on the Ingress port.
 */
export function registerNetworkRoutes(app: Application): void {
  // Share the Supervisor-proxy rate limiter with /entities and /history — this
  // route fans out to the Supervisor too, so it belongs in the same budget.
  const proxyLimiter = rateLimit("ha-proxy", RATE_LIMIT_WINDOW_MS, RATE_LIMIT_HA_PROXY);

  // GET /api/host-ip — best-guess host LAN IPv4 + the host port the image
  // endpoint is mapped to, for ESP32 device URLs (http://<ip>:<port>).
  app.get("/api/host-ip", proxyLimiter, async (req: Request, res: Response) => {
    try {
      // The IP is the primary signal: if its lookup fails the route 500s, as
      // before. The port comes from a second Supervisor endpoint and is
      // best-effort — a failure there resolves to null and the client falls
      // back to the documented default host port.
      const [interfaces, port] = await Promise.all([
        fetchHostNetworkInfo(),
        fetchAddonImagePort().catch(() => null),
      ]);
      res.json({ ...selectHostIp(interfaces), port });
    } catch (err) {
      logWarn("source.fetch.failure", {
        requestId: getRequestId(req),
        route: "GET /api/host-ip",
        sourceKind: "haNetwork",
        error: err,
      });
      res.status(500).json({ error: "Failed to fetch host network info." });
    }
  });
}
