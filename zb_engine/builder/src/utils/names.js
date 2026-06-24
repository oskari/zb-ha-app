/**
 * names.js — Generic sequential name generator
 *
 * Scans an array of existing names for a trailing " N" pattern (e.g.
 * "Untitled 3") and returns the next available numbered name.
 *
 * Used by widget creation (Untitled 1, Untitled 2, …) and potentially
 * by element creation (Circle 1, Circle 2, …).
 */

/**
 * Find the next available numbered name for a given prefix.
 *
 * @param {string} prefix        The base name (e.g. "Untitled")
 * @param {string[]} existingNames  Array of names already in use
 * @returns {string} e.g. "Untitled 1", "Untitled 2", …
 */
export function nextAvailableName(prefix, existingNames) {
  let max = 0;

  for (const name of existingNames) {
    if (typeof name !== 'string') continue;

    // Match "<prefix> <number>" exactly
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    const match = suffix.match(/^\s(\d+)$/);
    if (!match) continue;

    const num = Number(match[1]);
    if (Number.isFinite(num) && num > max) {
      max = num;
    }
  }

  return `${prefix} ${max + 1}`;
}
