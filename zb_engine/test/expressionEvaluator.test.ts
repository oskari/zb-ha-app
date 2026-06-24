/**
 * expressionEvaluator.test.ts — Tests for the expression evaluator
 *
 * Covers: math, comparison, equality, conditional (if), nesting,
 * division-by-zero safety, and malformed input handling.
 */

import { describe, it, expect } from "vitest";
import { evaluateExpression, type DataContext } from "@zb/expressions";

const ctx: DataContext = {
  misc: {},
  features: { temp: 22, label: "warm" },
};

// ── Math operators ─────────────────────────────────────────────

describe("math operators", () => {
  it("adds two numbers", () => {
    expect(evaluateExpression({ "+": [3, 4] }, ctx)).toBe(7);
  });

  it("subtracts two numbers", () => {
    expect(evaluateExpression({ "-": [10, 3] }, ctx)).toBe(7);
  });

  it("multiplies two numbers", () => {
    expect(evaluateExpression({ "*": [5, 6] }, ctx)).toBe(30);
  });

  it("divides two numbers", () => {
    expect(evaluateExpression({ "/": [10, 4] }, ctx)).toBe(2.5);
  });

  it("handles division by zero (returns 0)", () => {
    expect(evaluateExpression({ "/": [10, 0] }, ctx)).toBe(0);
  });

  it("coerces string numbers", () => {
    expect(evaluateExpression({ "+": ["3", "4"] }, ctx)).toBe(7);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(evaluateExpression({ "+": ["abc", "def"] }, ctx)).toBe(0);
  });

  it("supports variadic args (sum of N)", () => {
    expect(evaluateExpression({ "+": [1, 2, 3, 4] }, ctx)).toBe(10);
    expect(evaluateExpression({ "*": [2, 3, 4] }, ctx)).toBe(24);
  });

  it("returns 1-arg sum / single-element identity for variadic", () => {
    expect(evaluateExpression({ "+": [5] }, ctx)).toBe(5);
  });

  it("returns 0 for malformed args (not array)", () => {
    expect(evaluateExpression({ "+": "not-array" }, ctx)).toBe(0);
  });
});

// ── Equality operators ─────────────────────────────────────────

describe("equality operators", () => {
  it("== returns true for equal values", () => {
    expect(evaluateExpression({ "==": [5, 5] }, ctx)).toBe(true);
  });

  it("== returns false for unequal values", () => {
    expect(evaluateExpression({ "==": [5, 6] }, ctx)).toBe(false);
  });

  it("== uses strict equality", () => {
    expect(evaluateExpression({ "==": [5, "5"] }, ctx)).toBe(false);
  });

  it("!= returns true for unequal values", () => {
    expect(evaluateExpression({ "!=": [5, 6] }, ctx)).toBe(true);
  });

  it("!= returns false for equal values", () => {
    expect(evaluateExpression({ "!=": [5, 5] }, ctx)).toBe(false);
  });

  it("returns false for malformed == args", () => {
    expect(evaluateExpression({ "==": [1] }, ctx)).toBe(false);
  });
});

// ── Comparison operators ───────────────────────────────────────

describe("comparison operators", () => {
  it("> returns true when left > right", () => {
    expect(evaluateExpression({ ">": [10, 5] }, ctx)).toBe(true);
  });

  it("> returns false when left <= right", () => {
    expect(evaluateExpression({ ">": [5, 10] }, ctx)).toBe(false);
  });

  it("< returns true when left < right", () => {
    expect(evaluateExpression({ "<": [3, 7] }, ctx)).toBe(true);
  });

  it(">= returns true when equal", () => {
    expect(evaluateExpression({ ">=": [5, 5] }, ctx)).toBe(true);
  });

  it("<= returns true when equal", () => {
    expect(evaluateExpression({ "<=": [5, 5] }, ctx)).toBe(true);
  });
});

// ── Conditional (if) ───────────────────────────────────────────

describe("conditional (if)", () => {
  it("returns then-branch when condition is truthy", () => {
    expect(evaluateExpression({ if: [true, "yes", "no"] }, ctx)).toBe("yes");
  });

  it("returns else-branch when condition is falsy", () => {
    expect(evaluateExpression({ if: [false, "yes", "no"] }, ctx)).toBe("no");
  });

  it("returns else-branch when condition is 0", () => {
    expect(evaluateExpression({ if: [0, "yes", "no"] }, ctx)).toBe("no");
  });

  it("returns then-branch when condition is non-zero number", () => {
    expect(evaluateExpression({ if: [1, "yes", "no"] }, ctx)).toBe("yes");
  });

  it("returns null for malformed if args", () => {
    expect(evaluateExpression({ if: [true, "yes"] }, ctx)).toBe(null);
  });
});

