/**
 * @zb/expressions — expressionEvaluator
 *
 * Evaluates math, comparison, logic, string, and timestamp expressions.
 * Operators are object keys whose value is an array of args. Args may be
 * literals, bindings, or nested expressions; the resolver is invoked
 * lazily for each arg so short-circuit semantics in `if` / `and` / `or`
 * still apply at the boundary defined by the operator's branch order.
 */

import type { DataContext } from "./context.js";
import { resolveValue } from "./bindingResolver.js";
import { type EvalBudget, createBudget, chargeOutput } from "./budget.js";
import { MAX_EXPRESSION_ARGS } from "./constants.js";

/** Coerce to number, treating NaN as 0. */
function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Strict-binary comparison operators: { ">": [a, b] } etc. */
const COMP_OPS: Record<string, (a: number, b: number) => boolean> = {
  ">":  (a, b) => a > b,
  "<":  (a, b) => a < b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
};

/** Strict-binary math operators: { "-": [a, b] } / { "/": [a, b] }. */
const MATH_OPS: Record<string, (a: number, b: number) => number> = {
  "-": (a, b) => a - b,
  "/": (a, b) => (b !== 0 ? a / b : 0),
};

/** Unary math operators: { "round": [n] } etc. */
const UNARY_MATH: Record<string, (n: number) => number> = {
  round: Math.round,
  floor: Math.floor,
  ceil:  Math.ceil,
  abs:   Math.abs,
};

/**
 * Evaluate a single expression object.
 *
 * @param expr   The expression object to evaluate
 * @param ctx    The data context
 * @param depth  Current recursion depth (propagated from resolveValue)
 * @param budget Per-resolution work budget (propagated from resolveValue;
 *               a fresh budget is created when called standalone)
 */
