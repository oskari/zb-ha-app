/**
 * dataFieldExtractor.ts — Extract named fields from raw API responses
 *
 * Per README "Data fields":
 *   Data fields extract and name specific values from the raw API response
 *   so they can be referenced cleanly in elements.
 */

import { BLOCKED_KEYS } from "@zb/expressions";

export interface DataFieldDef {
  id: string;
  name: string;
  path: string;
  type: "auto" | "number" | "string" | "boolean";
  defaultValue?: unknown;
}

/**
 * Walk a dot-path into an object.
 * Exported so other modules (e.g. graph normalizer) can reuse path walking.
 */
export function walkPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    if (BLOCKED_KEYS.has(part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Coerce a value to the expected type.
 */
function coerce(
  value: unknown,
  type: DataFieldDef["type"],
): unknown {
  if (value === undefined || value === null) return value;

  switch (type) {
    case "number": {
      const n = Number(value);
      return isNaN(n) ? undefined : n;
    }
    case "string":
      return String(value);
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1) return true;
      if (value === "false" || value === 0) return false;
      return Boolean(value);
    case "auto":
    default:
      return value;
  }
}

/**
 * Extract named data fields from a parsed API response.
 */
export function extractDataFields(
  responseData: unknown,
  fields: DataFieldDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    let value = walkPath(responseData, field.path);
    value = coerce(value, field.type);

    if (value === undefined || value === null) {
      result[field.name] =
        field.defaultValue !== undefined ? field.defaultValue : null;
    } else {
      result[field.name] = value;
    }
  }

  return result;
}

/**
 * Build a defaults-only record for when a source has failed entirely.
 */
export function extractDefaultFields(
  fields: DataFieldDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.name] =
      field.defaultValue !== undefined ? field.defaultValue : null;
  }
  return result;
}