// ── Nested expressions ─────────────────────────────────────────

describe("nested expressions", () => {
  it("resolves nested math: (3 + 4) * 2", () => {
    const expr = { "*": [{ "+": [3, 4] }, 2] };
    expect(evaluateExpression(expr, ctx)).toBe(14);
  });

  it("resolves nested conditional with comparison", () => {
    const expr = { if: [{ ">": [10, 5] }, "big", "small"] };
    expect(evaluateExpression(expr, ctx)).toBe("big");
  });
});

// ── Unknown operators ──────────────────────────────────────────

describe("unknown operators", () => {
  it("returns null for unrecognized operator", () => {
    expect(evaluateExpression({ "^": [2, 3] }, ctx)).toBe(null);
  });
});

// ── Logical operators ──────────────────────────────────────────

describe("logical operators", () => {
  it("and returns true when all truthy", () => {
    expect(evaluateExpression({ and: [true, 1, "yes"] }, ctx)).toBe(true);
  });

  it("and returns false when one falsy", () => {
    expect(evaluateExpression({ and: [true, 0, "yes"] }, ctx)).toBe(false);
  });

  it("or returns true when any truthy", () => {
    expect(evaluateExpression({ or: [false, 0, "yes"] }, ctx)).toBe(true);
  });

  it("or returns false when all falsy", () => {
    expect(evaluateExpression({ or: [false, 0, ""] }, ctx)).toBe(false);
  });

  it("not negates truthy to false", () => {
    expect(evaluateExpression({ not: [true] }, ctx)).toBe(false);
  });

  it("not negates falsy to true", () => {
    expect(evaluateExpression({ not: [0] }, ctx)).toBe(true);
  });
});

// ── Unary math operators ───────────────────────────────────────

describe("unary math operators", () => {
  it("round rounds to nearest integer", () => {
    expect(evaluateExpression({ round: [3.7] }, ctx)).toBe(4);
    expect(evaluateExpression({ round: [3.2] }, ctx)).toBe(3);
  });

  it("floor rounds down", () => {
    expect(evaluateExpression({ floor: [3.9] }, ctx)).toBe(3);
  });

  it("ceil rounds up", () => {
    expect(evaluateExpression({ ceil: [3.1] }, ctx)).toBe(4);
  });

  it("abs returns absolute value", () => {
    expect(evaluateExpression({ abs: [-5] }, ctx)).toBe(5);
    expect(evaluateExpression({ abs: [5] }, ctx)).toBe(5);
  });
});

// ── Min / Max operators ────────────────────────────────────────

describe("min/max operators", () => {
  it("min returns smallest value", () => {
    expect(evaluateExpression({ min: [5, 3, 8] }, ctx)).toBe(3);
  });

  it("max returns largest value", () => {
    expect(evaluateExpression({ max: [5, 3, 8] }, ctx)).toBe(8);
  });
});

// ── Modulo operator ────────────────────────────────────────────

describe("modulo operator", () => {
  it("mod returns remainder", () => {
    expect(evaluateExpression({ mod: [10, 3] }, ctx)).toBe(1);
  });

  it("mod returns 0 for division by zero", () => {
    expect(evaluateExpression({ mod: [10, 0] }, ctx)).toBe(0);
  });
});

// ── Concat operator ────────────────────────────────────────────

describe("concat operator", () => {
  it("concatenates strings", () => {
    expect(evaluateExpression({ concat: ["hello", " ", "world"] }, ctx)).toBe("hello world");
  });

  it("converts numbers to strings", () => {
    expect(evaluateExpression({ concat: ["temp: ", 22, "°C"] }, ctx)).toBe("temp: 22°C");
  });
});

// ── Format operator ────────────────────────────────────────────

describe("format operator", () => {
  it("formats number to decimal places", () => {
    expect(evaluateExpression({ format: [3.14159, 2] }, ctx)).toBe("3.14");
  });

  it("pads with zeros", () => {
    expect(evaluateExpression({ format: [5, 2] }, ctx)).toBe("5.00");
  });
});

// ── Chained expressions ────────────────────────────────────────

describe("chained expressions (pipeline)", () => {
  it("divide then round: 7300 / 3600 → round", () => {
    const expr = { round: [{ "/": [7300, 3600] }] };
    expect(evaluateExpression(expr, ctx)).toBe(2);
  });

  it("divide then round then add: 7300 / 3600 → round → + 1", () => {
    const expr = { "+": [{ round: [{ "/": [7300, 3600] }] }, 1] };
    expect(evaluateExpression(expr, ctx)).toBe(3);
  });

  it("multiply then format: 3.14159 * 2 → format 2 decimals", () => {
    const expr = { format: [{ "*": [3.14159, 2] }, 2] };
    expect(evaluateExpression(expr, ctx)).toBe("6.28");
  });

  it("subtract then abs then concat: 5 - 10 → abs → concat with text", () => {
    const expr = { concat: [{ abs: [{ "-": [5, 10] }] }, " units"] };
    expect(evaluateExpression(expr, ctx)).toBe("5 units");
  });
});

