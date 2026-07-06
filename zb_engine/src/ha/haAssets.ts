/**
 * haAssets.ts — User-asset upload / list / delete / read routes (HA Ingress)
 *
 * Mounted by the HA platform adapter on port 8099. All routes require an
 * authenticated HA Ingress session — there is no unauthenticated path to
 * the asset store. Bytes flow:
 *
 *   POST   /api/assets             upload (multipart, single `file` field)
 *   GET    /api/assets             list metadata
 *   DELETE /api/assets/:filename   remove a stored asset (UUID filename)
 *   GET    /api/assets/:filename/raw   raw bytes for builder thumbnails
 *
 * Server-side renders read assets directly via the storage adapter — they
 * never go through these HTTP routes (see `data/userAssets.ts`).
 *
 * Security checklist (mapped to the plan §"Security Checklist"):
 *   - Filename is server-generated (UUID); the client filename is metadata only.
 *   - Magic-byte sniff rejects MIME spoofing; sharp re-encode strips EXIF / GPS.
 *   - SVG sanitisation strips <script>, <foreignObject>, <iframe>, on*, external href.
 *   - Per-file 2 MB cap, 50 MB / 200-file global quota, in-process upload mutex
 *     to close the quota check ↔ write race.
 *   - Path traversal / symlink escape rejected by the storage adapter.
 *   - Generic Content-Disposition on raw responses — no echo of user input.
 *   - Rate limited at 20 uploads / minute / session.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import type { StorageAdapter } from "../core/adapters";
import { sanitizeSvgForRasterization } from "../data/svgSanitization";
import { collapseWhitespaceRuns } from "../data/svgInlineSanitizer";
import {
  MAX_ASSET_SIZE_BYTES,
  MAX_ASSETS_TOTAL_BYTES,
  MAX_ASSET_COUNT,
  MAX_USER_SVG_BYTES,
  RATE_LIMIT_UPLOAD,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MUTATION,
} from "../limits";
import { rateLimit } from "../core/rateLimiter";
import { AsyncMutex } from "../core/asyncMutex";
import { getRequestId, logError, logWarn } from "../core/logger";

// ── Constants ──────────────────────────────────────────────────

/**
 * MIME ↔ extension whitelist. The extension drives both the on-disk
 * filename suffix and the response Content-Type for the raw endpoint;
 * the MIME is derived from server-side magic-byte detection (NOT from
 * the client's `Content-Type` header) so a polyglot upload cannot
 * spoof its way into a different code path.
 */
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "svg"]);

/**
 * Accepts the same shape as the storage layer's `ASSET_FILENAME_RE`.
 * Duplicated here as a Zod schema so route validation produces a clean
 * 400 rather than relying on a thrown error from the storage call.
 */
const assetFilenameSchema = z
  .string()
  .regex(/^[a-f0-9-]+\.(svg|png|jpe?g|webp)$/, "Invalid asset filename.");

/**
 * MIME type returned for each persisted extension. Used by the raw
 * endpoint — `image/svg+xml` is only emitted for `.svg` files, and
 * `nosniff` (set globally) prevents content-type sniffing in browsers.
 */
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

// ── Magic-byte sniff ──────────────────────────────────────────

/**
 * Detect a raster format by inspecting the first few bytes of the upload.
 * Returns the canonical extension (`png` / `jpg` / `webp`) on a hit, or
 * `null` if no known signature matches. SVG has no magic bytes — callers
 * fall through to a content-based check after this returns `null`.
 */
