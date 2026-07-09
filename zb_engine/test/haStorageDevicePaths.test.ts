/**
 * haStorageDevicePaths.test.ts — Tests for the per-device path derivation
 * introduced by the multi-device storage axis (haStorage.ts).
 *
 * These tests exercise only PURE path-derivation logic and read-only
 * existence checks — never `HaStorageAdapter` itself, which hardcodes
 * `/data` (resolves outside the repo, e.g. to `C:\data` on Windows) and
 * would create real directories on the host as a constructor side effect.
 * Full read/write/migration behavior against the real data volume is a
 * manual verification step, run inside the actual add-on container where
 * `/data` is a safe, ephemeral mount.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import {
  artifactBasename,
  deviceArtifactPath,
  flatArtifactPath,
  resolveArtifactPath,
  resolveArtifactPathSync,
} from "../src/ha/haStorage";
import { DEFAULT_DEVICE_ID } from "../src/core/adapters";
import { HttpError } from "../src/errors/httpError";

const DATA_ROOT = "/data";
const DEVICES_DIR = path.join(DATA_ROOT, "devices");

describe("artifactBasename", () => {
  it("returns the primary/fullscreen payload filenames", () => {
    expect(artifactBasename("payload", "primary")).toBe("payload.json");
    expect(artifactBasename("payload", "fullscreen")).toBe("payload.fullscreen.json");
  });

  it("returns the primary/fullscreen PNG filenames", () => {
    expect(artifactBasename("png", "primary")).toBe("image.png");
    expect(artifactBasename("png", "fullscreen")).toBe("image_fullscreen.png");
  });

  it("returns the primary/fullscreen BIN filenames", () => {
    expect(artifactBasename("bin", "primary")).toBe("image.bin");
    expect(artifactBasename("bin", "fullscreen")).toBe("image_fullscreen.bin");
  });
});

describe("deviceArtifactPath", () => {
  it("nests the artifact under devices/<deviceId>/", () => {
    expect(deviceArtifactPath("mydevice", "payload", "primary")).toBe(
      path.join(DEVICES_DIR, "mydevice", "payload.json"),
    );
  });

  it("resolves the default device to devices/default/", () => {
    expect(deviceArtifactPath(DEFAULT_DEVICE_ID, "png", "fullscreen")).toBe(
      path.join(DEVICES_DIR, "default", "image_fullscreen.png"),
    );
  });

  it("is a pure function — same inputs always produce the same path", () => {
    const a = deviceArtifactPath("stable-device", "bin", "primary");
    const b = deviceArtifactPath("stable-device", "bin", "primary");
    expect(a).toBe(b);
  });

  it("two different deviceIds produce disjoint paths for the same slot/format", () => {
    const a = deviceArtifactPath("device-a", "bin", "primary");
    const b = deviceArtifactPath("device-b", "bin", "primary");
    expect(a).not.toBe(b);
  });

  it("two different slots produce disjoint paths for the same device", () => {
    const primary = deviceArtifactPath("device-x", "payload", "primary");
    const fullscreen = deviceArtifactPath("device-x", "payload", "fullscreen");
    expect(primary).not.toBe(fullscreen);
  });

  it("rejects a malformed deviceId (path traversal) before building any path", () => {
    expect(() => deviceArtifactPath("../etc", "payload", "primary")).toThrow(HttpError);
  });

  it("rejects a malformed deviceId (uppercase / special chars)", () => {
    expect(() => deviceArtifactPath("Device One!", "payload", "primary")).toThrow(HttpError);
  });
});

describe("flatArtifactPath", () => {
  it("matches the pre-multi-device flat DATA_ROOT filenames", () => {
    expect(flatArtifactPath("payload", "primary")).toBe(path.join(DATA_ROOT, "payload.json"));
    expect(flatArtifactPath("payload", "fullscreen")).toBe(path.join(DATA_ROOT, "payload.fullscreen.json"));
    expect(flatArtifactPath("png", "primary")).toBe(path.join(DATA_ROOT, "image.png"));
    expect(flatArtifactPath("bin", "fullscreen")).toBe(path.join(DATA_ROOT, "image_fullscreen.bin"));
  });
});

describe("resolveArtifactPath / resolveArtifactPathSync — non-default devices never fall back", () => {
  // A non-default device short-circuits to its own path before any existence
  // check runs (see haStorage.ts), so these assertions are deterministic
  // regardless of what actually exists on the host's /data volume.
  it("sync resolver returns the device path unconditionally for a non-default device", () => {
    const deviceId = "brand-new-device-never-seen-before";
    const resolved = resolveArtifactPathSync(deviceId, "payload", "primary");
    expect(resolved).toBe(deviceArtifactPath(deviceId, "payload", "primary"));
  });

  it("async resolver agrees with the sync resolver for a non-default device", async () => {
    const deviceId = "another-brand-new-device";
    const sync = resolveArtifactPathSync(deviceId, "bin", "fullscreen");
    const asyncResolved = await resolveArtifactPath(deviceId, "bin", "fullscreen");
    expect(asyncResolved).toBe(sync);
  });

  it("rejects a malformed deviceId", async () => {
    expect(() => resolveArtifactPathSync("bad id", "payload", "primary")).toThrow(HttpError);
    await expect(resolveArtifactPath("bad id", "payload", "primary")).rejects.toThrow(HttpError);
  });
});
