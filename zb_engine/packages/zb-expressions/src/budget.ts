/**
 * @zb/expressions — evaluation budget
 *
 * A small mutable accumulator threaded through `resolveValue` /
 * `evaluateExpression` for the duration of ONE top-level resolution. It
 * bounds total work (operation count) and output size so a structurally
 * valid but pathological expression cannot exhaust CPU or memory even
 * within the recursion-depth limit.
 */

import { MAX_EXPRESSION_OPS, MAX_EXPRESSION_OUTPUT_LENGTH } from "./constants.js";

export interface EvalBudget {
  /** Number of resolve operations charged so far this top-level evaluation. */
  ops: number;
}

/** Create a fresh budget for a top-level resolution. */
export function createBudget(): EvalBudget {
  return { ops: 0 };
}

/**
 * Charge one operation against the budget. Throws once the cumulative
 * operation count exceeds `MAX_EXPRESSION_OPS`.
 */
export function chargeOp(budget: EvalBudget): void {
  if (++budget.ops > MAX_EXPRESSION_OPS) {
    throw new Error(`Expression operation budget exceeded (max ${MAX_EXPRESSION_OPS} operations)`);
  }
}

/**
 * Assert that a produced string stays within `MAX_EXPRESSION_OUTPUT_LENGTH`.
 * Throws otherwise — used after building `concat` / template-interpolation
 * output.
 */
export function assertOutputLength(length: number): void {
  if (length > MAX_EXPRESSION_OUTPUT_LENGTH) {
    throw new Error(
      `Expression output length exceeded (max ${MAX_EXPRESSION_OUTPUT_LENGTH} characters)`,
    );
  }
}
