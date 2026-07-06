/**
 * sourceSecrets.ts — Source-credential masking (mask-on-read / restore-on-save)
 *
 * Out-of-engine helper (NOT under src/engine/). Implements the credential
 * masking documented in README: stored data-source secrets (bearer tokens,
 * API keys, basic-auth passwords, and sensitive header values) are replaced
 * with a sentinel when a widget/payload is read back over the panel API, and
 * restored from the persisted copy when the builder saves the sentinel back.
 *
 * Single source of truth for mask / restore / strip, imported by:
 *   - server.ts          (GET /api/widgets/:id, GET /payload — mask on read)
 *   - widgetService.ts   (PUT /api/widgets/:id — restore on save)
 *   - renderService.ts   (POST /render/expand — strip from the echoed sources)
 *
 * Everything here is pure data / JSON-safe; there are no engine imports.
 */

import type { WidgetDoc } from "./adapters";

/** Sentinel substituted for a real secret when read back over the API. */
export const SECRET_SENTINEL = "__stored__";

/**
 * Header names treated as secret-bearing. Matches the well-known auth headers
 * exactly (authorization / proxy-authorization / cookie) OR any header whose
 * name contains token / secret / password / api-key / auth.
 */
export const SENSITIVE_HEADER_NAME_RE =
  /^(?:authorization|proxy-authorization|cookie)$|token|secret|password|api[-_]?key|auth/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mask `obj[key]` to the sentinel when it currently holds a non-empty string. */
function maskField(obj: Record<string, unknown>, key: string): void {
  if (typeof obj[key] === "string" && obj[key] !== "") {
    obj[key] = SECRET_SENTINEL;
  }
}

/**
 * Mask secret fields on each source of an already-cloned sources array
 * (mutates in place). Guards non-array / non-object inputs.
 */
function maskSourcesInPlace(sources: unknown): void {
  if (!Array.isArray(sources)) return;
  for (const source of sources) {
    if (!isPlainObject(source)) continue;

    const auth = source["auth"];
    if (isPlainObject(auth)) {
      maskField(auth, "bearer");
      const apiKey = auth["apiKey"];
      if (isPlainObject(apiKey)) maskField(apiKey, "value");
      const basic = auth["basic"];
      if (isPlainObject(basic)) maskField(basic, "password");
    }

    const headers = source["headers"];
    if (isPlainObject(headers)) {
      for (const name of Object.keys(headers)) {
        if (SENSITIVE_HEADER_NAME_RE.test(name)) {
          maskField(headers, name);
        }
      }
    }
  }
}

/**
 * Return a deep clone of a payload `{ misc, features, sources, elements }`
 * with each source's secret auth fields and sensitive header values masked
 * to the sentinel. Never mutates the input.
 */
export function maskPayloadSecrets(payload: unknown): unknown {
  const clone = structuredClone(payload);
  if (isPlainObject(clone)) {
    maskSourcesInPlace(clone["sources"]);
  }
  return clone;
}

/**
 * Return a deep clone of a widget with the secrets in BOTH its primary `doc`
 * payload and its optional `fullscreen` companion masked to the sentinel.
 * Never mutates the input.
 */
export function maskWidgetSecrets(widget: WidgetDoc): WidgetDoc {
  const clone = structuredClone(widget);
  if (isPlainObject(clone.doc)) {
    maskSourcesInPlace(clone.doc["sources"]);
  }
  if (clone.fullscreen != null && isPlainObject(clone.fullscreen)) {
    maskSourcesInPlace(clone.fullscreen["sources"]);
  }
  return clone;
}

/** Restore `incomingObj[key]` from the persisted value when it holds the sentinel. */
function restoreField(
  incomingObj: Record<string, unknown>,
  persistedObj: Record<string, unknown> | undefined,
  key: string,
): void {
  // Only the literal sentinel means "keep the stored secret". A different
  // value is a newly entered secret and MUST be left untouched.
  if (incomingObj[key] !== SECRET_SENTINEL) return;
  const persistedVal = persistedObj?.[key];
  if (typeof persistedVal === "string" && persistedVal !== "") {
    incomingObj[key] = persistedVal;
  } else {
    // No persisted secret to restore — never persist the literal sentinel as
    // a credential.
    delete incomingObj[key];
  }
}

