/**
 * dataFieldExtractor.test.ts — Tests for data field extraction
 *
 * Covers: walkPath traversal, type coercion, prototype pollution guard,
 * field extraction with defaults, and extractDefaultFields.
 */

import { describe, it, expect } from "vitest";
import {
  walkPath,
  extractDataFields,
  extractDefaultFields,
  DataFieldDef,
} from "../src/data/dataFieldExtractor";

// ── walkPath ───────────────────────────────────────────────────

describe("walkPath", () => {
  it("resolves a simple top-level key", () => {
    expect(walkPath({ temp: 22 }, "temp")).toBe(22);
  });

  it("resolves a nested dot-path", () => {
    expect(walkPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing intermediate keys", () => {
    expect(walkPath({ a: {} }, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when root is null", () => {
    expect(walkPath(null, "a")).toBeUndefined();
  });

  it("returns undefined when root is undefined", () => {
    expect(walkPath(undefined, "a")).toBeUndefined();
  });

  it("returns undefined for a non-object intermediate", () => {
    expect(walkPath({ a: "string" }, "a.b")).toBeUndefined();
  });

  it("blocks __proto__ traversal", () => {
    expect(walkPath({}, "__proto__")).toBeUndefined();
  });

  it("blocks constructor traversal", () => {
    expect(walkPath({}, "constructor")).toBeUndefined();
  });

  it("blocks prototype traversal", () => {
    expect(walkPath({}, "prototype")).toBeUndefined();
  });

  it("blocks __proto__ at any depth", () => {
    expect(walkPath({ a: {} }, "a.__proto__")).toBeUndefined();
  });

  it("handles numeric-keyed objects", () => {
    expect(walkPath({ "0": "zero" }, "0")).toBe("zero");
  });

  it("handles arrays via index keys", () => {
    expect(walkPath({ items: ["a", "b"] }, "items.1")).toBe("b");
  });
});

// ── coerce (via extractDataFields) ─────────────────────────────

describe("type coercion", () => {
  const data = { val: "42", flag: "true", name: 123 };

  function extract(path: string, type: DataFieldDef["type"]) {
    return extractDataFields(data, [
      { id: "f1", name: "result", path, type },
    ]).result;
  }

  it("coerces string to number", () => {
    expect(extract("val", "number")).toBe(42);
  });

  it("returns undefined for NaN coercion to number", () => {
    const res = extractDataFields({ val: "not-a-number" }, [
      { id: "f1", name: "result", path: "val", type: "number" },
    ]);
    // NaN coercion returns undefined → falls back to default (null)
    expect(res.result).toBeNull();
  });

  it("coerces number to string", () => {
    expect(extract("name", "string")).toBe("123");
  });

  it("coerces 'true' to boolean true", () => {
    expect(extract("flag", "boolean")).toBe(true);
  });

  it("coerces 'false' to boolean false", () => {
    const res = extractDataFields({ v: "false" }, [
      { id: "f1", name: "r", path: "v", type: "boolean" },
    ]);
    expect(res.r).toBe(false);
  });

  it("coerces 1 to boolean true", () => {
    const res = extractDataFields({ v: 1 }, [
      { id: "f1", name: "r", path: "v", type: "boolean" },
    ]);
    expect(res.r).toBe(true);
  });

  it("coerces 0 to boolean false", () => {
    const res = extractDataFields({ v: 0 }, [
      { id: "f1", name: "r", path: "v", type: "boolean" },
    ]);
    expect(res.r).toBe(false);
  });

  it("auto type passes through unchanged", () => {
    expect(extract("val", "auto")).toBe("42");
  });
});

// ── extractDataFields ──────────────────────────────────────────

describe("extractDataFields", () => {
  const responseData = {
    temperature: 22.5,
    status: "on",
    nested: { deep: { value: 100 } },
  };

  it("extracts multiple fields", () => {
    const fields: DataFieldDef[] = [
      { id: "f1", name: "temp", path: "temperature", type: "number" },
      { id: "f2", name: "state", path: "status", type: "string" },
    ];
    const result = extractDataFields(responseData, fields);
    expect(result).toEqual({ temp: 22.5, state: "on" });
  });

  it("uses default when path is missing", () => {
    const fields: DataFieldDef[] = [
      { id: "f1", name: "val", path: "missing.path", type: "auto", defaultValue: "N/A" },
    ];
    const result = extractDataFields(responseData, fields);
    expect(result.val).toBe("N/A");
  });

  it("uses null when path is missing and no default", () => {
    const fields: DataFieldDef[] = [
      { id: "f1", name: "val", path: "missing", type: "auto" },
    ];
    const result = extractDataFields(responseData, fields);
    expect(result.val).toBeNull();
  });

  it("resolves deeply nested paths", () => {
    const fields: DataFieldDef[] = [
      { id: "f1", name: "deep", path: "nested.deep.value", type: "number" },
    ];
    const result = extractDataFields(responseData, fields);
    expect(result.deep).toBe(100);
  });

  it("handles empty fields array", () => {
    expect(extractDataFields(responseData, [])).toEqual({});
  });
});

// ── extractDefaultFields ───────────────────────────────────────

describe("extractDefaultFields", () => {
  it("returns defaults for all fields", () => {
    const fields: DataFieldDef[] = [
      { id: "f1", name: "a", path: "x", type: "auto", defaultValue: 0 },
      { id: "f2", name: "b", path: "y", type: "auto", defaultValue: "off" },
    ];
    expect(extractDefaultFields(fields)).toEqual({ a: 0, b: "off" });
  });

  it("returns null for fields without defaults", () => {
    const fields: DataFieldDef[] = [
      { id: "f1", name: "a", path: "x", type: "auto" },
    ];
    expect(extractDefaultFields(fields)).toEqual({ a: null });
  });
});
