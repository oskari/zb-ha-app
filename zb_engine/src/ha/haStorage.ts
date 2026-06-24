/**
 * haStorage.ts — Filesystem-based storage adapter for Home Assistant
 *
 * Implements StorageAdapter using the HA persistent data volume (/data/).
 * Uses writeIfChanged to prevent SD card wear — a critical concern for
 * Raspberry Pi-based HA installations.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { StorageAdapter, WidgetDoc, WidgetMeta, AssetMeta, Slot } from "../core/adapters";
import { logError, logWarn } from "../core/logger";

// ── File paths ────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = "/data";

/**
 * On-disk filenames per slot. Snake_case the fullscreen variant to mirror
 * the HTTP route names (`/image_fullscreen.png`, `/image_fullscreen.bin`)
 * served by the on-demand image port.
 */
const PAYLOAD_FILES: Record<Slot, string> = {
  primary: path.join(DATA_ROOT, "payload.json"),
  fullscreen: path.join(DATA_ROOT, "payload.fullscreen.json"),
};
const CACHE_PNG_FILES: Record<Slot, string> = {
  primary: path.join(DATA_ROOT, "image.png"),
  fullscreen: path.join(DATA_ROOT, "image_fullscreen.png"),
};
const CACHE_BIN_FILES: Record<Slot, string> = {
  primary: path.join(DATA_ROOT, "image.bin"),
  fullscreen: path.join(DATA_ROOT, "image_fullscreen.bin"),
};

const LEGACY_PAYLOAD_FILES: Record<Slot, string> = {
  primary: path.join(ROOT, "payload.json"),
  fullscreen: path.join(ROOT, "payload.fullscreen.json"),
};
const LEGACY_CACHE_PNG_FILES: Record<Slot, string> = {
  primary: path.join(ROOT, "image.png"),
  fullscreen: path.join(ROOT, "image_fullscreen.png"),
};
const LEGACY_CACHE_BIN_FILES: Record<Slot, string> = {
  primary: path.join(ROOT, "image.bin"),
  fullscreen: path.join(ROOT, "image_fullscreen.bin"),
};

/**
 * Per-user widget documents are stored in /data/widgets/ as individual JSON
 * files (one per widget). This directory lives on the HA persistent data
 * volume so widgets survive container restarts and add-on updates.
 */
const WIDGETS_DIR = "/data/widgets";

/**
 * User-uploaded image / SVG assets live alongside widgets on the HA
 * persistent data volume. Files are named `<uuid>.<ext>` (server-generated)
 * with a sibling `<uuid>.meta.json` sidecar for original-name display.
 */
const ASSETS_DIR = "/data/assets";

/**
 * Strict whitelist of allowed asset filename shapes. Used both to validate
 * incoming filenames at the route layer and to filter directory listings —
 * any other entry (sidecar, hidden file, partial write) is ignored.
 *
 * The leading character class is intentionally `[a-f0-9-]` (lowercase only)
 * because `crypto.randomUUID()` returns lowercase hex — accepting uppercase
 * would let a request smuggle in a near-duplicate filename that bypasses
 * case-sensitive equality checks elsewhere.
 */
const ASSET_FILENAME_RE = /^[a-f0-9-]+\.(svg|png|jpe?g|webp)$/;

// ── SD-card safe write ─────────────────────────────────────────

/**
 * Write a buffer to disk ONLY if it differs from the current file content.
 * Returns true if the file was actually written, false if unchanged (skipped).
 * Uses Buffer.equals() for fast binary comparison — no hashing overhead.
 */
async function writeIfChanged(filePath: string, data: Buffer): Promise<boolean> {
  try {
    const existing = await fs.promises.readFile(filePath);
    if (existing.equals(data)) return false;
  } catch {
    // File doesn't exist yet — always write
  }
  try {
    await fs.promises.writeFile(filePath, data);
  } catch (err) {
    logError("storage.error", { operation: "write", error: err });
    throw err;
  }
  return true;
}

// ── Widget file helpers ────────────────────────────────────────

/** Path to a widget's JSON file on disk. ID is already validated by widgetService. */
function widgetFilePath(id: string): string {
  return path.join(WIDGETS_DIR, `${id}.json`);
}

function compareBeforeWriteSync(filePath: string, data: Buffer): boolean {
  try {
    const existing = fs.readFileSync(filePath);
    if (existing.equals(data)) return false;
  } catch {
    // missing/unreadable destination — write below
  }
  fs.writeFileSync(filePath, data);
  return true;
}

