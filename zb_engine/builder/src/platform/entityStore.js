/**
 * entityStore.js — HA entity catalog store (platform-specific)
 *
 * Manages the background-loaded entity list and on-demand history cache.
 * Lives in platform/ because it depends on the HA Supervisor API.
 *
 * ENGINEERING_CONSTRAINTS: All HA-specific state lives here, not in core stores.
 * ENGINEERING_CONSTRAINTS: No editor-only state leaks into the payload — this store
 *             is purely transient UI context used by the entity picker.
 */

import { create } from 'zustand';
import { fetchEntities, fetchEntityHistory } from './apiClient.js';

// ── Helpers ────────────────────────────────────────────────────

/** Extract the domain portion of an entity_id (e.g. "sensor" from "sensor.temp"). */
function domainOf(entityId) {
  const dot = entityId.indexOf('.');
  return dot > 0 ? entityId.slice(0, dot) : entityId;
}

/**
 * Build lookup indexes from a flat entity array.
 * Returns { entityMap, domains } for O(1) lookups and domain-grouped browsing.
 */
function buildIndexes(entities) {
  const entityMap = {};
  const domains = {};

  for (const entity of entities) {
    const id = entity.entity_id;
    if (!id) continue;

    entityMap[id] = entity;

    const domain = domainOf(id);
    if (!domains[domain]) domains[domain] = [];
    domains[domain].push(entity);
  }

  // Sort each domain group by friendly_name or entity_id for stable ordering
  for (const list of Object.values(domains)) {
    list.sort((a, b) => {
      const nameA = a.attributes?.friendly_name || a.entity_id;
      const nameB = b.attributes?.friendly_name || b.entity_id;
      return nameA.localeCompare(nameB);
    });
  }

  return { entityMap, domains };
}

// ── Store ──────────────────────────────────────────────────────

export const useEntityStore = create((set, get) => ({
  // Catalog state
  entities: [],
  entitiesLoading: false,
  entitiesLoaded: false,
  entitiesError: null,

  // Lookup indexes (derived from entities[])
  entityMap: {},
  domains: {},

  // On-demand history cache: { [entity_id]: { data, fetchedAt } | { error, fetchedAt } }
  historyCache: {},
  // Per-entity loading flags: { [entity_id]: true }
  historyLoading: {},

  // ── Actions ────────────────────────────────────────────────

  /**
   * Fetch the full entity list from the HA server.
   * Called once on builder mount; safe to call again to refresh.
   * Non-blocking — sets loading flag, fetches in background.
   */
  async loadEntities() {
    const state = get();
    if (state.entitiesLoading) return; // Prevent duplicate fetches

    set({ entitiesLoading: true, entitiesError: null });

    try {
      const entities = await fetchEntities();
      const list = Array.isArray(entities) ? entities : [];
      const { entityMap, domains } = buildIndexes(list);

      set({
        entities: list,
        entityMap,
        domains,
        entitiesLoading: false,
        entitiesLoaded: true,
        entitiesError: null,
      });
    } catch (err) {
      set({
        entitiesLoading: false,
        entitiesLoaded: true,
        entitiesError: err.message || 'Failed to load HA entities.',
      });
    }
  },

  /**
   * Fetch history for a single entity (on-demand, not at boot).
   * Results are cached by entity_id + hoursBack. Call with force=true to refetch.
   */
  async loadEntityHistory(entityId, hoursBack = 24, force = false) {
    const state = get();
    const cacheKey = `${entityId}:${hoursBack}`;

    // Skip if already loading this entity+range
    if (state.historyLoading[cacheKey]) return;

    // Skip if already cached (unless forced refresh)
    if (!force && state.historyCache[cacheKey]?.data) return;

    set((prev) => ({
      historyLoading: { ...prev.historyLoading, [cacheKey]: true },
    }));

    try {
      const result = await fetchEntityHistory([entityId], hoursBack);
      const historyData = result[entityId] || null;

      set((prev) => ({
        historyCache: {
          ...prev.historyCache,
          [cacheKey]: { data: historyData, fetchedAt: Date.now() },
        },
        historyLoading: { ...prev.historyLoading, [cacheKey]: false },
      }));
    } catch (err) {
      set((prev) => ({
        historyCache: {
          ...prev.historyCache,
          [cacheKey]: { error: err.message, fetchedAt: Date.now() },
        },
        historyLoading: { ...prev.historyLoading, [cacheKey]: false },
      }));
    }
  },

  /** O(1) lookup of a single entity by ID. */
  getEntityById(entityId) {
    return get().entityMap[entityId] || null;
  },
}));
