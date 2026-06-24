/**
 * companionId.js — Workspace-only helpers for fullscreen companion doc IDs
 *
 * A widget's optional fullscreen companion is represented in `docStore`
 * as a SECOND entry under a derived ID: `<widgetId>::fullscreen`.
 *
 * Why a derived ID rather than a separate store? It lets the companion
 * round-trip through the existing focus / history / mutation path with no
 * special-casing — the only new code is here, and it's pure string
 * manipulation.
 *
 * Collision safety: widget IDs are validated server-side by
 * `WIDGET_ID_RE = /^[a-z0-9_-]+$/i`, so the literal `::` substring can
 * never occur in a real widget ID. The derived companion ID is therefore
 * guaranteed not to collide with any primary widget ID.
 *
 * Persistence boundary: the companion ID is workspace metadata only and
 * MUST NEVER appear in any payload written to the server (ENGINEERING_CONSTRAINTS
 * §9 — no editor-only state in payload). Callers serialize the companion
 * via `exportRuntimeJson(getDocById(companionId))`, which produces the
 * payload's normal `{ misc, features, sources, elements }` shape with no
 * trace of the synthetic ID.
 */

/** Suffix appended to a widget ID to derive its fullscreen companion ID. */
export const FULLSCREEN_SUFFIX = '::fullscreen';

/**
 * Derive the fullscreen companion doc ID for a given widget ID.
 * Returns `null` when `widgetId` is falsy so call sites that read the
 * focused widget ID do not need to repeat that null check.
 */
export function fullscreenIdFor(widgetId) {
  if (!widgetId || typeof widgetId !== 'string') return null;
  return `${widgetId}${FULLSCREEN_SUFFIX}`;
}

/** True iff `id` is a (syntactically valid) companion doc ID. */
export function isFullscreenId(id) {
  return typeof id === 'string' && id.endsWith(FULLSCREEN_SUFFIX) && id.length > FULLSCREEN_SUFFIX.length;
}

/**
 * Strip the companion suffix to get the underlying primary widget ID.
 * Returns the input unchanged when it is not a companion ID, so callers
 * can normalize a "maybe companion, maybe primary" id with one call.
 */
export function primaryIdOf(id) {
  if (!isFullscreenId(id)) return id;
  return id.slice(0, -FULLSCREEN_SUFFIX.length);
}
