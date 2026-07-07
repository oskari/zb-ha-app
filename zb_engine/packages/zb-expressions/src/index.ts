/**
 * @zb/expressions — public API
 *
 * Single source of truth for the expression language used by both the
 * server's render pipeline and the builder's canvas preview.
 *
 * Canonical context shape:
 *   { misc, features, [sourceId]: data }
 */

export { resolveValue } from "./bindingResolver.js";
export { evaluateExpression } from "./expressionEvaluator.js";
export type { DataContext } from "./context.js";
export {
  createDataContext,
  validateContextKey,
  RESERVED_CONTEXT_ROOTS,
  resolvePath,
} from "./context.js";
export {
  isBinding,
  isExpression,
  getExpressionOp,
  buildPipeExpression,
  composePipeSyntax,
} from "./pipeSyntax.js";
export {
  BLOCKED_KEYS,
  MAX_RESOLVE_DEPTH,
  MAX_EXPRESSION_OPS,
  MAX_EXPRESSION_OUTPUT_LENGTH,
  MAX_EXPRESSION_ARGS,
} from "./constants.js";

// Builder-compatible alias: the builder's `evaluate(value, ctx)` is the
// same operation as the server's `resolveValue(value, ctx)`.
export { resolveValue as evaluate } from "./bindingResolver.js";
