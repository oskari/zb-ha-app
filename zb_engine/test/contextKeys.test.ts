/**
 * contextKeys.test.ts — Regression tests for context key hardening
 *
 * Covers: source ID reserved-root collisions, source ID format violations,
 * duplicate source IDs, feature key poisoning rejection, and null-prototype
 * regression proof.
 */

import { describe, it, expect } from "vitest";
import { payloadSchema } from "../src/schema/payloadSchema";
import { sourceSchema } from "../src/schema/sourceSchema";
import {
  createDataContext,
  validateContextKey,
  RESERVED_CONTEXT_ROOTS,
} from "@zb/expressions";
import { resolveFeatures } from "../src/data/featureResolver";

// ── Helper: minimal valid payload ──────────────────────────────

const validPayload = {
  misc: { size: { width: 800, height: 480 } },
  features: {},
  sources: [],
  elements: [],
};

function payloadWithSources(
  sources: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...validPayload,
    sources: sources.map((s) => ({
      method: "GET",
      url: "https://example.com/data",
      response: { type: "json" },
      auth: { type: "none" },
      ...s,
    })),
  };
}

// ── Source ID format constraints (sourceSchema) ────────────────

describe("source ID format constraint", () => {
  it("accepts a valid alphanumeric ID", () => {
    const result = sourceSchema.safeParse({
      id: "mySource1",
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts ID with underscores and hyphens", () => {
    const result = sourceSchema.safeParse({
      id: "my-source_2",
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty string", () => {
    const result = sourceSchema.safeParse({
      id: "",
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ID starting with a number", () => {
    const result = sourceSchema.safeParse({
      id: "1source",
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ID with special characters", () => {
    const result = sourceSchema.safeParse({
      id: "my.source",
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ID with spaces", () => {
    const result = sourceSchema.safeParse({
      id: "my source",
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ID exceeding 64 characters", () => {
    const result = sourceSchema.safeParse({
      id: "a".repeat(65),
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts ID at exactly 64 characters", () => {
    const result = sourceSchema.safeParse({
      id: "a".repeat(64),
      method: "GET",
      url: "https://example.com",
      response: { type: "json" },
      auth: { type: "none" },
    });
    expect(result.success).toBe(true);
  });
});

// ── Reserved source ID collisions (payloadSchema) ──────────────

describe("reserved source ID collisions", () => {
  it("rejects source ID '__proto__'", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "__proto__" }]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects source ID 'constructor'", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "constructor" }]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects source ID 'prototype'", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "prototype" }]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects source ID 'misc'", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "misc" }]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects source ID 'features'", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "features" }]),
    );
    expect(result.success).toBe(false);
  });
});

// ── Duplicate source IDs (payloadSchema) ───────────────────────

describe("duplicate source IDs", () => {
  it("rejects duplicate source IDs", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "api1" }, { id: "api1" }]),
    );
    expect(result.success).toBe(false);
  });

  it("accepts unique source IDs", () => {
    const result = payloadSchema.safeParse(
      payloadWithSources([{ id: "api1" }, { id: "api2" }]),
    );
    expect(result.success).toBe(true);
  });
});

// ── Feature key poisoning (payloadSchema) ──────────────────────

describe("feature key poisoning", () => {
  it("rejects __proto__ as a feature key at the schema boundary", () => {
    // JSON.parse produces __proto__ as an own enumerable key, matching real
    // HTTP request bodies. The payloadSchema pre-record refine uses
    // hasOwnProperty to detect it before Zod's record parsing loses it.
    const parsed = JSON.parse('{"__proto__":"evil","name":"test"}');
    const result = payloadSchema.safeParse({
      ...validPayload,
      features: parsed,
    });
    expect(result.success).toBe(false);
  });

  it("also blocks __proto__ at runtime via resolveFeatures() (belt-and-suspenders)", () => {
    // Even if schema validation were bypassed, the runtime filter must block it.
    const features = Object.create(null);
    features["__proto__"] = "evil";
    features["name"] = "test";
    const result = resolveFeatures(features);
    expect(result["__proto__"]).toBeUndefined();
    expect(result["name"]).toBe("test");
  });

  it("rejects 'constructor' as a feature key", () => {
    const result = payloadSchema.safeParse({
      ...validPayload,
      features: { constructor: "evil" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects 'prototype' as a feature key", () => {
    const result = payloadSchema.safeParse({
      ...validPayload,
      features: { prototype: "evil" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts 'misc' and 'features' as feature keys (not reserved at feature level)", () => {
    const result = payloadSchema.safeParse({
      ...validPayload,
      features: { misc: "ok", features: "ok" },
    });
    expect(result.success).toBe(true);
  });
});

// ── Null-prototype regression proof ────────────────────────────

describe("null-prototype data context", () => {
  it("createDataContext() returns a null-prototype object", () => {
    const ctx = createDataContext();
    expect(Object.getPrototypeOf(ctx)).toBeNull();
  });

  it("setting '__proto__' on context does not pollute Object.prototype", () => {
    const ctx = createDataContext();
    // Directly set __proto__ as a regular property
    (ctx as Record<string, unknown>)["__proto__"] = { polluted: true };

    // Object.prototype must remain clean
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("context still has misc and features properties", () => {
    const ctx = createDataContext();
    expect(ctx.misc).toEqual({});
    expect(ctx.features).toEqual({});
  });
});

// ── resolveFeatures blocks prototype-poisoning keys ────────────

describe("resolveFeatures key blocking", () => {
  it("filters out __proto__ key", () => {
    // Use Object.create to set __proto__ as own property
    const features = Object.create(null);
    features["__proto__"] = "evil";
    features["name"] = "test";

    const result = resolveFeatures(features);
    expect(result["__proto__"]).toBeUndefined();
    expect(result["name"]).toBe("test");
  });

  it("filters out 'constructor' key", () => {
    const features = { constructor: "evil", name: "test" };
    const result = resolveFeatures(features);
    expect(result["constructor"]).toBeUndefined();
    expect(result["name"]).toBe("test");
  });

  it("filters out 'prototype' key", () => {
    const features = { prototype: "evil", name: "test" };
    const result = resolveFeatures(features);
    expect(result["prototype"]).toBeUndefined();
    expect(result["name"]).toBe("test");
  });

  it("returns a null-prototype object", () => {
    const result = resolveFeatures({ a: 1 });
    expect(Object.getPrototypeOf(result)).toBeNull();
  });
});

// ── validateContextKey helper ──────────────────────────────────

describe("validateContextKey", () => {
  it("returns false for the exact, hardcoded set of reserved roots", () => {
    // Hardcoded on purpose — NOT derived from RESERVED_CONTEXT_ROOTS. Iterating
    // the same set the implementation checks against is structurally guaranteed
    // to pass and would NOT fail if a security-critical key (e.g. __proto__)
    // were dropped from the set. These literals plus the membership assertion
    // make any add/drop break the test.
    const expected = ["misc", "features", "__proto__", "constructor", "prototype"];
    for (const key of expected) {
      expect(validateContextKey(key)).toBe(false);
    }
    expect([...RESERVED_CONTEXT_ROOTS].sort()).toEqual([...expected].sort());
  });

  it("returns true for normal source IDs", () => {
    expect(validateContextKey("api1")).toBe(true);
    expect(validateContextKey("weatherData")).toBe(true);
    expect(validateContextKey("my-source")).toBe(true);
  });
});
