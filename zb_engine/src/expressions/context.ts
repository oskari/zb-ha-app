/**
 * src/expressions/context.ts — compatibility shim.
 *
 * Re-exports the canonical context API from `@zb/expressions`. Retained
 * because the frozen `src/engine/` directory imports `../expressions/context`
 * and per ENGINEERING_CONSTRAINTS §1 those imports cannot be edited. New code MUST
 * import from `@zb/expressions` directly.
 */
export type { DataContext } from "@zb/expressions";
export {
  RESERVED_CONTEXT_ROOTS,
  validateContextKey,
  createDataContext,
  resolvePath,
} from "@zb/expressions";
