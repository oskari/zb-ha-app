/**
 * ids.js — Shared ID generation utility
 *
 * Single source of truth for creating unique element/source IDs
 * in the builder. Used by docStore, mapper, and elementDefaults.
 */

/**
 * Generate a unique ID for elements and sources.
 *
 * The result is ALWAYS a valid source/context key: it starts with a letter
 * and contains only `[a-zA-Z0-9_]`. This matters because a source ID becomes
 * an expression-context root and must satisfy the server's `sourceSchema`
 * (`/^[a-zA-Z][a-zA-Z0-9_-]*$/`, src/schema/sourceSchema.ts). A bare
 * `crypto.randomUUID()` starts with a random hex char — so ~62% of the time it
 * begins with a digit, which the schema rejects with HTTP 400
 * "Invalid source config schema." at POST /render/test-source. That made the
 * canvas auto-fetch (and the manual "Test Source" button) fail for those
 * sources, so their live values never reached the Konva canvas. Hyphens are
 * stripped too so the ID is safe to use directly inside `{{id.path}}` bindings.
 *
 * Prefers `crypto.randomUUID()` (available in secure contexts on modern
 * browsers and Node 19+). Falls back to a timestamp + random string.
 *
 * @returns {string} A unique identifier string (e.g. "id_3f4a9c…").
 */
export function createId() {
  const rand =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return `id_${rand}`;
}
