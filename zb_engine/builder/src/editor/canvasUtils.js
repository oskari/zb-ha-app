/**
 * canvasUtils.js — Shared coordinate conversion and grid-snapping utilities
 *
 * Extracted from CanvasArea.jsx to eliminate duplication.
 * All functions are pure — no component state or side effects.
 */

/**
 * Convert screen-space coordinates to world-space coordinates.
 * @param {number} screenX  Screen X position (relative to Stage)
 * @param {number} screenY  Screen Y position (relative to Stage)
 * @param {number} panX     Current pan offset X
 * @param {number} panY     Current pan offset Y
 * @param {number} zoom     Current zoom level
 * @returns {{ x: number, y: number }}
 */
export function screenToWorld(screenX, screenY, panX, panY, zoom) {
  return {
    x: (screenX - panX) / zoom,
    y: (screenY - panY) / zoom,
  };
}

/**
 * Snap a single value to the nearest grid step.
 * @param {number} value     The value to snap
 * @param {number} gridStep  Grid spacing
 * @returns {number}
 */
export function snapToGrid(value, gridStep) {
  return Math.round(value / gridStep) * gridStep;
}

/**
 * Snap a value to the grid, ensuring the result is at least one gridStep.
 * Used for sizes (width/height) to prevent zero-size elements.
 * @param {number} value     The value to snap
 * @param {number} gridStep  Grid spacing
 * @returns {number}
 */
export function snapSizeToGrid(value, gridStep) {
  return Math.max(gridStep, Math.round(value / gridStep) * gridStep);
}
