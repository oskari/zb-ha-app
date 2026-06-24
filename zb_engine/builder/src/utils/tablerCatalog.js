/**
 * tablerCatalog.js — Tabler icon provider
 *
 * Self-contained module for Tabler Icons. Lazy-loads the bundled
 * tabler-icons.json and exposes the standard icon-provider interface
 * used by iconRegistry.js.
 *
 * Tabler icons are stroke-based (outline) with some filled variants.
 * Each icon entry contains:
 *   d  — inner SVG content (the drawable paths/shapes)
 *   t  — tag array for search (e.g. ["accept","yes","tick","done"])
 *
 * search() uses ranked matching: exact/partial name matches rank above
 * tag-only matches, so typing "check" shows check-related icons before
 * unrelated icons that merely have "check" as a synonym tag.
 *
 * To remove Tabler from the project:
 *   1. Delete this file
 *   2. Delete builder/src/data/tabler-icons.json
 *   3. Delete builder/scripts/generate-tabler-icons.js
 *   4. Remove the import line in iconRegistry.js
 *   5. Remove @tabler/icons from builder/package.json devDependencies
 */

/**
 * @typedef {{ d: string, t: string[] }} TablerEntry
 * @type {{ version: string, count: number, icons: Record<string, TablerEntry> } | null}
 */
let catalog = null;

/** @type {Promise<void> | null} */
let loadPromise = null;

/** @type {import('./iconRegistry.js').IconProvider} */
const tablerProvider = {
  id: 'tabler',
  label: 'Tabler',

  /** Tabler icons use raw inner SVG (multiple elements with stroke attributes). */
  renderMode: 'raw',

  load() {
    if (catalog) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = import('../data/tabler-icons.json')
      .then((mod) => {
        catalog = mod.default ?? mod;
      })
      .catch((err) => {
        console.error('[tablerCatalog] Failed to load Tabler icons:', err);
        catalog = { version: '0', count: 0, icons: {} };
      });

    return loadPromise;
  },

  isReady() {
    return catalog !== null;
  },

  getCount() {
    return catalog?.count ?? 0;
  },

  getVersion() {
    return catalog?.version ?? '';
  },

  /**
   * Search icons by name and tags with ranked results.
   *
   * Ranking (highest to lowest):
   *   1. Exact name match
   *   2. Partial name match (name contains query)
   *   3. Tag match (any tag contains query)
   *
   * This ensures that typing "check" shows check-named icons first, with
   * tag-synonym matches (e.g. "accept" → circle-check) appearing after.
   *
   * @param {string} query  Search query (case-insensitive)
   * @param {number} limit  Maximum results to return
   * @returns {{ name: string, data: string }[]}
   */
  search(query, limit = 100) {
    if (!catalog) return [];
    const q = (query ?? '').toLowerCase().trim();

    if (!q) {
      // No query — return all icons up to limit (name-only iteration)
      const results = [];
      for (const [name, entry] of Object.entries(catalog.icons)) {
        if (results.length >= limit) break;
        results.push({ name, data: entry.d });
      }
      return results;
    }

    // Three ranked buckets to avoid a two-pass sort
    const exactName = [];   // name === query
    const partialName = []; // name contains query
    const tagOnly = [];     // no name match, but a tag contains query

    for (const [name, entry] of Object.entries(catalog.icons)) {
      if (name === q) {
        exactName.push({ name, data: entry.d });
      } else if (name.includes(q)) {
        partialName.push({ name, data: entry.d });
      } else if (entry.t.some((tag) => tag.includes(q))) {
        tagOnly.push({ name, data: entry.d });
      }
    }

    // Merge buckets respecting the limit
    const all = [...exactName, ...partialName, ...tagOnly];
    return all.length <= limit ? all : all.slice(0, limit);
  },

  /**
   * Return the raw inner SVG content for a named icon.
   * @param {string} name
   * @returns {string | null}
   */
  getData(name) {
    const entry = catalog?.icons?.[name];
    return entry?.d ?? null;
  },

  /**
   * Produce a complete standalone SVG string for the draw engine.
   *
   * Outline icons: stroke-based on 24×24 viewBox with stroke="black".
   * Filled icons: fill-based on 24×24 viewBox with fill="black".
   *
   * Explicit width/height attributes are included alongside viewBox to
   * ensure consistent rendering when loaded as a browser <img> element
   * (some browsers default to 0×0 for SVGs with viewBox but no size).
   *
   * @param {string} name
   * @returns {string | null}
   */
  toSvgString(name) {
    const inner = this.getData(name);
    if (!inner) return null;

    // Filled variants use fill instead of stroke
    const isFilled = name.endsWith('-filled');

    if (isFilled) {
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="black">' +
        inner +
        '</svg>'
      );
    }

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"' +
      ' stroke-width="2" stroke="black" fill="none"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      inner +
      '</svg>'
    );
  },
};

export default tablerProvider;
