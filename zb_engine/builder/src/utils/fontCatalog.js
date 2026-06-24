/**
 * fontCatalog.js — Registry of available bitmap fonts
 *
 * Derived from the font files in fonts/latin/. Each entry corresponds to
 * a physical {Family}_{Size}px_{Weight}.json bitmap font file.
 *
 * The engine resolves font requests by snapping to the nearest available
 * size+weight, so the builder should only offer choices that actually exist.
 *
 * When new fonts are added to fonts/latin/, this catalog should be updated.
 */

// ── Raw font file inventory ────────────────────────────────────
// Extracted from fonts/latin/ directory listing.

const FONT_FILES = [
  { family: 'Sora', size: 10, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 12, weight: 'Light', numericWeight: 300 },
  { family: 'Sora', size: 12, weight: 'SemiBold', numericWeight: 600 },
  { family: 'Sora', size: 16, weight: 'Light', numericWeight: 300 },
  { family: 'Sora', size: 16, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 16, weight: 'SemiBold', numericWeight: 600 },
  { family: 'Sora', size: 20, weight: 'Light', numericWeight: 300 },
  { family: 'Sora', size: 20, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 20, weight: 'SemiBold', numericWeight: 600 },
  { family: 'Sora', size: 26, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 34, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 34, weight: 'SemiBold', numericWeight: 600 },
  { family: 'Sora', size: 44, weight: 'Light', numericWeight: 300 },
  { family: 'Sora', size: 44, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 56, weight: 'Light', numericWeight: 300 },
  { family: 'Sora', size: 56, weight: 'Regular', numericWeight: 400 },
  { family: 'Sora', size: 56, weight: 'SemiBold', numericWeight: 600 },
];

// ── Derived lookups ────────────────────────────────────────────

/** All available font families (display names). */
export const FONT_FAMILIES = [...new Set(FONT_FILES.map((f) => f.family))].sort();

/** All available font sizes (sorted ascending). */
export const FONT_SIZES = [...new Set(FONT_FILES.map((f) => f.size))].sort((a, b) => a - b);

/**
 * Map of family → size → available weight names.
 * E.g. FONT_MAP['Sora'][16] = ['Light', 'Regular', 'SemiBold']
 */
const FONT_MAP = {};
for (const f of FONT_FILES) {
  if (!FONT_MAP[f.family]) FONT_MAP[f.family] = {};
  if (!FONT_MAP[f.family][f.size]) FONT_MAP[f.family][f.size] = [];
  FONT_MAP[f.family][f.size].push({ name: f.weight, value: f.numericWeight });
}

/**
 * Get available sizes for a given family.
 * @param {string} family
 * @returns {number[]}
 */
export function getSizesForFamily(family) {
  const fam = FONT_MAP[family];
  if (!fam) return FONT_SIZES; // fallback to all sizes
  return Object.keys(fam).map(Number).sort((a, b) => a - b);
}

/**
 * Get available weights for a given family + size.
 * @param {string} family
 * @param {number} size
 * @returns {{ name: string, value: number }[]}
 */
export function getWeightsForFamilySize(family, size) {
  const fam = FONT_MAP[family];
  if (!fam) return [{ name: 'Regular', value: 400 }];
  const weights = fam[size];
  if (!weights) return [{ name: 'Regular', value: 400 }];
  return weights;
}
