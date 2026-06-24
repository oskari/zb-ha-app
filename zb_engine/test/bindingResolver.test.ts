/**
 * bindingResolver.test.ts — Tests for binding resolution + expression dispatch
 *
 * Covers: simple bindings, string templates, fallback defaults,
 * expression dispatch, recursion depth guard, nested objects/arrays,
 * and prototype pollution prevention.
 */

import { describe, it, expect } from "vitest";
import { resolveValue, type DataContext } from "@zb/expressions";

const ctx: DataContext = {
  misc: { size: { width: 800, height: 600 } },
  features: { temp: 22, label: "warm", active: true },
  weather: {
    data: {
      temperature: 18.5,
      city: "Helsinki",
      forecast: [10, 15, 20],
    },
  },
};

// ── Literal pass-through ───────────────────────────────────────

describe("literals", () => {
  it("returns string as-is", () => {
    expect(resolveValue("hello", ctx)).toBe("hello");
  });

  it("returns number as-is", () => {
    expect(resolveValue(42, ctx)).toBe(42);
  });

  it("returns boolean as-is", () => {
    expect(resolveValue(true, ctx)).toBe(true);
  });

  it("returns null as-is", () => {
    expect(resolveValue(null, ctx)).toBe(null);
  });

  it("returns undefined as-is", () => {
    expect(resolveValue(undefined, ctx)).toBe(undefined);
  });
});

// ── Simple bindings { "$": "path" } ────────────────────────────

describe("bindings", () => {
  it("resolves a simple feature path", () => {
    expect(resolveValue({ $: "features.temp" }, ctx)).toBe(22);
  });

  it("resolves a nested source path", () => {
    expect(resolveValue({ $: "weather.data.temperature" }, ctx)).toBe(18.5);
  });

  it("resolves a string value", () => {
    expect(resolveValue({ $: "weather.data.city" }, ctx)).toBe("Helsinki");
  });

  it("returns null for missing path (no default)", () => {
    expect(resolveValue({ $: "weather.data.missing" }, ctx)).toBe(null);
  });

  it("returns default when path is missing", () => {
    expect(resolveValue({ $: "weather.data.missing", default: "--" }, ctx)).toBe("--");
  });

  it("returns resolved value even when default exists", () => {
    expect(resolveValue({ $: "features.temp", default: 0 }, ctx)).toBe(22);
  });
});

// ── String template interpolation ──────────────────────────────

describe("string templates", () => {
  it("interpolates a single binding", () => {
    expect(resolveValue("Temp: {{features.temp}}°C", ctx)).toBe("Temp: 22°C");
  });

  it("interpolates multiple bindings", () => {
    expect(resolveValue("{{weather.data.city}}: {{features.temp}}°C", ctx)).toBe(
      "Helsinki: 22°C",
    );
  });

  it("replaces missing bindings with empty string", () => {
    expect(resolveValue("Val: {{features.missing}}", ctx)).toBe("Val: ");
  });

  it("returns plain string when no templates present", () => {
    expect(resolveValue("no templates here", ctx)).toBe("no templates here");
  });

  it("interpolates timestamp pipe with UTC offset", () => {
    const ctxWithTs: DataContext = {
      ...ctx,
      api: { updated: "2026-04-11T15:15:00Z" },
    };
    // pipe syntax: path|timestamp:format:offset
    expect(resolveValue("Updated: {{api.updated|timestamp:time:3}}", ctxWithTs)).toBe(
      "Updated: 18:15:00",
    );
  });
});

// ── Expression dispatch ────────────────────────────────────────

