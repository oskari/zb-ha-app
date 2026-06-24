/**
 * @zb/expressions — pipe syntax helpers
 *
 * Converts between expression objects and the human-readable
 * "path|op:arg:arg|op:arg" shorthand used in template interpolation
 * (`{{path|op:arg}}`) and the binding editor UI.
 */

/** Operators that take no extra args in pipe syntax (unary). */
const UNARY_PIPE_OPS = new Set(["round", "floor", "ceil", "abs", "not"]);

const EXPRESSION_OPS = [
  "+", "-", "*", "/",
  "==", "!=", ">", "<", ">=", "<=",
  "if", "and", "or", "not",
  "round", "floor", "ceil", "abs", "min", "max", "mod",
  "concat", "format", "slice", "timestamp",
] as const;

/** True if value is a binding object `{ "$": "..." }`. */
export function isBinding(value: unknown): value is { $: string; default?: unknown } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { $?: unknown }).$ === "string"
  );
}

/**
 * True if value is an expression object such as `{ "+": [...] }`. Bindings
 * are not expressions. The operator value MUST be an array — looser
 * malformed-object detection happens inside the evaluator.
 */
export function isExpression(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (isBinding(value)) return false;
  const obj = value as Record<string, unknown>;
  return EXPRESSION_OPS.some((op) => Array.isArray(obj[op]));
}

/** Get the operator key of an expression object, or null. */
export function getExpressionOp(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  return EXPRESSION_OPS.find((op) => Array.isArray(obj[op])) ?? null;
}

/**
 * Build an expression object from pipe syntax: `"path|op:arg:arg|op:arg"`.
 * Example: `"weather.temp|round|format:1"` →
 *   `{ "format": [{ "round": [{ "$": "weather.temp" }] }, 1] }`
 */
export function buildPipeExpression(content: string): Record<string, unknown> {
  const segments = content.split("|");
  const path = segments[0].trim();
  let expr: Record<string, unknown> = { $: path };

  for (let i = 1; i < segments.length; i++) {
    const parts = segments[i].trim().split(":");
    const op = parts[0].trim();
    if (!op) continue;

    const rawArgs: (string | number)[] = parts.slice(1).map((a) => {
      const trimmed = a.trim();
      const num = Number(trimmed);
      return trimmed !== "" && !Number.isNaN(num) ? num : trimmed;
    });

    if (UNARY_PIPE_OPS.has(op)) {
      expr = { [op]: [expr] };
    } else if (op === "if" && rawArgs.length >= 2) {
      expr = { if: [expr, rawArgs[0], rawArgs[1]] };
    } else if (op === "slice") {
      if (rawArgs.length >= 2) {
        expr = { slice: [expr, rawArgs[0], rawArgs[1]] };
      } else if (rawArgs.length === 1) {
        expr = { slice: [expr, 0, rawArgs[0]] };
      }
    } else if (op === "timestamp" && rawArgs.length >= 2) {
      expr = { timestamp: [expr, rawArgs[0], rawArgs[1]] };
    } else if (rawArgs.length >= 1) {
      expr = { [op]: [expr, rawArgs[0]] };
    }
  }

  return expr;
}

/** Stringify a single arg for pipe syntax. */
function pipeArg(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && val && typeof (val as { $?: unknown }).$ === "string") {
    return (val as { $: string }).$;
  }
  return String(val);
}

/**
 * Convert an expression object to pipe syntax string.
 * Returns `"path|op:arg|op:arg"` or `null` if the expression can't be composed.
 */
export function composePipeSyntax(expr: unknown): string | null {
  const ops: string[] = [];
  let current: unknown = expr;

  while (current && typeof current === "object" && !Array.isArray(current)) {
    if (isBinding(current)) {
      let pipe = (current as { $: string }).$;
      for (let i = ops.length - 1; i >= 0; i--) {
        pipe += "|" + ops[i];
      }
      return pipe;
    }

    const op = getExpressionOp(current);
    if (!op) break;
    const args = (current as Record<string, unknown>)[op];
    if (!Array.isArray(args) || args.length === 0) break;

    let segment = op;
    if (op === "if" && args.length >= 3) {
      segment += ":" + pipeArg(args[1]) + ":" + pipeArg(args[2]);
      ops.push(segment);
      current = args[0];
    } else if (op === "slice" && args.length >= 3) {
      const start = typeof args[1] === "number" ? args[1] : Number(args[1]);
      if (start === 0) {
        segment += ":" + pipeArg(args[2]);
      } else {
        segment += ":" + pipeArg(args[1]) + ":" + pipeArg(args[2]);
      }
      ops.push(segment);
      current = args[0];
    } else if (UNARY_PIPE_OPS.has(op)) {
      ops.push(segment);
      current = args[0];
    } else if (op === "timestamp" && args.length >= 3) {
      segment += ":" + pipeArg(args[1]) + ":" + pipeArg(args[2]);
      ops.push(segment);
      current = args[0];
    } else if (args.length >= 2) {
      segment += ":" + pipeArg(args[1]);
      ops.push(segment);
      current = args[0];
    } else {
      break;
    }
  }

  return null;
}
