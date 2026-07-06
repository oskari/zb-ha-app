/**
 * expressionBudget.test.ts — Expression operation / output budget
 *
 * The recursion-depth limit alone does not bound total work: within the
 * depth cap an expression can fan out (large/variadic ops) or amplify
 * strings. `@zb/expressions` now charges an operation budget per top-level
 * resolution and caps produced string length.
 */

import { describe, it, expect } from "vitest";
import {
  resolveValue,
  evaluateExpression,
  MAX_EXPRESSION_OPS,
  MAX_EXPRESSION_OUTPUT_LENGTH,
  MAX_EXPRESSION_ARGS,
  type DataContext,
} from "@zb/expressions";

const ctx: DataContext = { misc: {}, features: { n: 2, s: "x" } };

describe("operation budget", () => {
  it("rejects a single op with more args than the budget", () => {
    const args = Array.from({ length: MAX_EXPRESSION_OPS + 100 }, () => 1);
    expect(() => evaluateExpression({ "+": args }, ctx)).toThrow(/operation budget/i);
  });

  it("rejects a doubling-tree expression (exponential fan-out within depth)", () => {
    // {concat:[x,x]} nested — each level doubles the work; the ops budget
    // catches it well before the depth limit (20).
    let e: unknown = { $: "features.s" };
    for (let i = 0; i < 19; i++) e = { concat: [e, e] };
    expect(() => resolveValue(e, ctx)).toThrow(/operation budget/i);
  });

  it("allows a normal-sized expression", () => {
    expect(resolveValue({ "+": [1, 2, 3, { "*": [2, 2] }] }, ctx)).toBe(10);
  });

  it("budget is per top-level call (does not accumulate across calls)", () => {
    const expr = { "+": Array.from({ length: 1000 }, () => 1) };
    // Each independent call gets a fresh budget; 1000 < MAX so all succeed.
    for (let i = 0; i < 5; i++) {
      expect(evaluateExpression(expr, ctx)).toBe(1000);
    }
  });
});

describe("output length cap", () => {
  it("rejects concat output above the length cap", () => {
    const big = "a".repeat(200_000);
    // 6 * 200k = 1.2M > 1M cap.
    expect(() => evaluateExpression({ concat: [big, big, big, big, big, big] }, ctx)).toThrow(
      /output length/i,
    );
  });

  it("allows concat output under the cap", () => {
    const chunk = "ab".repeat(1000); // 2000 chars
    const out = evaluateExpression({ concat: [chunk, chunk] }, ctx);
    expect(typeof out).toBe("string");
    expect((out as string).length).toBe(4000);
  });

  it("rejects template interpolation that amplifies past the cap", () => {
    const huge = "z".repeat(MAX_EXPRESSION_OUTPUT_LENGTH + 10);
    const localCtx: DataContext = { misc: {}, features: { big: huge } };
    expect(() => resolveValue("{{features.big}}", localCtx)).toThrow(/output length/i);
  });

  it("charges output bytes cumulatively across the whole resolution (concat)", () => {
    // Two sibling concats, each 600k (< 1M individually) but summing to 1.2M.
    // Before the fix each was checked in isolation and both resolved.
    const half = "a".repeat(600_000);
    expect(() =>
      resolveValue({ a: { concat: [half] }, b: { concat: [half] } }, { misc: {}, features: {} }),
    ).toThrow(/output length/i);
  });

  it("bounds non-pipe {{path}} placeholders cumulatively", () => {
    const big = "a".repeat(600_000);
    const c: DataContext = { misc: {}, features: { big } };
    expect(() =>
      resolveValue({ a: "{{features.big}}", b: "{{features.big}}" }, c),
    ).toThrow(/output length/i);
  });

  it("rejects concat with too many arguments", () => {
    expect(() =>
      evaluateExpression({ concat: Array.from({ length: MAX_EXPRESSION_ARGS + 1 }, () => "x") }, ctx),
    ).toThrow(/argument count/i);
  });

  it("rejects a template with too many placeholders", () => {
    expect(() =>
      resolveValue("{{features.n}}".repeat(MAX_EXPRESSION_ARGS + 1), ctx),
    ).toThrow(/placeholder count/i);
  });
});

describe("depth limit still applies first", () => {
  it("throws the depth error (not the op error) on deep nesting", () => {
    let e: unknown = "deep";
    for (let i = 0; i < 25; i++) e = { if: [true, e, "fallback"] };
    expect(() => resolveValue(e, ctx)).toThrow(/recursion depth/i);
  });
});
