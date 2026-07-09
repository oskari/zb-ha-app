/**
 * imageApp.ts — On-demand image serving app for port 8000
 *
 * Extracted from ha/index.ts for testability. Encapsulates the image
 * buffer state, cooldown logic, and on-demand render triggering in a
 * dependency-injected factory that can be exercised with mock adapters.
 *
 * Security invariants (ENGINEERING_CONSTRAINTS HA3, §11, §13):
 *   - Unauthenticated by design (ESP32 has no auth capability)
 *   - Strictest CSP: default-src 'none'
 *   - X-Frame-Options: DENY (no legitimate framing use)
 *   - GET/HEAD only on `.png` (preview); POST only on `.bin` (device reply).
 *     Method handling is per-route (see `registerImageRoutes`) — the bare
 *     app from `createImageApp()` no longer enforces a blanket method
 *     guard, since Phase 2 of multi-device-plan.md requires POST to be
 *     valid on some paths and not others.
 *   - The `.bin` POST body is never parsed for meaning (no telemetry→render
 *     channel) — it is only bounded and discarded (Phase 2.2).
 */

import express from "express";
import { createHash } from "crypto";
import type { RenderGuard } from "../core/renderService";
import type { RenderMeta, Slot, DeviceId } from "../core/adapters";
import { DEFAULT_DEVICE_ID, assertValidDeviceId } from "../core/adapters";
import { MAX_DEVICE_REQUEST_BODY_BYTES } from "../limits";
import { buildFramedReply } from "./imageFrame";
import { logInfo, logWarn } from "../core/logger";

// ── Bare image app (security middleware only) ──────────────────

/**
 * Create the image-port Express app with security middleware.
 *
 * Exported for testing. The middleware stack is self-contained: security
 * headers only. Method handling is a per-route concern — routes are
 * registered by the caller after creation (see `registerImageRoutes` for
 * the get+all-405-catchall / post+all-405-catchall pattern this app uses).
 */
export function createImageApp(): express.Application {
  const app = express();

  // Express auto-generates a weak ETag on any res.send() that doesn't
  // already carry one. Disabling it here means only routes that explicitly
  // set their own (the GET .png strong SHA1 ETag) ever emit one — the POST
  // .bin framed reply and every error response (405/413/503) stay free of
  // an incidental, functionally-inert caching header.
  app.disable("etag");

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

  return app;
}

// ── Full on-demand image app ───────────────────────────────────

/** Dependencies injected into the on-demand image app factory. */
export interface OnDemandDeps {
  renderGuard: RenderGuard;
  /** Read the persisted payload for a device + slot. */
  readPayload: (slot: Slot, deviceId: DeviceId) => Promise<unknown | null>;
  runPipeline: (raw: unknown) => Promise<{ pngBuffer: Buffer; binBuffer: Buffer; meta: RenderMeta }>;
  /**
   * Per-(device,slot) minimum interval between on-demand renders triggered
   * by a port-8000 request. Defaults to 4000 ms (legacy behavior).
   * Configurable via the HA add-on `image_port_cooldown_ms` option.
   */
  cooldownMs?: number;
  /**
   * Render policy for port 8000:
   *  - `"on-demand"` (default): each request may trigger a fresh render
   *    once the per-(device,slot) cooldown elapses.
   *  - `"cache-only"`: requests only serve whatever buffer is currently in
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
   * Pre-set the in-memory image buffer for a device + slot and reset its
   * cooldown (startup warm-up). `meta` is cached alongside the buffers
   * because the framed device reply needs `width`/`height` at serve time,
   * potentially long after the render that produced them. `slot`/`deviceId`
   * default to `"primary"`/the default device for backward compatibility.
   */
  setBuffer(png: Buffer, bin: Buffer, meta: RenderMeta, slot?: Slot, deviceId?: DeviceId): void;
  /**
   * Get the current in-memory image buffer for a device + slot, or null if
   * it has not yet been rendered.
   */
  getBuffer(slot?: Slot, deviceId?: DeviceId): { png: Buffer; bin: Buffer } | null;
  /**
   * Drop a device + slot's in-memory buffer and reset its cooldown. Used
   * when a companion is removed so the next request starts cleanly.
   */
  evictSlot(slot: Slot, deviceId?: DeviceId): void;
}

/** Composite key so a render of one device/slot never collides with another. */
function bufferKey(deviceId: DeviceId, slot: Slot): string {
  return `${deviceId}:${slot}`;
}

/**
 * Create the full on-demand image app with the bare `/image.*` routes for
 * both the primary and fullscreen slots (a single device on port 8000).
 *
 * `GET .png` is the read-only builder/ESP32 preview path. `POST .bin` is the
 * device-facing framed reply (Self-host-mode.md §5): the *cached* rendered
 * bin buffer is wrapped with a fresh 25-byte header (including the live
 * clock) on every response — never cached itself, and never subject to a
 * 304, since the clock makes every response body unique.
 *
 * Each slot has its own in-memory buffer and cooldown timestamp so a render
 * of one does not affect serving or cooldown of the other. The process-global
 * `RenderGuard` still serializes actual renders (ENGINEERING_CONSTRAINTS §12)
 * — only the per-response framing is cheap enough to redo on every request.
 */