function restoreAuthSecrets(
  incomingSource: Record<string, unknown>,
  persistedSource: Record<string, unknown> | undefined,
): void {
  const incomingAuth = incomingSource["auth"];
  if (!isPlainObject(incomingAuth)) return;
  const persistedAuth =
    persistedSource && isPlainObject(persistedSource["auth"])
      ? (persistedSource["auth"] as Record<string, unknown>)
      : undefined;

  restoreField(incomingAuth, persistedAuth, "bearer");

  const incomingApiKey = incomingAuth["apiKey"];
  if (isPlainObject(incomingApiKey)) {
    const persistedApiKey =
      persistedAuth && isPlainObject(persistedAuth["apiKey"])
        ? (persistedAuth["apiKey"] as Record<string, unknown>)
        : undefined;
    restoreField(incomingApiKey, persistedApiKey, "value");
  }

  const incomingBasic = incomingAuth["basic"];
  if (isPlainObject(incomingBasic)) {
    const persistedBasic =
      persistedAuth && isPlainObject(persistedAuth["basic"])
        ? (persistedAuth["basic"] as Record<string, unknown>)
        : undefined;
    restoreField(incomingBasic, persistedBasic, "password");
  }
}

function restoreHeaderSecrets(
  incomingSource: Record<string, unknown>,
  persistedSource: Record<string, unknown> | undefined,
): void {
  const incomingHeaders = incomingSource["headers"];
  if (!isPlainObject(incomingHeaders)) return;
  const persistedHeaders =
    persistedSource && isPlainObject(persistedSource["headers"])
      ? (persistedSource["headers"] as Record<string, unknown>)
      : undefined;
  for (const name of Object.keys(incomingHeaders)) {
    if (!SENSITIVE_HEADER_NAME_RE.test(name)) continue;
    restoreField(incomingHeaders, persistedHeaders, name);
  }
}

/**
 * Restore secrets on a single payload's sources by matching source `id`
 * against the persisted payload (mutates `incoming` in place).
 *
 * Exported for the deploy paths (PUT /payload, POST /render + x-deploy), which
 * persist a client-supplied payload to `payload.json`. Because the builder
 * loads payloads via masked GET /payload, a re-deploy carries the sentinel in
 * place of every source secret; restoring from the slot's prior deployed
 * payload keeps the write from destroying the real credential or
 * authenticating with the sentinel. A sentinel with no persisted match is
 * dropped (never persisted as a literal credential).
 */
export function restorePayloadSecrets(incoming: unknown, persisted: unknown): void {
  if (!isPlainObject(incoming)) return;
  const incomingSources = incoming["sources"];
  if (!Array.isArray(incomingSources)) return;

  const persistedById = new Map<string, Record<string, unknown>>();
  const persistedSources = isPlainObject(persisted) ? persisted["sources"] : undefined;
  if (Array.isArray(persistedSources)) {
    for (const s of persistedSources) {
      if (isPlainObject(s) && typeof s["id"] === "string") {
        persistedById.set(s["id"], s);
      }
    }
  }

  for (const source of incomingSources) {
    if (!isPlainObject(source)) continue;
    const id = typeof source["id"] === "string" ? source["id"] : undefined;
    const persistedSource = id !== undefined ? persistedById.get(id) : undefined;
    restoreAuthSecrets(source, persistedSource);
    restoreHeaderSecrets(source, persistedSource);
  }
}

/**
 * Restore sentinel-masked secrets on an incoming widget from its persisted
 * copy, for BOTH the primary `doc` and the `fullscreen` companion. Mutates
 * `incoming` in place. Sources are matched by `id`; a sentinel with no
 * persisted match has its field deleted (never persisted as a credential).
 */
export function restoreWidgetSecrets(incoming: WidgetDoc, persisted: WidgetDoc): void {
  restorePayloadSecrets(incoming.doc, persisted.doc);
  restorePayloadSecrets(incoming.fullscreen, persisted.fullscreen);
}

/**
 * Return a deep-cloned sources array with `auth` and `headers` removed from
 * every source. Used for the POST /render/expand echo, which must not leak
 * credentials and (unlike widget save) has no widget id to restore against.
 * Never mutates the input.
 */
export function stripSourcesSecrets(sources: unknown): unknown {
  if (!Array.isArray(sources)) return sources;
  const clone = structuredClone(sources) as unknown[];
  for (const source of clone) {
    if (isPlainObject(source)) {
      delete source["auth"];
      delete source["headers"];
    }
  }
  return clone;
}
