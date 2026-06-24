/**
 * @zb/expressions — DataContext + path resolution
 *
 * Canonical context shape (matches the runtime payload):
 *   { misc, features, [sourceId]: data }
 *
 * Source IDs live as top-level keys alongside `misc` and `features`.
 */

import { BLOCKED_KEYS } from "./constants.js";

export interface DataContext {
  misc: Record<string, unknown>;
  features: Record<string, unknown>;
  [sourceId: string]: unknown;
}

/**
 * Reserved keys at the context root. Source IDs using these names would
 * collide with built-in context properties or enable prototype pollution.
 */
export const RESERVED_CONTEXT_ROOTS = new Set([
  "misc",
  "features",
  "__proto__",
  "constructor",
  "prototype",
]);

/** True if `key` is safe to use as a context root (source ID). */
export function validateContextKey(key: string): boolean {
  return !RESERVED_CONTEXT_ROOTS.has(key);
}

/**
 * Create an empty data context using a null-prototype object so that
 * injected context keys cannot pollute Object.prototype.
 */
export function createDataContext(): DataContext {
  const ctx = Object.create(null) as DataContext;
  ctx.misc = {};
  ctx.features = {};
  return ctx;
}

/** Resolve a dot/bracket path against the context. */
export function resolvePath(ctx: DataContext, path: string): unknown {
  const parts = parsePath(path);
  let current: unknown = ctx;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    if (BLOCKED_KEYS.has(part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Parse a path string into segments, handling dot notation and bracket
 * notation for both numeric indices (`[0]`) and quoted keys (`["@_value"]`).
 */
function parsePath(path: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === "[") {
      i++; // skip '['
      if (path[i] === '"' || path[i] === "'") {
        const quote = path[i];
        i++; // skip opening quote
        let key = "";
        while (i < path.length && path[i] !== quote) {
          if (path[i] === "\\" && i + 1 < path.length) {
            i++; // skip backslash, take next char
          }
          key += path[i];
          i++;
        }
        i++; // skip closing quote
        i++; // skip ']'
        parts.push(key);
      } else {
        let num = "";
        while (i < path.length && path[i] !== "]") {
          num += path[i];
          i++;
        }
        i++; // skip ']'
        parts.push(num);
      }
    } else if (path[i] === ".") {
      i++; // skip dot separator
    } else {
      let key = "";
      while (i < path.length && path[i] !== "." && path[i] !== "[") {
        key += path[i];
        i++;
      }
      if (key) parts.push(key);
    }
  }
  return parts;
}
