/**
 * expressionContext.js — builder helper that constructs the runtime data
 * context consumed by `@zb/expressions` for live canvas/preview
 * evaluation.
 *
 * Returns the canonical FLAT shape (matching the server runtime):
 *   { misc, features, [sourceId]: data }
 *
 * This single helper is the only place in the builder that materializes
 * a preview context. Components MUST NOT inline `{ features, sources: {...} }`
 * objects — that nested shape was the legacy builder-only convention and
 * is no longer supported by the unified expression engine.
 *
 * Reserved source IDs (`misc`, `features`, `__proto__`, `constructor`,
 * `prototype`) are silently dropped here — payload validation rejects
 * them at save time, but live preview must not crash if a malformed
 * draft is in flight.
 */

import { createDataContext, validateContextKey } from '@zb/expressions';

/**
 * @param {Object}   args
 * @param {Array}    args.sources               Doc sources array (`[{id, ...}]`).
 * @param {Object}   args.sourceResponsesById   `{ [sourceId]: { data, ... } }` from uiStore.
 * @param {Object}   [args.features]            Resolved feature values (`features.values`).
 * @param {Object}   [args.misc]                Optional misc bag (defaults to `{}`).
 * @returns {import('@zb/expressions').DataContext}
 */
export function buildPreviewContext({ sources, sourceResponsesById, features, misc } = {}) {
  const ctx = createDataContext();
  ctx.misc = misc ?? {};
  ctx.features = features ?? {};

  if (Array.isArray(sources) && sourceResponsesById) {
    for (const source of sources) {
      const id = source?.id;
      if (typeof id !== 'string' || !id) continue;
      if (!validateContextKey(id)) continue; // skip reserved roots
      const entry = sourceResponsesById[id];
      if (entry && 'data' in entry) {
        ctx[id] = entry.data;
      }
    }
  }

  return ctx;
}
