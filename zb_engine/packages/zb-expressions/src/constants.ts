/**
 * @zb/expressions — constants
 *
 * Keys blocked from path resolution to prevent prototype pollution.
 */
export const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Maximum recursion depth for binding / expression resolution. Matches the
 * security limit documented in ENGINEERING_CONSTRAINTS §10 ("EXPRESSION LIMITS").
 */
export const MAX_RESOLVE_DEPTH = 20;

/**
 * Maximum number of nodes resolved while evaluating ONE top-level value.
 *
 * The depth limit alone does not bound total work: within the depth cap a
 * value can still fan out (e.g. a `concat`/`+` with thousands of args, or
 * a doubling tree such as `{concat:[x,x]}` nested) and exhaust CPU. This
 * caps the cumulative number of resolve operations per top-level call.
 */
export const MAX_EXPRESSION_OPS = 10_000;

/**
 * Maximum length (characters) of any string produced by expression
 * evaluation — `concat` output and template interpolation. Bounds string
 * amplification independently of the operation count. Comfortably above any
 * realistic e-ink text payload (a single source response is itself capped
 * at 1 MiB upstream).
 */
export const MAX_EXPRESSION_OUTPUT_LENGTH = 1_000_000;

/**
 * Maximum number of `concat` arguments, and maximum number of `{{...}}`
 * placeholders in a single template string, permitted in one expression.
 *
 * Defense-in-depth below the 10,000 op budget: it caps the count of output
 * amplifiers so a pathological `concat`/template cannot fan out toward the
 * op budget while each argument resolves to a near-1 MB source value. Applies
 * ONLY to `concat` args and template placeholder count — never to numeric /
 * logical variadic ops (`+`, `*`, `min`, `max`, `and`, `or`).
 */
export const MAX_EXPRESSION_ARGS = 1_000;