describe("expression dispatch", () => {
  it("evaluates a math expression", () => {
    expect(resolveValue({ "+": [10, 5] }, ctx)).toBe(15);
  });

  it("evaluates a conditional expression", () => {
    expect(resolveValue({ if: [true, "yes", "no"] }, ctx)).toBe("yes");
  });

  it("resolves bindings inside expressions", () => {
    expect(resolveValue({ "+": [{ $: "features.temp" }, 5] }, ctx)).toBe(27);
  });

  it("routes != operator to evaluator", () => {
    expect(resolveValue({ "!=": [5, 10] }, ctx)).toBe(true);
  });

  it("routes > operator to evaluator", () => {
    expect(resolveValue({ ">": [10, 5] }, ctx)).toBe(true);
  });

  it("routes < operator to evaluator", () => {
    expect(resolveValue({ "<": [3, 7] }, ctx)).toBe(true);
  });

  it("routes >= operator to evaluator", () => {
    expect(resolveValue({ ">=": [5, 5] }, ctx)).toBe(true);
  });

  it("routes <= operator to evaluator", () => {
    expect(resolveValue({ "<=": [5, 5] }, ctx)).toBe(true);
  });

  it("routes and operator to evaluator", () => {
    expect(resolveValue({ and: [true, 1] }, ctx)).toBe(true);
    expect(resolveValue({ and: [true, 0] }, ctx)).toBe(false);
  });

  it("routes or operator to evaluator", () => {
    expect(resolveValue({ or: [false, 1] }, ctx)).toBe(true);
  });

  it("routes not operator to evaluator", () => {
    expect(resolveValue({ not: [true] }, ctx)).toBe(false);
  });

  it("routes round operator to evaluator", () => {
    expect(resolveValue({ round: [3.7] }, ctx)).toBe(4);
  });

  it("routes concat operator to evaluator", () => {
    expect(resolveValue({ concat: ["a", "b"] }, ctx)).toBe("ab");
  });

  it("routes format operator to evaluator", () => {
    expect(resolveValue({ format: [3.14159, 2] }, ctx)).toBe("3.14");
  });

  it("routes timestamp operator with UTC offset", () => {
    // 15:15 UTC + 3h = 18:15
    const expr = { timestamp: ["2026-04-11T15:15:00Z", "time", 3] };
    expect(resolveValue(expr, ctx)).toBe("18:15:00");
  });

  it("resolves timestamp with binding and offset", () => {
    const ctxWithTs: DataContext = {
      ...ctx,
      api: { updated: "2026-04-11T15:15:00Z" },
    };
    const expr = { timestamp: [{ $: "api.updated" }, "time", 3] };
    expect(resolveValue(expr, ctxWithTs)).toBe("18:15:00");
  });

  it("evaluates a chained pipeline: binding / 3600 → round → + 1", () => {
    const ctxWithSeconds: DataContext = {
      ...ctx,
      mySource: { seconds: 7300 },
    };
    const expr = { "+": [{ round: [{ "/": [{ $: "mySource.seconds" }, 3600] }] }, 1] };
    expect(resolveValue(expr, ctxWithSeconds)).toBe(3);
  });
});

// ── Recursion depth guard ──────────────────────────────────────

describe("recursion depth", () => {
  it("throws when exceeding max depth (20)", () => {
    // Build a deeply nested expression: { "+": [{ "+": [ ... ] }, 1] }
    let expr: unknown = 1;
    for (let i = 0; i < 25; i++) {
      expr = { "+": [expr, 1] };
    }
    expect(() => resolveValue(expr, ctx)).toThrow("recursion depth exceeded");
  });

  // §4.5 — Additional recursion depth bomb tests
  it("succeeds at exactly 19 levels of nesting (under max of 20)", () => {
    let expr: unknown = 1;
    for (let i = 0; i < 19; i++) {
      expr = { "+": [expr, 1] };
    }
    // Should not throw — 19 levels is within the 20-depth limit
    expect(resolveValue(expr, ctx)).toBe(20);
  });

  it("throws on deeply nested conditional expressions", () => {
    // Different expression type to ensure depth guard isn't operator-specific
    let expr: unknown = 1;
    for (let i = 0; i < 25; i++) {
      expr = { if: [true, expr, 0] };
    }
    expect(() => resolveValue(expr, ctx)).toThrow("recursion depth exceeded");
  });

  it("does not cause stack overflow even with extreme nesting", () => {
    let expr: unknown = 1;
    for (let i = 0; i < 100; i++) {
      expr = { "+": [expr, 1] };
    }
    // Should throw the depth guard error, not a RangeError/stack overflow
    expect(() => resolveValue(expr, ctx)).toThrow("recursion depth exceeded");
  });
});

// ── Nested object resolution ───────────────────────────────────

describe("nested objects", () => {
  it("resolves bindings inside plain objects", () => {
    const input = { x: { $: "features.temp" }, y: 100 };
    expect(resolveValue(input, ctx)).toEqual({ x: 22, y: 100 });
  });

  it("resolves bindings inside arrays", () => {
    const input = [{ $: "features.temp" }, "static", { $: "features.label" }];
    expect(resolveValue(input, ctx)).toEqual([22, "static", "warm"]);
  });
});

// ── Prototype pollution prevention ─────────────────────────────

describe("prototype pollution prevention", () => {
  it("blocks __proto__ traversal", () => {
    expect(resolveValue({ $: "__proto__.polluted" }, ctx)).toBe(null);
  });

  it("blocks constructor traversal", () => {
    expect(resolveValue({ $: "constructor.prototype" }, ctx)).toBe(null);
  });

  it("blocks prototype traversal", () => {
    expect(resolveValue({ $: "features.prototype" }, ctx)).toBe(null);
  });
});
