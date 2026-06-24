/**
 * imageApp.ts — On-demand image serving app for port 8000
 *
 * Extracted from ha/index.ts for testability. Encapsulates the image
 * buffer state, cooldown logic, and on-demand render triggering in a
 * dependency-injected factory that can be exercised with mock adapters.
 *
 * Security invariants (ENGINEERING_CONSTRAINTS HA3, §11, §13):
 *   - Read-only: GET and HEAD only (405 for all others)
 *   - Unauthenticated by design (ESP32 has no auth capability)
 *   - Strictest CSP: default-src 'none'
 *   - X-Frame-Options: DENY (no legitimate framing use)
 */

import express from "express";
import { createHash } from "crypto";
import type { RenderGuard } from "../core/renderService";
import type { RenderMeta, Slot } from "../core/adapters";
import { logInfo, logWarn } from "../core/logger";

// ── Bare image app (security middleware only) ──────────────────

/**
 * Create the image-port Express app with security middleware.
 *
 * Exported for testing. The middleware stack is self-contained:
 * security headers + method rejection. Routes are registered
 * by the caller after creation.
 */
export function createImageApp(): express.Application {
  const app = express();

  // Prevent MIME sniffing and add security headers (ENGINEERING_CONSTRAINTS §11, §13)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // DENY — image-only endpoint has no legitimate framing use
    res.setHeader("X-Frame-Options", "DENY");
    // No resource loading needed — strictest possible CSP
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // Reject non-GET methods — port 8000 is strictly read-only (ENGINEERING_CONSTRAINTS HA3)
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).setHeader("Allow", "GET, HEAD").json({ error: "Method not allowed." });
      return;
    }
    next();
  });

  return app;
}

// ── Full on-demand image app ───────────────────────────────────

/** Dependencies injected into the on-demand image app factory. */
export interface OnDemandDeps {
  renderGuard: RenderGuard;
  /**
   * Read the persisted payload for a slot. The factory invokes this with
   * `"primary"` for `/image.{png,bin}` and `"fullscreen"` for
   * `/image_fullscreen.{png,bin}`.
   */
  readPayload: (slot?: Slot) => Promise<unknown | null>;
  runPipeline: (raw: unknown) => Promise<{ pngBuffer: Buffer; binBuffer: Buffer; meta: RenderMeta }>;
  /**
   * Per-slot minimum interval between on-demand renders triggered by a
   * port-8000 GET. Defaults to 4000 ms (legacy behavior). Configurable
   * via the HA add-on `image_port_cooldown_ms` option.
   */
  cooldownMs?: number;
  /**
   * Render policy for port 8000:
   *  - `"on-demand"` (default): each GET may trigger a fresh render
   *    once the per-slot cooldown elapses.
   *  - `"cache-only"`: GETs only serve whatever buffer is currently in
   *    memory; rendering is driven by the Ingress UI and the periodic
   *    re-render timer. Configurable via the HA add-on `image_port_mode`
   *    option.
   */
  mode?: "on-demand" | "cache-only";
}

/** Handle returned by the factory — includes the app and buffer controls. */
export interface OnDemandImageApp {
  app: express.Application;
  /**
   * Pre-set the in-memory image buffer for a slot and reset that slot's
   * cooldown (startup warm-up). Slot defaults to `"primary"` for backward
   * compatibility with existing call sites.
   */
  setBuffer(png: Buffer, bin: Buffer, slot?: Slot): void;
  /**
   * Get the current in-memory image buffer for a slot, or null if the
   * slot has not yet been rendered.
   */
  getBuffer(slot?: Slot): { png: Buffer; bin: Buffer } | null;
  /**
   * Drop a slot's in-memory buffer and reset its cooldown. Used when the
   * companion is removed so the next request starts cleanly.
   */
  evictSlot(slot: Slot): void;
}

/**
 * Create the full on-demand image app with /image.{png,bin} (primary) and
 * /image_fullscreen.{png,bin} (fullscreen companion) routes.
 *
 * Each slot has its own in-memory buffer and cooldown timestamp so a
 * render of one slot does not affect serving or cooldown of the other.
 * All four routes share the same security middleware stack from
 * `createImageApp` (CSP `default-src 'none'`, X-Frame-Options DENY,
 * 405 on non-GET/HEAD).
 */
