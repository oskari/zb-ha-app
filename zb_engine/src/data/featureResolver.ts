/**
 * featureResolver.ts — Resolve features → flat context
 *
 * Per README "Phase 2 — features":
 *   A flat key-value map of user-defined variables.
 *   Evaluated BEFORE sources, so they can drive source URLs, query params, etc.
 *   Values can be strings, numbers, or booleans.
 */

import { BLOCKED_KEYS } from "@zb/expressions";

/**
 * Resolve the features object into the data context.
 *
 * Returns a null-prototype object to prevent prototype pollution.
 * Blocks prototype-poisoning keys (__proto__, constructor, prototype).
 */
export function resolveFeatures(
  features: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!features || typeof features !== "object") {
    return Object.create(null) as Record<string, unknown>;
  }

  const resolved = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(features)) {
    // Skip prototype-poisoning keys
    if (BLOCKED_KEYS.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      resolved[key] = value;
    }
  }
  return resolved;
}
