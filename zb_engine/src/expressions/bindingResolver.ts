/**
 * src/expressions/bindingResolver.ts — compatibility shim.
 *
 * Re-exports `resolveValue` from `@zb/expressions`. Retained because the
 * frozen `src/engine/elementResolver.ts` imports
 * `../expressions/bindingResolver` and per ENGINEERING_CONSTRAINTS §1 that
 * import cannot be edited. New code MUST import from `@zb/expressions`
 * directly.
 */
export { resolveValue } from "@zb/expressions";