export function createOnDemandImageApp(deps: OnDemandDeps): OnDemandImageApp {
  const {
    renderGuard,
    readPayload,
    runPipeline,
    cooldownMs = 4_000,
    mode = "on-demand",
  } = deps;

  const buffers = new Map<Slot, { png: Buffer; bin: Buffer }>();
  const lastRenderAt = new Map<Slot, number>();
  /**
   * Strong ETag per slot per format. Recomputed on every buffer
   * mutation (setBuffer + on-demand render success). The hash is
   * over the response body bytes so any pixel change — including
   * dither variation from a single source-driven binding — produces
   * a different ETag and avoids serving a stale 304.
   */
  const etags = new Map<string, string>(); // key = `${slot}:${format}`

  function etagKey(slot: Slot, format: "png" | "bin"): string {
    return `${slot}:${format}`;
  }
  function computeEtag(buf: Buffer): string {
    return `"sha1-${createHash("sha1").update(buf).digest("hex")}"`;
  }
  function refreshEtags(slot: Slot, png: Buffer, bin: Buffer): void {
    etags.set(etagKey(slot, "png"), computeEtag(png));
    etags.set(etagKey(slot, "bin"), computeEtag(bin));
  }

  const app = createImageApp();

  /**
   * Attempt a fresh on-demand render for `slot`. Updates that slot's
   * in-memory buffer and cooldown timestamp on success. Cooldowns are
   * tracked per-slot so primary and fullscreen do not rate-limit each
   * other; the RenderGuard is process-global (one render at a time
   * across all slots, per ENGINEERING_CONSTRAINTS §12).
   */
  async function tryOnDemandRender(slot: Slot): Promise<boolean> {
    // Cache-only mode: the unauthenticated port never drives renders.
    // The Ingress UI and the periodic re-render timer remain the only
    // render triggers. Stops a LAN-side flood from creating CPU load.
    if (mode === "cache-only") return false;

    // Gate 1: per-slot cooldown — skip if THIS slot rendered recently
    if (Date.now() - (lastRenderAt.get(slot) ?? 0) < cooldownMs) return false;

    // Gate 2: global concurrency — skip if any render is in progress
    const release = renderGuard.tryAcquire();
    if (!release) return false;

    try {
      const payload = await readPayload(slot);
      if (!payload) {
        // Payload missing on disk → companion was removed (or never existed).
        // Drop any cached buffer so subsequent requests get the canonical
        // 503 response instead of a stale image. Cheap to call when there
        // is nothing cached.
        buffers.delete(slot);
        etags.delete(etagKey(slot, "png"));
        etags.delete(etagKey(slot, "bin"));
        return false;
      }

      logInfo("render.start", { surface: "image", slot });
      const { pngBuffer, binBuffer, meta } = await runPipeline(payload);
      buffers.set(slot, { png: pngBuffer, bin: binBuffer });
      lastRenderAt.set(slot, Date.now());
      refreshEtags(slot, pngBuffer, binBuffer);

      logInfo("render.finish", {
        surface: "image",
        slot,
        renderTimeMs: meta.renderTimeMs,
        sourceErrorCount: meta.sourceErrors.length,
        renderErrorCount: meta.renderErrors.length,
        pngBytes: pngBuffer.length,
        binBytes: binBuffer.length,
      });
      if (meta.renderErrors.length > 0) {
        logWarn("render.element.warning", {
          surface: "image",
          slot,
          count: meta.renderErrors.length,
          errors: meta.renderErrors,
        });
      }
      if (meta.sourceErrors.length > 0) {
        logWarn("source.fetch.failure", {
          surface: "image",
          slot,
          count: meta.sourceErrors.length,
          errors: meta.sourceErrors,
        });
      }
      return true;
    } catch (err) {
      logWarn("render.failed", { surface: "image", slot, error: err });
      return false;
    } finally {
      release();
    }
  }

  /**
   * Register one PNG + one BIN route pair for a given slot. Keeps the
   * route bodies identical across slots — the only differences are the
   * URL path and the slot tag passed into `tryOnDemandRender`.
   */
  function registerSlotRoutes(slot: Slot, pngPath: string, binPath: string): void {
    app.get(pngPath, async (req, res) => {
      // Conditional GET fast path: skip BOTH the render trigger AND
      // the body write when the client already has the current ETag.
      // Crucial on the unauthenticated port — a polling ESP32 client
      // does not need to drive a render every cycle.
      const currentEtag = etags.get(etagKey(slot, "png"));
      if (currentEtag && req.headers["if-none-match"] === currentEtag) {
        res.setHeader("ETag", currentEtag);
        res.status(304).end();
        return;
      }

      await tryOnDemandRender(slot);
      const buf = buffers.get(slot);
      if (!buf) {
        res.status(503).json({ error: "No image available yet." });
        return;
      }
      // Re-check after the render — a successful render rotates the ETag.
      const refreshedEtag = etags.get(etagKey(slot, "png"));
      if (refreshedEtag && req.headers["if-none-match"] === refreshedEtag) {
        res.setHeader("ETag", refreshedEtag);
        res.status(304).end();
        return;
      }
      if (refreshedEtag) res.setHeader("ETag", refreshedEtag);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(buf.png);
    });

    app.get(binPath, async (req, res) => {
      const currentEtag = etags.get(etagKey(slot, "bin"));
      if (currentEtag && req.headers["if-none-match"] === currentEtag) {
        res.setHeader("ETag", currentEtag);
        res.status(304).end();
        return;
      }

      await tryOnDemandRender(slot);
      const buf = buffers.get(slot);
      if (!buf) {
        res.status(503).json({ error: "No image available yet." });
        return;
      }
      const refreshedEtag = etags.get(etagKey(slot, "bin"));
      if (refreshedEtag && req.headers["if-none-match"] === refreshedEtag) {
        res.setHeader("ETag", refreshedEtag);
        res.status(304).end();
        return;
      }
      if (refreshedEtag) res.setHeader("ETag", refreshedEtag);
      res.setHeader("Content-Type", "application/octet-stream");
      // Filename mirrors the URL path so the saved file matches what the
      // user fetched (image.bin vs image_fullscreen.bin).
      const filename = binPath.replace(/^\//, "");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(buf.bin);
    });
  }

  registerSlotRoutes("primary", "/image.png", "/image.bin");
  registerSlotRoutes("fullscreen", "/image_fullscreen.png", "/image_fullscreen.bin");

  return {
    app,
    setBuffer(png: Buffer, bin: Buffer, slot: Slot = "primary") {
      buffers.set(slot, { png, bin });
      lastRenderAt.set(slot, Date.now());
      refreshEtags(slot, png, bin);
    },
    getBuffer(slot: Slot = "primary") {
      return buffers.get(slot) ?? null;
    },
    evictSlot(slot: Slot) {
      buffers.delete(slot);
      lastRenderAt.delete(slot);
      etags.delete(etagKey(slot, "png"));
      etags.delete(etagKey(slot, "bin"));
    },
  };
}