export function createOnDemandImageApp(deps: OnDemandDeps): OnDemandImageApp {
  const {
    renderGuard,
    readPayload,
    runPipeline,
    cooldownMs = 4_000,
    mode = "on-demand",
  } = deps;

  const buffers = new Map<string, { png: Buffer; bin: Buffer; meta: RenderMeta }>();
  const lastRenderAt = new Map<string, number>();
  /**
   * Strong ETag per (device, slot, format). Recomputed on every buffer
   * mutation (setBuffer + on-demand render success). Used only by the GET
   * `.png` route — the POST `.bin` route never does conditional-GET (see
   * `registerImageRoutes`), since the live clock in every framed reply
   * makes the body unique regardless of image content.
   */
  const etags = new Map<string, string>(); // key = `${deviceId}:${slot}:${format}`

  function etagKey(key: string, format: "png" | "bin"): string {
    return `${key}:${format}`;
  }
  function computeEtag(buf: Buffer): string {
    return `"sha1-${createHash("sha1").update(buf).digest("hex")}"`;
  }
  function refreshEtags(key: string, png: Buffer, bin: Buffer): void {
    etags.set(etagKey(key, "png"), computeEtag(png));
    etags.set(etagKey(key, "bin"), computeEtag(bin));
  }

  const app = createImageApp();

  /**
   * Bound and discard the `.bin` POST body. The ESP32 sends a small JSON
   * telemetry payload (Self-host-mode.md §4), but this add-on has no
   * telemetry→render-context channel (multi-device-plan.md Phase 2.2) —
   * `type: () => true` accepts any (or no) Content-Type so the body is
   * always captured up to the cap and never left to grow unbounded; it is
   * never read from `req.body` afterward.
   */
  const ignoreDeviceRequestBody = express.raw({ limit: MAX_DEVICE_REQUEST_BODY_BYTES, type: () => true });

  /**
   * Attempt a fresh on-demand render for a device + slot. Updates that
   * pair's in-memory buffer and cooldown timestamp on success. Cooldowns
   * are tracked per (device, slot) so devices/slots never rate-limit each
   * other; the RenderGuard is process-global (one render at a time across
   * everything, per ENGINEERING_CONSTRAINTS §12).
   */
  async function tryOnDemandRender(deviceId: DeviceId, slot: Slot): Promise<boolean> {
    // Cache-only mode: the unauthenticated port never drives renders.
    // The Ingress UI and the periodic re-render timer remain the only
    // render triggers. Stops a LAN-side flood from creating CPU load.
    if (mode === "cache-only") return false;

    const key = bufferKey(deviceId, slot);

    // Gate 1: per-(device,slot) cooldown — skip if this pair rendered recently
    if (Date.now() - (lastRenderAt.get(key) ?? 0) < cooldownMs) return false;

    // Gate 2: global concurrency — skip if any render is in progress
    const release = renderGuard.tryAcquire();
    if (!release) return false;

    try {
      const payload = await readPayload(slot, deviceId);
      if (!payload) {
        // Payload missing on disk → companion/device was removed (or never
        // existed). Drop any cached buffer so subsequent requests get the
        // canonical 503 response instead of a stale image. Cheap to call
        // when there is nothing cached.
        buffers.delete(key);
        etags.delete(etagKey(key, "png"));
        etags.delete(etagKey(key, "bin"));
        return false;
      }

      logInfo("render.start", { surface: "image", slot, deviceId });
      const { pngBuffer, binBuffer, meta } = await runPipeline(payload);
      buffers.set(key, { png: pngBuffer, bin: binBuffer, meta });
      lastRenderAt.set(key, Date.now());
      refreshEtags(key, pngBuffer, binBuffer);

      logInfo("render.finish", {
        surface: "image",
        slot,
        deviceId,
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
          deviceId,
          count: meta.renderErrors.length,
          errors: meta.renderErrors,
        });
      }
      if (meta.sourceErrors.length > 0) {
        logWarn("source.fetch.failure", {
          surface: "image",
          slot,
          deviceId,
          count: meta.sourceErrors.length,
          errors: meta.sourceErrors,
        });
      }
      return true;
    } catch (err) {
      logWarn("render.failed", { surface: "image", slot, deviceId, error: err });
      return false;
    } finally {
      release();
    }
  }

  /**
   * Register one GET `.png` + POST `.bin` route pair for a given slot and
   * path shape. `resolveDeviceId` resolves the target device — always the
   * constant `DEFAULT_DEVICE_ID`, the single device served on this port.
   *
   * Method handling is per-route: `app.get`/`app.post` match only their
   * intended verb; a trailing `app.all` on the same literal path catches
   * every other method with a clean 405 + Allow header.
   */
  function registerImageRoutes(
    slot: Slot,
    paths: { pngPath: string; binPath: string },
    resolveDeviceId: (req: express.Request) => string,
  ): void {
    function resolveValidDeviceId(req: express.Request, res: express.Response): DeviceId | null {
      const raw = resolveDeviceId(req);
      try {
        assertValidDeviceId(raw);
      } catch {
        res.status(404).json({ error: "Unknown device." });
        return null;
      }
      return raw;
    }

    // ── GET .png — read-only preview, unchanged behavior, now per-device ──
    app.get(paths.pngPath, async (req, res) => {
      const deviceId = resolveValidDeviceId(req, res);
      if (deviceId === null) return;
      const key = bufferKey(deviceId, slot);

      // Conditional GET fast path: skip BOTH the render trigger AND the
      // body write when the client already has the current ETag. Crucial
      // on the unauthenticated port — a polling client does not need to
      // drive a render every cycle.
      const currentEtag = etags.get(etagKey(key, "png"));
      if (currentEtag && req.headers["if-none-match"] === currentEtag) {
        res.setHeader("ETag", currentEtag);
        res.status(304).end();
        return;
      }

      await tryOnDemandRender(deviceId, slot);
      const buf = buffers.get(key);
      if (!buf) {
        res.status(503).json({ error: "No image available yet." });
        return;
      }
      // Re-check after the render — a successful render rotates the ETag.
      const refreshedEtag = etags.get(etagKey(key, "png"));
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
    app.all(paths.pngPath, (_req, res) => {
      res.status(405).setHeader("Allow", "GET, HEAD").json({ error: "Method not allowed." });
    });

    // ── POST .bin — device-facing framed reply ─────────────────────────
    app.post(paths.binPath, ignoreDeviceRequestBody, async (req, res) => {
      const deviceId = resolveValidDeviceId(req, res);
      if (deviceId === null) return;
      const key = bufferKey(deviceId, slot);

      // No conditional-GET path here: the live clock in every framed reply
      // makes the body unique regardless of image content, and the device
      // expects a fresh image (and a fresh clock) on every wake.
      await tryOnDemandRender(deviceId, slot);
      const buf = buffers.get(key);
      if (!buf) {
        res.status(503).json({ error: "No image available yet." });
        return;
      }
      const body = buildFramedReply({ width: buf.meta.width, height: buf.meta.height, binBuffer: buf.bin });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(body);
    });
    app.all(paths.binPath, (_req, res) => {
      res.status(405).setHeader("Allow", "POST").json({ error: "Method not allowed." });
    });
  }

  const defaultDeviceId = (): string => DEFAULT_DEVICE_ID;

  registerImageRoutes("primary", { pngPath: "/image.png", binPath: "/image.bin" }, defaultDeviceId);
  registerImageRoutes(
    "fullscreen",
    { pngPath: "/image_fullscreen.png", binPath: "/image_fullscreen.bin" },
    defaultDeviceId,
  );

  // Terminal error handler — catches the body-parser's 413 (oversized POST
  // body, see `ignoreDeviceRequestBody`) and anything else that reaches
  // `next(err)`, returning bounded JSON instead of Express's default HTML
  // error page. Must be registered after all routes; Express identifies an
  // error handler by its 4-argument arity.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const candidate = err as { status?: unknown; statusCode?: unknown } | null;
    const rawStatus =
      typeof candidate?.status === "number"
        ? candidate.status
        : typeof candidate?.statusCode === "number"
          ? candidate.statusCode
          : 500;
    const status = rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
    logWarn("image_app.error", { statusCode: status, error: err });
    res.status(status).json({ error: status === 413 ? "Request body too large." : "Request could not be processed." });
  });

  return {
    app,
    setBuffer(png: Buffer, bin: Buffer, meta: RenderMeta, slot: Slot = "primary", deviceId: DeviceId = DEFAULT_DEVICE_ID) {
      const key = bufferKey(deviceId, slot);
      buffers.set(key, { png, bin, meta });
      lastRenderAt.set(key, Date.now());
      refreshEtags(key, png, bin);
    },
    getBuffer(slot: Slot = "primary", deviceId: DeviceId = DEFAULT_DEVICE_ID) {
      const buf = buffers.get(bufferKey(deviceId, slot));
      return buf ? { png: buf.png, bin: buf.bin } : null;
    },
    evictSlot(slot: Slot, deviceId: DeviceId = DEFAULT_DEVICE_ID) {
      const key = bufferKey(deviceId, slot);
      buffers.delete(key);
      lastRenderAt.delete(key);
      etags.delete(etagKey(key, "png"));
      etags.delete(etagKey(key, "bin"));
    },
  };
}
