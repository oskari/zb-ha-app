/**
 * widgetTransfer.js — Client-side widget file import/export helpers.
 *
 * Builds a portable JSON envelope from editor save payloads, parses imported
 * files (envelope v1 or bare runtime payload), scans asset: references, and
 * triggers browser downloads.
 */

import { ASSET_TOKEN_PREFIX } from './assetSrc.js';

export const EXPORT_VERSION = 1;

/**
 * Stored widget envelope format version this builder produces. Mirrors
 * `CURRENT_SCHEMA_VERSION` in the server's `src/core/widgetMigrations.ts`
 * (bump both together). Exported files carry it so a file written by a newer
 * add-on is refused instead of being saved under an older schema; files
 * without it (pre-versioning exports, bare payloads) are version 0, which the
 * server's migration chain accepts as-is.
 */
export const WIDGET_SCHEMA_VERSION = 1;

/**
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  const base = (name || 'widget').trim() || 'widget';
  const sanitized = base
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return sanitized || 'widget';
}

/**
 * @param {string} widgetName
 * @returns {string}
 */
export function exportFilename(widgetName) {
  return `zerrybit-widget-${sanitizeFilename(widgetName)}.json`;
}

/**
 * @param {{ runtimeJson: object, fullscreenJson: object | null }} savePayload
 * @param {string} widgetName
 */
export function buildExportEnvelope(savePayload, widgetName) {
  if (!savePayload) {
    throw new Error('No widget document to export.');
  }

  return {
    exportVersion: EXPORT_VERSION,
    schemaVersion: WIDGET_SCHEMA_VERSION,
    exportedAt: Date.now(),
    name: widgetName,
    doc: savePayload.runtimeJson,
    fullscreen: savePayload.fullscreenJson ?? null,
  };
}

/**
 * @param {unknown} payload
 * @param {string} [label]
 */
function validateRuntimePayload(payload, label = 'payload') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Invalid ${label}: expected an object.`);
  }
  if (!payload.misc || typeof payload.misc !== 'object') {
    throw new Error(`Invalid ${label}: missing misc.`);
  }
  if (!Array.isArray(payload.elements)) {
    throw new Error(`Invalid ${label}: elements must be an array.`);
  }
  if (!Array.isArray(payload.sources)) {
    throw new Error(`Invalid ${label}: sources must be an array.`);
  }
}

/**
 * @param {unknown} obj
 * @returns {boolean}
 */
function isRuntimePayload(obj) {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    'misc' in obj &&
    'elements' in obj &&
    'sources' in obj,
  );
}

/**
 * Refuse files whose widget `schemaVersion` is newer than this builder knows.
 * Missing / older versions pass: the server stamps the current version on save
 * and every older envelope is valid under the current schema (see
 * `widgetMigrations.ts`).
 *
 * @param {object} parsed
 */
function assertSupportedSchemaVersion(parsed) {
  const v = parsed.schemaVersion;
  if (v === undefined || v === null) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error('Invalid widget file: schemaVersion must be a non-negative integer.');
  }
  if (v > WIDGET_SCHEMA_VERSION) {
    throw new Error(
      `This widget file uses schema version ${v}, but this add-on supports up to `
      + `version ${WIDGET_SCHEMA_VERSION}. Update the add-on to import it.`,
    );
  }
}

/**
 * @param {unknown} obj
 * @returns {boolean}
 */
function isStoredWidgetEnvelope(obj) {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    isRuntimePayload(obj.doc),
  );
}

/**
 * Parse a widget import file. Accepts export envelope v1, a stored widget
 * envelope (`/data/widgets/<id>.json`), or a bare runtime payload.
 *
 * @param {string} text
 * @returns {{ name: string, doc: object, fullscreen: object | null }}
 */
export function parseWidgetImportFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Widget file must be a JSON object.');
  }

  if (parsed.exportVersion === EXPORT_VERSION) {
    assertSupportedSchemaVersion(parsed);
    validateRuntimePayload(parsed.doc, 'doc');
    if (parsed.fullscreen != null) {
      validateRuntimePayload(parsed.fullscreen, 'fullscreen');
    }
    return {
      name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
      doc: parsed.doc,
      fullscreen: parsed.fullscreen ?? null,
    };
  }

  if (parsed.exportVersion !== undefined) {
    throw new Error(
      `Unsupported widget export version ${String(parsed.exportVersion)}; `
      + `this add-on reads version ${EXPORT_VERSION}.`,
    );
  }

  // Stored envelope copied straight from /data/widgets — same shape as an
  // export minus exportVersion. Server-managed fields (id, updatedAt, pairing
  // IDs) are dropped; the save assigns fresh ones.
  if (isStoredWidgetEnvelope(parsed)) {
    assertSupportedSchemaVersion(parsed);
    validateRuntimePayload(parsed.doc, 'doc');
    if (parsed.fullscreen != null) {
      validateRuntimePayload(parsed.fullscreen, 'fullscreen');
    }
    const miscName = parsed.doc.misc?.name;
    const name = typeof parsed.name === 'string' && parsed.name.trim()
      ? parsed.name.trim()
      : (typeof miscName === 'string' ? miscName.trim() : '');
    return {
      name,
      doc: parsed.doc,
      fullscreen: parsed.fullscreen ?? null,
    };
  }

  if (isRuntimePayload(parsed)) {
    validateRuntimePayload(parsed);
    const miscName = parsed.misc?.name;
    return {
      name: typeof miscName === 'string' ? miscName.trim() : '',
      doc: parsed,
      fullscreen: null,
    };
  }

  throw new Error('Unrecognized widget file format.');
}

/**
 * @param {unknown} elements
 * @param {Set<string>} refs
 */
function collectFromElements(elements, refs) {
  if (!Array.isArray(elements)) return;

  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;

    if (typeof el.src === 'string' && el.src.startsWith(ASSET_TOKEN_PREFIX)) {
      const filename = el.src.slice(ASSET_TOKEN_PREFIX.length);
      if (filename) refs.add(filename);
    }

    if (el.type === 'group' && Array.isArray(el.children)) {
      collectFromElements(el.children, refs);
    }
  }
}

/**
 * Collect unique asset:<filename> references from a runtime payload.
 *
 * @param {object} payload
 * @returns {string[]}
 */
export function collectAssetRefs(payload) {
  const refs = new Set();
  if (!payload || typeof payload !== 'object') return [];

  collectFromElements(payload.elements, refs);
  return [...refs].sort();
}

/**
 * Collect asset refs from an import parse result (primary + optional fullscreen).
 *
 * @param {{ doc: object, fullscreen?: object | null }} parsed
 * @returns {string[]}
 */
export function collectAssetRefsFromImport(parsed) {
  const refs = new Set(collectAssetRefs(parsed.doc));
  if (parsed.fullscreen) {
    for (const filename of collectAssetRefs(parsed.fullscreen)) {
      refs.add(filename);
    }
  }
  return [...refs].sort();
}

/**
 * @param {string[]} assetRefs
 * @param {string[]} existingFilenames
 * @returns {string[]}
 */
export function findMissingAssets(assetRefs, existingFilenames) {
  const existing = new Set(existingFilenames);
  return assetRefs.filter((filename) => !existing.has(filename));
}

/**
 * @param {string} filename
 * @param {unknown} data
 */
export function downloadJsonFile(filename, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}