export function evaluateExpression(
  expr: Record<string, unknown>,
  ctx: DataContext,
  depth: number = 0,
  budget: EvalBudget = createBudget(),
): unknown {
  // Equality: { "==": [a, b] } / { "!=": [a, b] }
  if ("==" in expr) {
    const args = expr["=="];
    if (!Array.isArray(args) || args.length !== 2) return false;
    return resolveValue(args[0], ctx, depth, budget) === resolveValue(args[1], ctx, depth, budget);
  }
  if ("!=" in expr) {
    const args = expr["!="];
    if (!Array.isArray(args) || args.length !== 2) return false;
    return resolveValue(args[0], ctx, depth, budget) !== resolveValue(args[1], ctx, depth, budget);
  }

  // Comparison operators
  for (const [op, fn] of Object.entries(COMP_OPS)) {
    if (op in expr) {
      const args = expr[op];
      if (!Array.isArray(args) || args.length !== 2) return false;
      const a = toNumber(resolveValue(args[0], ctx, depth, budget));
      const b = toNumber(resolveValue(args[1], ctx, depth, budget));
      return fn(a, b);
    }
  }

  // If/else: { "if": [condition, then, else] }
  if ("if" in expr) {
    const args = expr["if"];
    if (!Array.isArray(args) || args.length !== 3) return null;
    const condition = resolveValue(args[0], ctx, depth, budget);
    return condition ? resolveValue(args[1], ctx, depth, budget) : resolveValue(args[2], ctx, depth, budget);
  }

  // Variadic math: { "+": [a, b, ...] } / { "*": [a, b, ...] }
  if ("+" in expr) {
    const args = expr["+"];
    if (!Array.isArray(args)) return 0;
    return args.reduce((acc: number, a) => acc + toNumber(resolveValue(a, ctx, depth, budget)), 0);
  }
  if ("*" in expr) {
    const args = expr["*"];
    if (!Array.isArray(args)) return 0;
    return args.reduce((acc: number, a) => acc * toNumber(resolveValue(a, ctx, depth, budget)), 1);
  }

  // Strict-binary math: { "-": [a, b] } / { "/": [a, b] }
  for (const [op, fn] of Object.entries(MATH_OPS)) {
    if (op in expr) {
      const args = expr[op];
      if (!Array.isArray(args) || args.length !== 2) return 0;
      const a = toNumber(resolveValue(args[0], ctx, depth, budget));
      const b = toNumber(resolveValue(args[1], ctx, depth, budget));
      return fn(a, b);
    }
  }

  // Modulo: { "mod": [a, b] }
  if ("mod" in expr) {
    const args = expr["mod"];
    if (!Array.isArray(args) || args.length !== 2) return 0;
    const a = toNumber(resolveValue(args[0], ctx, depth, budget));
    const b = toNumber(resolveValue(args[1], ctx, depth, budget));
    return b !== 0 ? a % b : 0;
  }

  // Logical AND / OR / NOT
  if ("and" in expr) {
    const args = expr["and"];
    if (!Array.isArray(args)) return false;
    return args.every((a) => !!resolveValue(a, ctx, depth, budget));
  }
  if ("or" in expr) {
    const args = expr["or"];
    if (!Array.isArray(args)) return false;
    return args.some((a) => !!resolveValue(a, ctx, depth, budget));
  }
  if ("not" in expr) {
    const args = expr["not"];
    if (!Array.isArray(args) || args.length < 1) return false;
    return !resolveValue(args[0], ctx, depth, budget);
  }

  // Unary math
  for (const [op, fn] of Object.entries(UNARY_MATH)) {
    if (op in expr) {
      const args = expr[op];
      if (!Array.isArray(args) || args.length < 1) return 0;
      return fn(toNumber(resolveValue(args[0], ctx, depth, budget)));
    }
  }

  // Min / Max
  if ("min" in expr) {
    const args = expr["min"];
    if (!Array.isArray(args) || args.length === 0) return 0;
    return Math.min(...args.map((a) => toNumber(resolveValue(a, ctx, depth, budget))));
  }
  if ("max" in expr) {
    const args = expr["max"];
    if (!Array.isArray(args) || args.length === 0) return 0;
    return Math.max(...args.map((a) => toNumber(resolveValue(a, ctx, depth, budget))));
  }

  // String concat: { "concat": [a, b, ...] }
  if ("concat" in expr) {
    const args = expr["concat"];
    if (!Array.isArray(args)) return "";
    // Cap the argument count (defense-in-depth below the op budget) so a
    // pathological concat cannot fan out toward the op limit while each arg
    // resolves to a near-1 MB value.
    if (args.length > MAX_EXPRESSION_ARGS) {
      throw new Error(
        `Expression argument count exceeded (max ${MAX_EXPRESSION_ARGS} arguments)`,
      );
    }
    // Stream: charge each resolved piece against the cumulative byte budget
    // BEFORE appending, so the giant string is never fully materialized.
    let joined = "";
    for (const a of args) {
      const v = resolveValue(a, ctx, depth, budget);
      const piece = v !== null && v !== undefined ? String(v) : "";
      chargeOutput(budget, piece.length);
      joined += piece;
    }
    return joined;
  }

  // Format: { "format": [value, decimals] }
  if ("format" in expr) {
    const args = expr["format"];
    if (!Array.isArray(args) || args.length < 2) return "";
    const val = toNumber(resolveValue(args[0], ctx, depth, budget));
    const decimals = toNumber(resolveValue(args[1], ctx, depth, budget));
    return val.toFixed(Math.max(0, Math.min(20, decimals)));
  }

  // Slice: { "slice": [value, start, end?] }
  if ("slice" in expr) {
    const args = expr["slice"];
    if (!Array.isArray(args) || args.length < 2) return "";
    const raw = resolveValue(args[0], ctx, depth, budget);
    const str = raw !== null && raw !== undefined ? String(raw) : "";
    const start = toNumber(resolveValue(args[1], ctx, depth, budget));
    const end = args.length >= 3 ? toNumber(resolveValue(args[2], ctx, depth, budget)) : undefined;
    return str.slice(start, end);
  }

  // Timestamp: { "timestamp": [value, format, utcOffset?] }
  if ("timestamp" in expr) {
    const args = expr["timestamp"];
    if (!Array.isArray(args) || args.length < 2) return "";
    const raw = resolveValue(args[0], ctx, depth, budget);
    const fmt = String(resolveValue(args[1], ctx, depth, budget) ?? "iso");
    const offsetHours = args.length >= 3 ? toNumber(resolveValue(args[2], ctx, depth, budget)) : 0;
    const dateStr = raw !== null && raw !== undefined ? String(raw) : "";
    if (dateStr === "") return "";

    if (fmt === "seconds_from_midnight") {
      const totalSeconds = toNumber(raw) + offsetHours * 3600;
      const normalized = ((totalSeconds % 86400) + 86400) % 86400;
      const h = Math.floor(normalized / 3600);
      const m = Math.floor((normalized % 3600) / 60);
      const s = Math.floor(normalized % 60);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      const epoch = Number(dateStr);
      if (!Number.isNaN(epoch)) {
        const epochDate = new Date(epoch * 1000);
        if (!Number.isNaN(epochDate.getTime())) {
          return formatTimestamp(epochDate, fmt, offsetHours);
        }
      }
      return "";
    }
    return formatTimestamp(date, fmt, offsetHours);
  }

  return null;
}

/**
 * Format a Date according to the given timestamp format mode.
 * @param date         Parsed Date (UTC internally)
 * @param fmt          Output format: iso, epoch, time, date, date_dmy
 * @param offsetHours  UTC offset in hours (e.g. 3 for UTC+3). Defaults to 0.
 */
function formatTimestamp(date: Date, fmt: string, offsetHours: number = 0): string | number {
  // For formats that extract local components, apply the UTC offset.
  // Epoch and ISO are timezone-agnostic — offset does not apply.
  const adjusted = new Date(date.getTime() + offsetHours * 3600000);

  switch (fmt) {
    case "epoch":
      return Math.floor(date.getTime() / 1000);
    case "time": {
      const hh = String(adjusted.getUTCHours()).padStart(2, "0");
      const mm = String(adjusted.getUTCMinutes()).padStart(2, "0");
      const ss = String(adjusted.getUTCSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    case "date": {
      const y = adjusted.getUTCFullYear();
      const mo = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
      const d = String(adjusted.getUTCDate()).padStart(2, "0");
      return `${y}-${mo}-${d}`;
    }
    case "date_dmy": {
      const y = adjusted.getUTCFullYear();
      const mo = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
      const d = String(adjusted.getUTCDate()).padStart(2, "0");
      return `${d}-${mo}-${y}`;
    }
    case "iso":
    default:
      return date.toISOString();
  }
}
