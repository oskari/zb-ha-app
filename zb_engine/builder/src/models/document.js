/**
 * Physical e-ink display dimensions (pixels).
 * The reference grid (REF_COLS × REF_ROWS) maps to the full screen.
 */
export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 480;

/** Width of the HA sidebar overlay on the device (pixels). */
export const SIDE_PANEL_WIDTH = 80;

/** Reference grid that represents the full screen. */
export const REF_COLS = 3;
export const REF_ROWS = 2;

/** Legacy fixed grid unit — used when no screenSize is provided. */
const GRID_UNIT_PX = 240;

export function normalizeGridSize(gridSize) {
  if (typeof gridSize !== 'string') return '1x1';

  const match = gridSize.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return '1x1';

  const cols = Math.max(1, Math.min(50, Number(match[1])));
  const rows = Math.max(1, Math.min(50, Number(match[2])));

  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return '1x1';
  return `${cols}x${rows}`;
}

/**
 * Convert a grid size string to pixel dimensions.
 *
 * When `screenSize` is provided, dimensions are proportional to the reference
 * grid (REF_COLS × REF_ROWS = full screen). This makes "3x2" produce exactly
 * the screen dimensions, and other sizes scale proportionally.
 *
 * When `screenSize` is omitted, falls back to the legacy 240px square unit.
 *
 * @param {string} gridSize — e.g. '3x2', '1x1'
 * @param {{ width: number, height: number }} [screenSize] — target screen size
 * @returns {{ width: number, height: number }}
 */
export function gridSizeToSize(gridSize, screenSize) {
  const normalized = normalizeGridSize(gridSize);
  const match = normalized.match(/^(\d+)x(\d+)$/);
  const cols = Number(match[1]);
  const rows = Number(match[2]);

  if (screenSize && typeof screenSize === 'object') {
    const sw = Number(screenSize.width);
    const sh = Number(screenSize.height);
    if (Number.isFinite(sw) && Number.isFinite(sh) && sw > 0 && sh > 0) {
      return {
        width: Math.round((cols / REF_COLS) * sw),
        height: Math.round((rows / REF_ROWS) * sh),
      };
    }
  }

  return {
    width: cols * GRID_UNIT_PX,
    height: rows * GRID_UNIT_PX,
  };
}

/**
 * Create a new blank editor document.
 *
 * @param {{ width: number, height: number }} [screenSize] — target screen
 *   dimensions for the display mode. When omitted, uses legacy 240px unit.
 * @returns {object} A fresh document structure.
 */
export function createNewDocument(screenSize) {
  const gridSize = '3x2';

  return {
    misc: {
      name: '',
      type: '',
      subcategory: '',
      tags: [],
      gridSize,
      size: gridSizeToSize(gridSize, screenSize),
    },
    features: {
      definitions: {},
    },
    sources: [],
    elements: [],
  };
}
