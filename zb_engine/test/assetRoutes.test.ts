/**
 * assetRoutes.test.ts — HTTP-level tests for the /api/assets routes, mounted
 * via registerAssetRoutes on a bare Express app with an in-memory storage stub.
 * Covers upload (PNG accept + metadata, MIME-spoof reject, <script> strip,
 * SVG/binary size caps, missing file field), EXIF stripping via sharp
 * re-encode, listing, delete (non-UUID 400 / missing 404 / removed 200), and
 * /raw (Content-Type from extension, generic disposition, SVG-as-attachment
 * CSP, malformed/missing). The asset count-quota and the concurrent-upload
 * mutex are covered in assetUpload.test.ts, not here.
 */

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import * as crypto from "crypto";
import type { StorageAdapter, AssetMeta } from "../src/core/adapters";
import { registerAssetRoutes } from "../src/ha/haAssets";
import { MAX_ASSET_SIZE_BYTES } from "../src/limits";

// ── In-memory storage stub ─────────────────────────────────────

interface StoredAsset {
  bytes: Buffer;
  meta: AssetMeta;
}

function makeStorage(): StorageAdapter & { _files: Map<string, StoredAsset> } {
  const files = new Map<string, StoredAsset>();
  const stub: StorageAdapter & { _files: Map<string, StoredAsset> } = {
    _files: files,
    // Widget-side methods are unused by the asset routes.
    readWidget: async () => null,
    writeWidget: async () => {},
    deleteWidget: async () => false,
    listWidgets: async () => [],
    readPayload: async () => null,
    writePayload: async () => false,
    writeCachedImage: async () => false,
    getCachedImagePath: () => null,
    // Asset surface
    async listAssets() {
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

function makeApp(storage: StorageAdapter) {
  const app = express();
  registerAssetRoutes(app, storage);
  return app;
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

// ── Tests ──────────────────────────────────────────────────────

describe("POST /api/assets", () => {
  it("accepts a valid PNG upload and returns 201 + metadata", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const png = await tinyPng();

    const res = await request(app)
      .post("/api/assets")
      .attach("file", png, { filename: "hello.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.filename).toMatch(/^[a-f0-9-]+\.png$/);
    expect(res.body.originalName).toBe("hello.png");
    expect(res.body.mimeType).toBe("image/png");
    expect(typeof res.body.size).toBe("number");
    expect(storage._files.size).toBe(1);
  });

  it("rejects MIME spoofing — random bytes claiming image/png get 400", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const fake = Buffer.from("this is plain text, not an image");

    const res = await request(app)
      .post("/api/assets")
      .attach("file", fake, { filename: "evil.png", contentType: "image/png" });

    // Sniff returns null → falls through to SVG path → no <svg> root → 400.
    expect(res.status).toBe(400);
    expect(storage._files.size).toBe(0);
  });

  it("strips <script> from SVG uploads", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>`;

    const res = await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from(svg, "utf-8"), {
        filename: "x.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(201);
    const stored = storage._files.get(res.body.filename)!;
    const text = stored.bytes.toString("utf-8");
    expect(text).not.toMatch(/<script/i);
    expect(text).toContain("<svg");
  });

  it("rejects an oversized SVG with 413", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const huge = `<svg xmlns="http://www.w3.org/2000/svg"><!--${"x".repeat(600_000)}--></svg>`;

    const res = await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from(huge, "utf-8"), {
        filename: "big.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(413);
    expect(storage._files.size).toBe(0);
  });

  it("rejects an oversized binary upload with 413 (multer cap)", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    // Build a buffer just over the per-file cap.
    const huge = Buffer.alloc(MAX_ASSET_SIZE_BYTES + 1024, 0xff);

    const res = await request(app)
      .post("/api/assets")
      .attach("file", huge, { filename: "big.png", contentType: "image/png" });

    expect(res.status).toBe(413);
    expect(storage._files.size).toBe(0);
  });

  it("returns 400 when no file field is present", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const res = await request(app).post("/api/assets");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/assets", () => {
  it("returns the list of stored asset metadata", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    await storage.saveAsset!("a.png", Buffer.from("AAAA"), "image/png", "png");
    await storage.saveAsset!("b.svg", Buffer.from("BBBB"), "image/svg+xml", "svg");

    const res = await request(app).get("/api/assets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty("filename");
    expect(res.body[0]).toHaveProperty("originalName");
    expect(res.body[0]).toHaveProperty("size");
  });
});

describe("DELETE /api/assets/:filename", () => {
  it("rejects a non-UUID filename with 400 (no storage call)", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const res = await request(app).delete("/api/assets/..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the asset is not found", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const fake = `${crypto.randomUUID()}.png`;
    const res = await request(app).delete(`/api/assets/${fake}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 when the asset is removed", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const meta = await storage.saveAsset!("a.png", Buffer.from("AAAA"), "image/png", "png");
    const res = await request(app).delete(`/api/assets/${meta.filename}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(storage._files.size).toBe(0);
  });
});

describe("GET /api/assets/:filename/raw", () => {
  it("returns the bytes with the correct Content-Type and a generic disposition", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const png = await tinyPng();
    const meta = await storage.saveAsset!("evil-name.png", png, "image/png", "png");

    const res = await request(app).get(`/api/assets/${meta.filename}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    // Raster stays inline (builder thumbnails); generic disposition — must
    // NOT echo the original filename.
    expect(res.headers["content-disposition"]).toBe('inline; filename="asset"');
    expect(res.headers["content-disposition"]).not.toContain("evil-name");
    expect(res.headers["cache-control"]).toContain("private");
    // P2.4: protective headers on every raw response.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("serves SVG raw as an attachment with a restrictive CSP (P2.4)", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`;
    const meta = await storage.saveAsset!("x.svg", Buffer.from(svg), "image/svg+xml", "svg");

    const res = await request(app).get(`/api/assets/${meta.filename}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    // SVG is script-capable: force download on direct navigation.
    expect(res.headers["content-disposition"]).toBe('attachment; filename="asset.svg"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("returns 400 for a malformed filename", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const res = await request(app).get("/api/assets/not-a-uuid.png/raw");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing asset", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    const fake = `${crypto.randomUUID()}.png`;
    const res = await request(app).get(`/api/assets/${fake}/raw`);
    expect(res.status).toBe(404);
  });
});

describe("EXIF / metadata stripping on raster upload", () => {
  it("re-encodes raster uploads through sharp (metadata stripped)", async () => {
    const storage = makeStorage();
    const app = makeApp(storage);
    // Build a JPEG with EXIF metadata attached. sharp's `withMetadata`
    // produces an output that includes whatever metadata is present in
    // the source; here we pretend it's a camera shot by setting an
    // orientation tag via the raw input + jpeg pipeline.
    const withExif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 100, g: 100, b: 100 } },
    })
      .withMetadata({ exif: { IFD0: { Software: "TEST-CAMERA-DO-NOT-LEAK" } } })
      .jpeg()
      .toBuffer();

    const res = await request(app)
      .post("/api/assets")
      .attach("file", withExif, { filename: "shot.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    const stored = storage._files.get(res.body.filename)!;
    const meta = await sharp(stored.bytes).metadata();
    // After re-encode, the EXIF block should be absent (sharp's .rotate()
    // strips metadata as a side effect).
    expect(meta.exif).toBeUndefined();
    // And the literal marker string must not appear anywhere in the bytes.
    expect(stored.bytes.includes(Buffer.from("TEST-CAMERA-DO-NOT-LEAK"))).toBe(false);
  });
});
