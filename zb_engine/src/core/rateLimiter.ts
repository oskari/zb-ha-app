/**
 * rateLimiter.ts — Lightweight in-memory sliding-window rate limiter
 *
 * Uses a per-key (IP + route label) sliding window to throttle requests.
 * No external dependencies — keeps the add-on 100% local (ENGINEERING_CONSTRAINTS HA1).
 *
 * Old entries are lazily pruned on each check to keep memory bounded.
 */

import { Request, Response, NextFunction } from "express";
import { getRequestId, logWarn } from "./logger";

// ── Core limiter ───────────────────────────────────────────────

/** Sliding-window hit timestamps keyed by "ip:label". */
const hitMap = new Map<string, number[]>();

/**
 * Check if a request is within the rate limit.
 *
 * @param key  Unique key for the rate-limit bucket (e.g. "192.168.1.1:render")
 * @param windowMs  Sliding window duration in ms
 * @param maxHits  Maximum allowed hits within the window
 * @returns true if the request is allowed, false if rate-limited
 */
function isAllowed(key: string, windowMs: number, maxHits: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  let hits = hitMap.get(key);
  if (!hits) {
    hits = [];
    hitMap.set(key, hits);
  }

  // Prune expired entries (oldest are at the front)
  while (hits.length > 0 && hits[0] <= cutoff) {
    hits.shift();
  }

  if (hits.length >= maxHits) {
    return false;
  }

  hits.push(now);
  return true;
}

// ── Express middleware factory ──────────────────────────────────

/**
 * Create a rate-limiting Express middleware.
 *
 * @param label  Human-readable bucket label (e.g. "mutation", "source-test")
 * @param windowMs  Sliding window duration in ms
 * @param maxHits  Maximum requests allowed per window
 */
export function rateLimit(
  label: string,
  windowMs: number,
  maxHits: number,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // Use X-Forwarded-For (HA Ingress proxy) or fall back to remote address
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${label}`;

    if (!isAllowed(key, windowMs, maxHits)) {
      logWarn("rate_limit.reject", {
        requestId: getRequestId(req),
        label,
        method: req.method,
        statusCode: 429,
      });
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    next();
  };
}

// ── Periodic cleanup ───────────────────────────────────────────
// Remove empty buckets every 5 minutes to prevent slow memory growth
// from unique IPs that made a single request and never returned.

setInterval(() => {
  for (const [key, hits] of hitMap) {
    if (hits.length === 0) hitMap.delete(key);
  }
}, 5 * 60_000).unref();