function migrateLegacyFile(target: string, legacy: string): void {
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
  try {
    const data = fs.readFileSync(legacy);
    compareBeforeWriteSync(target, data);
  } catch (err) {
    logWarn("storage.error", { operation: "migrate_legacy_artifact", error: err });
  }
}

function legacyArtifactPath(format: "payload" | "png" | "bin", slot: Slot): string {
  if (format === "payload") return LEGACY_PAYLOAD_FILES[slot];
  if (format === "png") return LEGACY_CACHE_PNG_FILES[slot];
  return LEGACY_CACHE_BIN_FILES[slot];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── StorageAdapter implementation ──────────────────────────────

export class HaStorageAdapter implements StorageAdapter {
  constructor() {
    try {
      fs.mkdirSync(DATA_ROOT, { recursive: true });
    } catch (err) {
      logWarn("storage.error", { operation: "create_data_directory", error: err });
    }
    // Ensure the widgets directory exists at startup (non-fatal if it fails).
    try {
      fs.mkdirSync(WIDGETS_DIR, { recursive: true });
    } catch (err) {
      logWarn("storage.error", { component: "widgets", operation: "create_directory", error: err });
    }
    // Same for the user-asset directory.
    try {
      fs.mkdirSync(ASSETS_DIR, { recursive: true });
    } catch (err) {
      logWarn("storage.error", { component: "assets", operation: "create_directory", error: err });
    }

    for (const slot of ["primary", "fullscreen"] as const) {
      migrateLegacyFile(PAYLOAD_FILES[slot], LEGACY_PAYLOAD_FILES[slot]);
      migrateLegacyFile(CACHE_PNG_FILES[slot], LEGACY_CACHE_PNG_FILES[slot]);
      migrateLegacyFile(CACHE_BIN_FILES[slot], LEGACY_CACHE_BIN_FILES[slot]);
    }
  }

  async readWidget(id: string): Promise<WidgetDoc | null> {
    try {
      const raw = await fs.promises.readFile(widgetFilePath(id), "utf-8");
      return JSON.parse(raw) as WidgetDoc;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async writeWidget(widget: WidgetDoc): Promise<void> {
    const data = Buffer.from(JSON.stringify(widget, null, 2), "utf-8");
    await writeIfChanged(widgetFilePath(widget.id), data);
  }

  async deleteWidget(id: string): Promise<boolean> {
    try {
      await fs.promises.unlink(widgetFilePath(id));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async listWidgets(): Promise<WidgetMeta[]> {
    let files: string[];
    try {
      files = await fs.promises.readdir(WIDGETS_DIR);
    } catch (err) {
      logWarn("storage.error", { component: "widgets", operation: "list", error: err });
      return [];
    }

    const results: WidgetMeta[] = [];

    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            const raw = await fs.promises.readFile(path.join(WIDGETS_DIR, f), "utf-8");
            const { id, name, updatedAt } = JSON.parse(raw) as WidgetDoc;
            // Report the on-disk byte size so the widget storage quota can
            // bound aggregate disk use (see core/widgetService.ts).
            results.push({ id, name, updatedAt, size: Buffer.byteLength(raw, "utf8") });
          } catch (err) {
            // Skip corrupt/unreadable widget files — do not crash the list
            logWarn("storage.error", { component: "widgets", operation: "read_widget_meta", error: err });
          }
        }),
    );

    return results.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  async readPayload(slot: Slot = "primary"): Promise<unknown | null> {
    const filePath = await fileExists(PAYLOAD_FILES[slot])
      ? PAYLOAD_FILES[slot]
      : legacyArtifactPath("payload", slot);
    if (!(await fileExists(filePath))) return null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writePayload(data: Buffer, slot: Slot = "primary"): Promise<boolean> {
    return writeIfChanged(PAYLOAD_FILES[slot], data);
  }

  async writeCachedImage(format: "png" | "bin", data: Buffer, slot: Slot = "primary"): Promise<boolean> {
    const filePath = format === "png" ? CACHE_PNG_FILES[slot] : CACHE_BIN_FILES[slot];
    return writeIfChanged(filePath, data);
  }

  getCachedImagePath(format: "png" | "bin", slot: Slot = "primary"): string | null {
    const filePath = format === "png" ? CACHE_PNG_FILES[slot] : CACHE_BIN_FILES[slot];
    if (fs.existsSync(filePath)) return filePath;
    const legacyPath = legacyArtifactPath(format, slot);
    return fs.existsSync(legacyPath) ? legacyPath : null;
  }

  /**
   * Remove a slot's on-disk artifacts (payload JSON + cached PNG/BIN).
   *
   * No-op for `primary` — the primary slot is the widget itself, and its
   * lifecycle is owned by the widget CRUD path (`deleteWidget`). For
   * `fullscreen`, this is the cleanup hook used when a user removes the
   * companion: each missing file is treated as already-deleted, so the
   * call is fully idempotent.
   */
  async deleteSlot(slot: Slot): Promise<void> {
    if (slot === "primary") return;
    const targets = [
      PAYLOAD_FILES[slot],
      CACHE_PNG_FILES[slot],
      CACHE_BIN_FILES[slot],
      LEGACY_PAYLOAD_FILES[slot],
      LEGACY_CACHE_PNG_FILES[slot],
      LEGACY_CACHE_BIN_FILES[slot],
    ];
    await Promise.all(
      targets.map(async (p) => {
        try {
          await fs.promises.unlink(p);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }),
    );
  }

  // ── User assets ──────────────────────────────────────────────

  /**
   * Build the on-disk path for a sidecar metadata file. Filename is the
   * stored asset filename (`<uuid>.<ext>`); the sidecar shares the UUID
   * stem with `.meta.json` appended so listings can pair them by stem.
   */
  private sidecarPath(assetFilename: string): string {
    return path.join(ASSETS_DIR, `${assetFilename}.meta.json`);
  }

  async listAssets(): Promise<AssetMeta[]> {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(ASSETS_DIR);
    } catch (err) {
      logWarn("storage.error", { component: "assets", operation: "list", error: err });
      return [];
    }

    const results: AssetMeta[] = [];
    await Promise.all(
      entries
        .filter((f) => ASSET_FILENAME_RE.test(f))
        .map(async (filename) => {
          try {
            const raw = await fs.promises.readFile(this.sidecarPath(filename), "utf-8");
            const meta = JSON.parse(raw) as AssetMeta;
            // Defensive: ensure the sidecar refers to the same filename
            // we found on disk. Skip any orphan / mismatched record.
            if (meta && meta.filename === filename) {
              results.push(meta);
            }
          } catch {
            // Orphan asset (no sidecar) or corrupt sidecar — skip silently.
          }
        }),
    );

    return results.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
  }

  async saveAsset(
    originalName: string,
    bytes: Buffer,
    mimeType: string,
    ext: string,
  ): Promise<AssetMeta> {
    // Normalise extension to the same lowercase set the filename regex accepts.
    const lowerExt = ext.toLowerCase().replace(/^\./, "");
    if (!/^(svg|png|jpe?g|webp)$/.test(lowerExt)) {
      throw new Error("Unsupported asset extension.");
    }

    const filename = `${crypto.randomUUID()}.${lowerExt}`;
    const assetPath = path.join(ASSETS_DIR, filename);
    const meta: AssetMeta = {
      filename,
      originalName,
      mimeType,
      size: bytes.length,
      uploadedAt: Date.now(),
    };

    await writeIfChanged(assetPath, bytes);
    try {
      const sidecar = Buffer.from(JSON.stringify(meta, null, 2), "utf-8");
      await writeIfChanged(this.sidecarPath(filename), sidecar);
    } catch (err) {
      // Sidecar write failed — roll back the asset file so we don't leave
      // an unlistable orphan that still consumes quota.
      try {
        await fs.promises.unlink(assetPath);
      } catch {
        // ignore secondary failure
      }
      throw err;
    }

    return meta;
  }

  async deleteAsset(filename: string): Promise<boolean> {
    if (!ASSET_FILENAME_RE.test(filename)) return false;
    let removed = false;
    try {
      await fs.promises.unlink(path.join(ASSETS_DIR, filename));
      removed = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    // Best-effort sidecar removal — non-fatal so a missing sidecar can't
    // block deletion of a real asset file.
    try {
      await fs.promises.unlink(this.sidecarPath(filename));
    } catch {
      // ignore
    }
    return removed;
  }

  async readAsset(filename: string): Promise<Buffer> {
    // Three-layer defence against escaping the asset directory.
    if (!ASSET_FILENAME_RE.test(filename)) {
      throw new Error("Invalid asset filename.");
    }
    const resolved = path.resolve(ASSETS_DIR, filename);
    if (path.dirname(resolved) !== ASSETS_DIR) {
      throw new Error("Path traversal rejected.");
    }
    // realpath resolves symlinks; the prefix check ensures the final
    // target is still inside ASSETS_DIR, blocking symlink escape.
    const real = await fs.promises.realpath(resolved);
    if (real !== resolved && !real.startsWith(ASSETS_DIR + path.sep)) {
      throw new Error("Symlink escape rejected.");
    }
    return fs.promises.readFile(real);
  }
}
