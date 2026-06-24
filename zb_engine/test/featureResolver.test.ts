/**
 * featureResolver.test.ts — Tests for feature resolution
 *
 * Covers: valid types pass through, non-scalar types filtered out,
 * null/undefined input, empty objects.
 */

import { describe, it, expect } from "vitest";
import { resolveFeatures } from "../src/data/featureResolver";

describe("resolveFeatures", () => {
  it("passes through strings, numbers, and booleans", () => {
    const features = { name: "test", count: 42, active: true };
    expect(resolveFeatures(features)).toEqual(features);
  });

  it("filters out objects", () => {
    const result = resolveFeatures({ a: 1, b: { nested: true } });
    expect(result).toEqual({ a: 1 });
  });

  it("filters out arrays", () => {
    const result = resolveFeatures({ a: "ok", b: [1, 2] });
    expect(result).toEqual({ a: "ok" });
  });

  it("filters out null and undefined values", () => {
    const result = resolveFeatures({ a: 1, b: null, c: undefined });
    expect(result).toEqual({ a: 1 });
  });

  it("filters out functions", () => {
    const result = resolveFeatures({ a: 1, b: () => {} });
    expect(result).toEqual({ a: 1 });
  });

  it("returns empty object for undefined input", () => {
    expect(resolveFeatures(undefined)).toEqual({});
  });

  it("returns empty object for null input", () => {
    expect(resolveFeatures(null as any)).toEqual({});
  });

  it("returns empty object for empty features", () => {
    expect(resolveFeatures({})).toEqual({});
  });

  it("preserves falsy but valid values (0, false, empty string)", () => {
    const features = { a: 0, b: false, c: "" };
    expect(resolveFeatures(features)).toEqual({ a: 0, b: false, c: "" });
  });
});
