/**
 * sourceSchema.ts — Zod schema for source definitions + dataFields
 *
 * Per README "Phase 3 — sources" and "Source field reference".
 * Most fields support bindings, so we use z.unknown() for bindable fields
 * and validate the resolved values at runtime.
 */

import { z } from "zod";
import {
  MAX_SOURCE_TIMEOUT_MS,
  MAX_SOURCE_RETRIES,
  MAX_HA_CALENDAR_EVENTS,
  MAX_HA_CALENDAR_DAYS,
} from "../limits";

export const dataFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.enum(["auto", "number", "string", "boolean"]).default("auto"),
  defaultValue: z.unknown().optional(),
});

export const sourceAuthSchema = z.object({
  type: z.enum(["none", "apiKey", "bearer", "basic"]),
  apiKey: z
    .object({
      in: z.enum(["query", "header"]),
      name: z.string(),
      value: z.string(),
    })
    .optional(),
  bearer: z.string().optional(),
  basic: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
}).optional();

/**
 * Source ID format: starts with a letter, alphanumeric + underscore/hyphen, max 64 chars.
 * Prevents injection of special characters into context keys.
 */
const sourceIdSchema = z.string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message: "Source ID must start with a letter and contain only letters, digits, underscores, or hyphens.",
  })
  .max(64, { message: "Source ID must be 64 characters or fewer." });

// Regular HTTP source (existing, backward-compatible — kind field is optional)
export const httpSourceSchema = z.object({
  id: sourceIdSchema,
  // User-facing label shown in the builder's Sources panel. Server never reads
  // it, but it MUST be persisted: z.object() strips unknown keys, so without
  // this field every save silently drops the name and reloaded sources show as
  // "Unnamed Source" (even though the builder sent the name).
  name: z.string().max(200).optional(),
  kind: z.literal("http").optional(),
  enabled: z.unknown().default(true),
  method: z.enum(["GET", "POST"]),
  url: z.unknown(), // supports bindings
  query: z.record(z.unknown()).optional(),
  headers: z.record(z.string().max(2048)).optional().refine(
    (h) => !h || Object.keys(h).length <= 20,
    { message: "Maximum 20 custom headers allowed" },
  ),
  auth: sourceAuthSchema,
  body: z
    .object({
      type: z.enum(["json", "form", "text", "none"]).default("none"),
    })
    .passthrough()
    .optional(),
  timeoutMs: z.number().max(MAX_SOURCE_TIMEOUT_MS).default(10000),
  retries: z.number().max(MAX_SOURCE_RETRIES).default(0),
  response: z.object({
    type: z.enum(["json", "xml", "csv", "text"]),
  }),
  dataFields: z.array(dataFieldSchema).max(100).default([]),
});

// HA History source — fetches state history directly from HA Supervisor at render time.
// The engine calls the Supervisor API internally; source URLs are never involved,
// so RFC1918 restrictions do not apply.
export const haHistorySourceSchema = z.object({
  id: sourceIdSchema,
  // User-facing label (see httpSourceSchema.name) — persisted, not read by the engine.
  name: z.string().max(200).optional(),
  kind: z.literal("haHistory"),
  enabled: z.unknown().default(true),
  // The HA entity_id to retrieve history for, e.g. "sensor.living_room_temperature"
  entity_id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_-]+$/, {
    message: "entity_id must match HA format: domain.object_id (e.g. sensor.temperature)",
  }),
  // How many hours of history to fetch (1–168). The window always ends at "now".
  hoursBack: z.number().positive().max(168).default(24),
  dataFields: z.array(dataFieldSchema).max(100).default([]),
});

// HA State source — fetches the current state of a single entity from the
// HA Supervisor API.  Unlike haHistory, this returns a single snapshot
// (not a time-series), making it ideal for text labels and sensor readings.
export const haStateSourceSchema = z.object({
  id: sourceIdSchema,
  // User-facing label (see httpSourceSchema.name) — persisted, not read by the engine.
  name: z.string().max(200).optional(),
  kind: z.literal("haState"),
  enabled: z.unknown().default(true),
  // Must match HA entity_id format: "domain.object_id"
  entity_id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_-]+$/, {
    message: "entity_id must match HA format: domain.object_id (e.g. sensor.temperature)",
  }),
  // Optional: extract a specific attribute instead of the top-level state
  attribute: z.string().optional(),
  dataFields: z.array(dataFieldSchema).max(100).default([]),
});

// HA Calendar source — fetches upcoming events from a calendar.* entity via
// the Supervisor calendar.get_events service at render time.
export const haCalendarSourceSchema = z.object({
  id: sourceIdSchema,
  name: z.string().max(200).optional(),
  kind: z.literal("haCalendar"),
  enabled: z.unknown().default(true),
  entity_id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_-]+$/, {
    message: "entity_id must match HA format: domain.object_id (e.g. calendar.family)",
  }).refine((id) => id.startsWith("calendar."), {
    message: "haCalendar entity_id must be a calendar.* entity",
  }),
  daysAhead: z.number().int().min(1).max(MAX_HA_CALENDAR_DAYS).default(14),
  maxEvents: z.number().int().min(1).max(MAX_HA_CALENDAR_EVENTS).default(10),
  includeOngoing: z.unknown().default(true),
  locale: z.enum(["en", "fi"]).default("fi"),
  eventFilter: z.enum(["all", "timed", "all_day"]).default("all"),
  labelFormat: z.enum(["compact", "card"]).default("card"),
  dataFields: z.array(dataFieldSchema).max(100).default([]),
});

// Union — existing payloads without "kind" match httpSourceSchema
export const sourceSchema = z.union([
  haStateSourceSchema,
  haHistorySourceSchema,
  haCalendarSourceSchema,
  httpSourceSchema,
]);
