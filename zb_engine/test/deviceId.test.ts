/**
 * deviceId.test.ts — Tests for the multi-device `DeviceId` axis (adapters.ts)
 *
 * Security-critical: deviceId is used in filesystem paths (multi-device-plan
 * D7). Path traversal and malformed-id attacks must be blocked before a
 * deviceId ever reaches storage.
 */

import { describe, it, expect } from "vitest";
import { assertValidDeviceId, DEFAULT_DEVICE_ID } from "../src/core/adapters";
import { HttpError } from "../src/errors/httpError";

describe("DEFAULT_DEVICE_ID", () => {
  it("is itself a valid deviceId", () => {
    expect(() => assertValidDeviceId(DEFAULT_DEVICE_ID)).not.toThrow();
  });
});

describe("assertValidDeviceId", () => {
  it("accepts alphanumeric ids", () => {
    expect(() => assertValidDeviceId("device123")).not.toThrow();
  });

  it("accepts ids with underscores and hyphens", () => {
    expect(() => assertValidDeviceId("my_device-2")).not.toThrow();
  });

  it("accepts a typical generated widget-id shape (deviceId IS the widget id)", () => {
    expect(() => assertValidDeviceId("widget_a1b2c3d4_e5f6g7")).not.toThrow();
  });

  it("rejects the empty string", () => {
    expect(() => assertValidDeviceId("")).toThrow(HttpError);
  });

  it("rejects path traversal (..)", () => {
    expect(() => assertValidDeviceId("../etc/passwd")).toThrow(HttpError);
  });

  it("rejects forward slashes", () => {
    expect(() => assertValidDeviceId("device/evil")).toThrow(HttpError);
  });

  it("rejects backslashes", () => {
    expect(() => assertValidDeviceId("device\\evil")).toThrow(HttpError);
  });

  it("rejects spaces", () => {
    expect(() => assertValidDeviceId("device name")).toThrow(HttpError);
  });

  it("rejects uppercase letters (charset is lowercase-only, unlike widget-id's case-insensitive regex)", () => {
    expect(() => assertValidDeviceId("Device1")).toThrow(HttpError);
  });

  it("rejects special characters", () => {
    expect(() => assertValidDeviceId("device@#$")).toThrow(HttpError);
  });

  it("rejects null bytes", () => {
    expect(() => assertValidDeviceId("device\0evil")).toThrow(HttpError);
  });

  it("rejects a dot-only segment", () => {
    expect(() => assertValidDeviceId(".")).toThrow(HttpError);
    expect(() => assertValidDeviceId("..")).toThrow(HttpError);
  });

  it("throws HttpError(400) with a message naming the rejected value", () => {
    try {
      assertValidDeviceId("../../etc/passwd");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).message).toContain("../../etc/passwd");
    }
  });
});
