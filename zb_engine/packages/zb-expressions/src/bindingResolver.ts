/**
 * @zb/expressions — bindingResolver
 *
 * Recursively resolves bindings (`{ "$": "path" }`) and template strings
 * (`"... {{path|op:arg}} ..."`) against a `DataContext`. Expression
 * objects (`{ "+": [a,b] }`, etc.) are delegated to `evaluateExpression`.
 */

import type { DataContext } from "./context.js";
import { resolvePath } from "./context.js";
import { evaluateExpression } from "./expressionEvaluator.js";
import { buildPipeExpression } from "./pipeSyntax.js";
import { MAX_RESOLVE_DEPTH } from "./constants.js";
import { type EvalBudget, createBudget, chargeOp, assertOutputLength } from "./budget.js";

/**
 * Internal: full set of operator/binding keys that mark an object as an
 * expression. This is the binding key `"$"` plus every operator in
 * `pipeSyntax.ts`'s `EXPRESSION_OPS`; keep the two lists in sync so that
 * malformed-but-recognizable expressions still hit the evaluator (which
 * returns 0/false/"" rather than recursing into them as plain objects).
 */
const EXPRESSION_KEYS = new Set([
  "$", "if", "==", "!=", "+", "-", "*", "/",
  ">", "<", ">=", "<=", "and", "or", "not",
  "round", "floor", "ceil", "abs", "min", "max", "mod",
  "concat", "format", "slice", "timestamp",
]);

function isExpressionObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (EXPRESSION_KEYS.has(key)) return true;
  }
  return false;
}

/**
 * Recursively resolve all bindings and expressions in a value.
 *
 * @param value  The value to resolve (may contain bindings/expressions)
 * @param ctx    The data context to resolve against
 * @param depth  Current recursion depth (internal — callers should omit)
 * @param budget Per-resolution work budget (internal — callers should omit;
 *               a fresh budget is created for each top-level call)
 */
export function resolveValue(
  value: unknown,
  ctx: DataContext,
  depth: number = 0,
  budget: EvalBudget = createBudget(),
): unknown {
  if (depth > MAX_RESOLVE_DEPTH) {
    throw new Error(`Expression recursion depth exceeded (max ${MAX_RESOLVE_DEPTH})`);
  }
  chargeOp(budget);

  if (value === null || value === undefined) return value;

  // String template interpolation: "Hello {{source.field|round|format:1}} world"
  if (typeof value === "string") {
    if (!value.includes("{{")) return value;
    const result = value.replace(/\{\{([^}]+)\}\}/g, (_, content: string) => {
      const trimmed = content.trim();
      if (!trimmed.includes("|")) {
        const resolved = resolvePath(ctx, trimmed);
        return resolved !== undefined && resolved !== null ? String(resolved) : "";
      }
      const expr = buildPipeExpression(trimmed);
      const resolved = resolveValue(expr, ctx, depth + 1, budget);
      return resolved !== undefined && resolved !== null ? String(resolved) : "";
    });
    assertOutputLength(result.length);
    return result;
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, ctx, depth + 1, budget));
  }

  const obj = value as Record<string, unknown>;

  // Binding: { "$": "path", "default": ... }
  if ("$" in obj && typeof obj["$"] === "string") {
    const resolved = resolvePath(ctx, obj["$"]);
    if (resolved === undefined || resolved === null) {
      return "default" in obj ? obj["default"] : null;
    }
    return resolved;
  }

  // Expression: delegate to evaluator
  if (isExpressionObject(obj)) {
    return evaluateExpression(obj, ctx, depth + 1, budget);
  }

  // Plain object: recurse into values
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = resolveValue(val, ctx, depth + 1, budget);
  }
  return result;
}
