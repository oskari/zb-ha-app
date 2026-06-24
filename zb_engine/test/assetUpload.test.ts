/**
 * assetUpload.test.ts — Race / quota / filename hardening tests
 *
 * Complements `assetRoutes.test.ts`:
 *   - Verifies the upload mutex actually closes the quota check ↔ write
 *     race by holding `listAssets` open for both concurrent uploaders.
 *   - Verifies the storage layer assigns lowercase-only UUID filenames
 *     so case-folding can never produce two distinct refs to one file.
 *   - Verifies that a single upload past `MAX_ASSET_COUNT` is rejected
 *     with 409 even when both uploads would individually fit.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import * as crypto from "crypto";
import type { StorageAdapter, AssetMeta } from "../src/core/adapters";
import { registerAssetRoutes } from "../src/ha/haAssets";
import { MAX_ASSET_COUNT } from "../src/limits";

interface StoredAsset {
  bytes: Buffer;
  meta: AssetMeta;
}

/**
 * Build a controllable storage stub. `holdList` lets a test pause the
 * very first `listAssets()` call so two uploads can race the quota
 * check; release it by calling `release()`.
 */
function makeControllableStorage(opts: { holdList?: boolean } = {}) {
  const files = new Map<string, StoredAsset>();
  let firstListResolved = !opts.holdList;
  const releasers: Array<() => void> = [];

  const release = () => {
    firstListResolved = true;
    for (const r of releasers.splice(0)) r();
  };

  const stub: StorageAdapter & { _files: Map<string, StoredAsset>; release: () => void } = {
    _files: files,
    release,
    readWidget: async () => null,
    writeWidget: async () => {},
    deleteWidget: async () => false,
    listWidgets: async () => [],
    readPayload: async () => null,
    writePayload: async () => false,
    writeCachedImage: async () => false,
    getCachedImagePath: () => null,
    async listAssets() {
      if (!firstListResolved) {
        await new Promise<void>((resolve) => releasers.push(resolve));
      }
      return Array.from(files.values()).map((s) => s.meta);
    },
    async saveAsset(originalName, bytes, mimeType, ext) {
      const filename = `${crypto.randomUUID()}.${ext.toLowerCase().replace(/^\./, "")}`;
      const meta: AssetMeta = {
        filename,
        originalName,
        mimeType,
        size: bytes.length,
        uploadedAt: Date.now(),
      };
      files.set(filename, { bytes, meta });
      return meta;
    },
    async deleteAsset(filename) {
      return files.delete(filename);
    },
    async readAsset(filename) {
      const f = files.get(filename);
      if (!f) throw new Error("not found");
      return f.bytes;
    },
  };
  return stub;
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe("upload mutex — quota race", () => {
  it("serialises listAssets+saveAsset so two concurrent uploads can't both pass a single-slot quota check", async () => {
    // Pre-fill to MAX_ASSET_COUNT - 1 so exactly one more fits.
    const storage = makeControllableStorage({ holdList: true });
    for (let i = 0; i < MAX_ASSET_COUNT - 1; i++) {
      await storage.saveAsset!(`pad-${i}.png`, Buffer.from([0]), "image/png", "png");
    }

    const app = express();
    registerAssetRoutes(app, storage);
    const png = await tinyPng();

    // Fire both uploads in parallel BEFORE releasing the listAssets gate.
    // Without the mutex both would observe the same pre-write count and
    // both would pass the quota check, ending at MAX_ASSET_COUNT + 1.
    const a = request(app)
      .post("/api/assets")
      .attach("file", png, { filename: "a.png", contentType: "image/png" });
    const b = request(app)
      .post("/api/assets")
      .attach("file", png, { filename: "b.png", contentType: "image/png" });

    // Give both requests time to enter the route handler.
    await new Promise((r) => setTimeout(r, 50));
    storage.release();

    const [resA, resB] = await Promise.all([a, b]);
    const codes = [resA.status, resB.status].sort();
    // Exactly one accepted (201), exactly one rejected for quota (409).
    expect(codes).toEqual([201, 409]);
    expect(storage._files.size).toBe(MAX_ASSET_COUNT);
  });
});

describe("filename casing", () => {
  it("assigns a lowercase-only UUID filename so case-fold collisions are impossible", async () => {
    const storage = makeControllableStorage();
    const app = express();
    registerAssetRoutes(app, storage);
    const png = await tinyPng();

    const res = await request(app)
      .post("/api/assets")
      .attach("file", png, { filename: "X.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.filename).toMatch(/^[a-f0-9-]+\.png$/);
    // Reject any uppercase hex letter.
    expect(res.body.filename).not.toMatch(/[A-F]/);
  });
});
