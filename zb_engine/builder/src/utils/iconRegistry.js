/**
 * iconRegistry.js — Unified icon provider registry
 *
 * Aggregates all icon providers (Tabler, etc.) behind a single API.
 * The IconPickerModal and other consumers import from this module.
 *
 * ── Adding / removing an icon set ──────────────────────────────
 *
 * To ADD a new icon set:
 *   1. Create a provider file (see tablerCatalog.js)
 *   2. Import it below and add it to the PROVIDERS array
 *
 * To REMOVE an icon set:
 *   Follow the removal instructions in the provider's own file header,
 *   then delete its import and entry from PROVIDERS below.
 */

import tablerProvider from './tablerCatalog.js';

// ── Provider registry ────────────────────────────────────────
// Edit this array to add or remove icon sets.

/** @type {IconProvider[]} */
const PROVIDERS = [tablerProvider];

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   renderMode: 'path' | 'raw',
 *   load: () => Promise<void>,
 *   isReady: () => boolean,
 *   getCount: () => number,
 *   getVersion: () => string,
 *   search: (query: string, limit?: number) => { name: string, data: string }[],
 *   getData: (name: string) => string | null,
 *   toSvgString: (name: string) => string | null,
 * }} IconProvider
 */

// ── Public API ───────────────────────────────────────────────

/** Get all registered providers. */
export function getProviders() {
  return PROVIDERS;
}

/** Get a provider by id. */
function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Load all provider catalogs in parallel. */
export function loadAllCatalogs() {
  return Promise.all(PROVIDERS.map((p) => p.load()));
}

/** Check if all providers are ready. */
export function isAllReady() {
  return PROVIDERS.every((p) => p.isReady());
}

/**
 * Generate a complete SVG string for the draw engine.
 *
 * @param {string} providerId  Provider id (e.g. 'tabler')
 * @param {string} iconName    Icon name within that provider
 * @returns {string | null}
 */
export function toSvgString(providerId, iconName) {
  const provider = getProvider(providerId);
  return provider?.toSvgString(iconName) ?? null;
}

/**
 * Parse a qualified icon name like "tabler:sun".
 * Returns { providerId, iconName } or null if the format is invalid.
 * For backward compatibility, names without a prefix are treated as Tabler.
 */
export function parseIconRef(ref) {
  if (!ref) return null;
  const colonIdx = ref.indexOf(':');
  if (colonIdx === -1) {
    // Legacy: no prefix → assume Tabler
    return { providerId: 'tabler', iconName: ref };
  }
  return {
    providerId: ref.slice(0, colonIdx),
    iconName: ref.slice(colonIdx + 1),
  };
}

/**
 * Format a qualified icon reference string.
 */
export function formatIconRef(providerId, iconName) {
  return `${providerId}:${iconName}`;
}