// ── Timestamp operator ─────────────────────────────────────────

describe("timestamp operator", () => {
  const isoInput = "2026-04-11T15:15:00Z";

  it("formats as ISO 8601", () => {
    const expr = { timestamp: [isoInput, "iso"] };
    expect(evaluateExpression(expr, ctx)).toBe("2026-04-11T15:15:00.000Z");
  });

  it("converts seconds from midnight to HH:MM:SS", () => {
    // 54900 seconds = 15h 15m 0s
    const expr = { timestamp: [54900, "seconds_from_midnight"] };
    expect(evaluateExpression(expr, ctx)).toBe("15:15:00");
  });

  it("converts to epoch seconds", () => {
    const expr = { timestamp: [isoInput, "epoch"] };
    const expected = Math.floor(new Date(isoInput).getTime() / 1000);
    expect(evaluateExpression(expr, ctx)).toBe(expected);
  });

  it("extracts time portion", () => {
    const expr = { timestamp: [isoInput, "time"] };
    expect(evaluateExpression(expr, ctx)).toBe("15:15:00");
  });

  it("extracts date portion", () => {
    const expr = { timestamp: [isoInput, "date"] };
    expect(evaluateExpression(expr, ctx)).toBe("2026-04-11");
  });

  it("returns empty string for invalid timestamp", () => {
    const expr = { timestamp: ["not-a-date", "iso"] };
    expect(evaluateExpression(expr, ctx)).toBe("");
  });

  it("handles epoch number input", () => {
    const epochSecs = Math.floor(new Date(isoInput).getTime() / 1000);
    const expr = { timestamp: [epochSecs, "time"] };
    expect(evaluateExpression(expr, ctx)).toBe("15:15:00");
  });

  it("defaults to iso when format missing", () => {
    const expr = { timestamp: [isoInput] };
    // args.length < 2, should return ""
    expect(evaluateExpression(expr, ctx)).toBe("");
  });

  it("applies positive UTC offset to time", () => {
    // 15:15 UTC + 3h offset = 18:15
    const expr = { timestamp: [isoInput, "time", 3] };
    expect(evaluateExpression(expr, ctx)).toBe("18:15:00");
  });

  it("applies negative UTC offset to time", () => {
    // 15:15 UTC - 5h offset = 10:15
    const expr = { timestamp: [isoInput, "time", -5] };
    expect(evaluateExpression(expr, ctx)).toBe("10:15:00");
  });

  it("applies UTC offset to seconds_from_midnight", () => {
    // 54900 seconds + 3h offset (10800s) = 65700s = 18:15:00
    const expr = { timestamp: [54900, "seconds_from_midnight", 3] };
    expect(evaluateExpression(expr, ctx)).toBe("18:15:00");
  });

  it("applies UTC offset to date near midnight", () => {
    // 2026-04-11T23:30:00Z + 3h = 2026-04-12T02:30 → date is 2026-04-12
    const expr = { timestamp: ["2026-04-11T23:30:00Z", "date", 3] };
    expect(evaluateExpression(expr, ctx)).toBe("2026-04-12");
  });

  it("does not apply UTC offset to epoch", () => {
    // Epoch is timezone-agnostic — offset must be ignored
    const withOffset = { timestamp: [isoInput, "epoch", 3] };
    const withoutOffset = { timestamp: [isoInput, "epoch"] };
    expect(evaluateExpression(withOffset, ctx)).toBe(evaluateExpression(withoutOffset, ctx));
  });

  it("does not apply UTC offset to iso", () => {
    const withOffset = { timestamp: [isoInput, "iso", 3] };
    const withoutOffset = { timestamp: [isoInput, "iso"] };
    expect(evaluateExpression(withOffset, ctx)).toBe(evaluateExpression(withoutOffset, ctx));
  });

  it("supports fractional UTC offset", () => {
    // 15:15 UTC + 5.5h (India) = 20:45
    const expr = { timestamp: [isoInput, "time", 5.5] };
    expect(evaluateExpression(expr, ctx)).toBe("20:45:00");
  });

  it("defaults offset to 0 when omitted", () => {
    const withZero = { timestamp: [isoInput, "time", 0] };
    const omitted = { timestamp: [isoInput, "time"] };
    expect(evaluateExpression(withZero, ctx)).toBe(evaluateExpression(omitted, ctx));
  });
});
