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
  /**
   * Cumulative number of output characters produced so far this top-level
   * evaluation (across every `concat` / template-interpolation piece). Bounds
   * total string amplification, not just any single output.
   */
  bytes: number;
}

/** Create a fresh budget for a top-level resolution. */
export function createBudget(): EvalBudget {
  return { ops: 0, bytes: 0 };
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
 * Charge `length` output characters against the cumulative byte budget.
 * Callers MUST charge each piece BEFORE appending it so an oversized string
 * is never fully materialized. Throws once the running total exceeds
 * `MAX_EXPRESSION_OUTPUT_LENGTH` (strictly greater, preserving the existing
 * boundary). The message keeps the 'output length exceeded' substring so
 * existing matchers still hold.
 */
export function chargeOutput(budget: EvalBudget, length: number): void {
  budget.bytes += length;
  if (budget.bytes > MAX_EXPRESSION_OUTPUT_LENGTH) {
    throw new Error(
      `Expression output length exceeded (max ${MAX_EXPRESSION_OUTPUT_LENGTH} characters)`,
    );
  }
}