function sniffRasterExt(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

// ── Route registration ────────────────────────────────────────

/**
 * Mount the asset routes on an Express app.
 *
 * @param app      The HA Ingress Express application.
 * @param storage  Storage adapter exposing the asset methods. If the
 *                 adapter does not implement them (any of `saveAsset`,
 *                 `listAssets`, `deleteAsset`, `readAsset` is missing),
 *                 the routes return a 501 \u2014 no asset support on this
 *                 platform build.
 */
export function registerAssetRoutes(app: express.Application, storage: StorageAdapter): void {
  // Hard pre-condition: every asset method must be implemented. We check
  // at registration time so a misconfigured adapter fails loudly at boot
  // rather than serving 500s once a user clicks "Upload".
  const ready =
    typeof storage.listAssets === "function" &&
    typeof storage.saveAsset === "function" &&
    typeof storage.deleteAsset === "function" &&
    typeof storage.readAsset === "function";

  if (!ready) {
    logWarn("storage.error", { component: "assets", operation: "route_registration", reason: "missing_methods" });
    return;
  }

  // multer with memory storage: `limits.fileSize` aborts the stream at
  // the byte cap, so a multi-GB upload can never materialise on disk
  // (no temp files) or in memory (rejected before .buffer is populated).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_ASSET_SIZE_BYTES,
      files: 1,
      fields: 0,
    },
  });

  // Serialise quota check + write across concurrent uploads so two parallel
  // POSTs cannot both pass the count / byte quota before either persists.
  const uploadMutex = new AsyncMutex();
  const uploadLimiter = rateLimit("asset-upload", RATE_LIMIT_WINDOW_MS, RATE_LIMIT_UPLOAD);
  const mutationLimiter = rateLimit("asset-mutation", RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MUTATION);

  // ── POST /api/assets — upload ──────────────────────────────

  app.post(
    "/api/assets",
    uploadLimiter,
    // Defense-in-depth Content-Length pre-flight: reject before multer
    // even looks at the stream when the declared length already exceeds
    // the per-file cap.
    (req: Request, res: Response, next: NextFunction) => {
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_ASSET_SIZE_BYTES + 4096) {
        logWarn("upload.reject", {
          requestId: getRequestId(req),
          reason: "declared_size_limit",
          statusCode: 413,
        });
        res.status(413).json({ error: "File exceeds size limit." });
        return;
      }
      next();
    },
    // multer error handler — convert its `LIMIT_FILE_SIZE` etc. into
    // generic 4xx responses without leaking implementation detail.
    (req: Request, res: Response, next: NextFunction) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
          logWarn("upload.reject", {
            requestId: getRequestId(req),
            reason: err.code,
            statusCode: status,
          });
          res.status(status).json({ error: "Upload rejected." });
          return;
        }
        if (err) {
          logWarn("upload.reject", {
            requestId: getRequestId(req),
            reason: "multipart_error",
            statusCode: 400,
            error: err,
          });
          res.status(400).json({ error: "Upload failed." });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file || !file.buffer || file.buffer.length === 0) {
          logWarn("upload.reject", {
            requestId: getRequestId(req),
            reason: "missing_file",
            statusCode: 400,
          });
          res.status(400).json({ error: "Missing file." });
          return;
        }

        const bytes = file.buffer;

        // Determine the format from the bytes themselves (NOT the client's
        // filename or Content-Type). For SVG, the magic-byte sniff returns
        // null and we fall back to a structural check after sanitisation.
        const sniffed = sniffRasterExt(bytes);

        let storedExt: string;
        let storedBytes: Buffer;
        let storedMime: string;

        if (sniffed) {
          storedExt = sniffed;
          storedMime = EXT_TO_MIME[storedExt];
          // Re-encode through sharp. `failOn: 'error'` rejects malformed /
          // polyglot input; `.rotate()` (no argument) applies any EXIF
          // orientation transform and strips ALL metadata in one call —
          // including the GPS / EXIF blocks that would otherwise leak
          // location data when the asset is later served back.
          try {
            storedBytes = await sharp(bytes, { failOn: "error" }).rotate().toBuffer();
          } catch {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "decode_failed",
              statusCode: 400,
            });
            res.status(400).json({ error: "Image could not be decoded." });
            return;
          }
          // Re-encoded buffer must still respect the per-file cap.
          if (storedBytes.length > MAX_ASSET_SIZE_BYTES) {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "reencoded_size_limit",
              statusCode: 413,
            });
            res.status(413).json({ error: "File exceeds size limit after re-encode." });
            return;
          }
        } else {
          // SVG path — text-based content. Cap source size BEFORE parsing
          // so a multi-MB "SVG" can't tie up the regex sanitiser.
          if (bytes.length > MAX_USER_SVG_BYTES) {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "svg_size_limit",
              statusCode: 413,
            });
            res.status(413).json({ error: "SVG exceeds size limit." });
            return;
          }
          let text: string;
          try {
            text = bytes.toString("utf-8");
          } catch {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "svg_encoding",
              statusCode: 400,
            });
            res.status(400).json({ error: "Invalid SVG encoding." });
            return;
          }
          // Collapse long whitespace runs as well as parser-sanitizing, so the
          // bytes persisted to disk can never carry a run long enough to drive
          // the frozen engine's regex sanitizeSvg into super-linear backtracking
          // when the asset is later re-inlined at render time. Same cap the
          // pre-render SVG pass applies (data/svgInlineSanitizer.ts).
          const sanitized = collapseWhitespaceRuns(sanitizeSvgForRasterization(text));
          if (!/<svg[\s>]/i.test(sanitized)) {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "invalid_svg",
              statusCode: 400,
            });
            res.status(400).json({ error: "File is not a valid SVG." });
            return;
          }
          storedExt = "svg";
          storedMime = EXT_TO_MIME.svg;
          storedBytes = Buffer.from(sanitized, "utf-8");
        }

        // Defense-in-depth backstop — unreachable by construction today:
        // `storedExt` is only ever set to a sniffed raster ext (png/jpg/webp)
        // or "svg", all of which are in ALLOWED_EXTENSIONS. Kept so a future
        // assignment path that introduces a new ext can't bypass the allowlist.
        if (!ALLOWED_EXTENSIONS.has(storedExt)) {
          logWarn("upload.reject", {
            requestId: getRequestId(req),
            reason: "unsupported_type",
            statusCode: 400,
          });
          res.status(400).json({ error: "Unsupported file type." });
          return;
        }

        // Original filename is metadata only; trim it to a safe display
        // length so a 64 KB filename can't bloat the sidecar JSON.
        const originalName =
          typeof file.originalname === "string" && file.originalname.length > 0
            ? file.originalname.slice(0, 255)
            : `upload.${storedExt}`;

        // Quota check + write inside the upload mutex so two parallel
        // requests can't both pass the check before either persists.
        const meta = await uploadMutex.run(async () => {
          const existing = await storage.listAssets!();
          if (existing.length >= MAX_ASSET_COUNT) {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "asset_count_limit",
              statusCode: 409,
            });
            const err = new Error("Asset count limit reached.");
            (err as Error & { status?: number }).status = 409;
            throw err;
          }
          const totalBytes = existing.reduce((acc, m) => acc + (m.size ?? 0), 0);
          if (totalBytes + storedBytes.length > MAX_ASSETS_TOTAL_BYTES) {
            logWarn("upload.reject", {
              requestId: getRequestId(req),
              reason: "asset_storage_quota",
              statusCode: 409,
            });
            const err = new Error("Asset storage quota exceeded.");
            (err as Error & { status?: number }).status = 409;
            throw err;
          }
          return storage.saveAsset!(originalName, storedBytes, storedMime, storedExt);
        });

        res.status(201).json(meta);
      } catch (err) {
        const status = (err as Error & { status?: number }).status ?? 500;
        const msg = (err as Error).message;
        if (status >= 500) {
          logError("storage.error", {
            requestId: getRequestId(req),
            component: "assets",
            operation: "upload",
            error: err,
          });
        }
        // Generic message on 5xx; the quota errors above carry safe text.
        res.status(status).json({ error: status >= 500 ? "Upload failed." : msg });
      }
    },
  );

  // ── GET /api/assets — list ─────────────────────────────────

  app.get("/api/assets", async (_req: Request, res: Response) => {
    try {
      const list = await storage.listAssets!();
      res.json(list);
    } catch (err) {
      logError("storage.error", { component: "assets", operation: "list_route", error: err });
      res.status(500).json({ error: "Failed to list assets." });
    }
  });

  // ── DELETE /api/assets/:filename ──────────────────────────

  app.delete("/api/assets/:filename", mutationLimiter, async (req: Request, res: Response) => {
    const parsed = assetFilenameSchema.safeParse(req.params.filename);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid asset filename." });
      return;
    }
    try {
      const removed = await storage.deleteAsset!(parsed.data);
      if (!removed) {
        res.status(404).json({ error: "Asset not found." });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      logError("storage.error", {
        requestId: getRequestId(req),
        component: "assets",
        operation: "delete",
        error: err,
      });
      res.status(500).json({ error: "Failed to delete asset." });
    }
  });

  // ── GET /api/assets/:filename/raw — bytes for builder ─────

  app.get("/api/assets/:filename/raw", async (req: Request, res: Response) => {
    const parsed = assetFilenameSchema.safeParse(req.params.filename);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid asset filename." });
      return;
    }
    const filename = parsed.data;
    const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
    const mime = EXT_TO_MIME[ext];
    if (!mime) {
      res.status(400).json({ error: "Unsupported file type." });
      return;
    }
    try {
      const bytes = await storage.readAsset!(filename);
      res.setHeader("Content-Type", mime);
      // Defence in depth for a sanitizer bypass: if a stored SVG is opened
      // directly in a browser on the ingress origin, these headers prevent
      // any script/resource execution. `default-src 'none'` blocks scripts
      // and external loads; `style-src 'unsafe-inline'` keeps the asset
      // visually correct on direct view. `nosniff` stops content-type
      // sniffing.
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      // SVG is the only script-capable type: force it to download rather
      // than render on direct navigation. Rasters stay inline so builder
      // thumbnails (loaded via <img>, which ignores disposition) display.
      if (ext === "svg") {
        res.setHeader("Content-Disposition", 'attachment; filename="asset.svg"');
      } else {
        // Generic disposition — never echoes user-supplied originalName,
        // so a malicious upload cannot influence response headers.
        res.setHeader("Content-Disposition", 'inline; filename="asset"');
      }
      res.setHeader("Cache-Control", "private, max-age=300");
      res.status(200).send(bytes);
    } catch {
      // Generic 404 \u2014 no path / IP / stack detail per ENGINEERING_CONSTRAINTS \u00a714.
      res.status(404).json({ error: "Asset not found." });
    }
  });
}
