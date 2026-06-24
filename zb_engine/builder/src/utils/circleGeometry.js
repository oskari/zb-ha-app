/**
 * circleGeometry.js — Shared circle coordinate conversion helpers
 *
 * The builder stores circle positions as the top-left of the bounding box
 * (matching rects), while the engine stores the ellipse center.
 * Circles may have independent sizeX and sizeY (ellipse radii).
 */

/**
 * Convert editor top-left position to engine center position.
 * @param {number} x - Top-left X coordinate
 * @param {number} y - Top-left Y coordinate
 * @param {number} sizeX - Horizontal diameter
 * @param {number} sizeY - Vertical diameter
 * @returns {{ cx: number, cy: number }}
 */
export function circlePosToCenter(x, y, sizeX, sizeY) {
  return {
    cx: x + sizeX / 2,
    cy: y + sizeY / 2,
  };
}

/**
 * Convert engine center position to editor top-left position.
 * @param {number} cx - Center X coordinate
 * @param {number} cy - Center Y coordinate
 * @param {number} sizeX - Horizontal diameter
 * @param {number} sizeY - Vertical diameter
 * @returns {{ x: number, y: number }}
 */
export function centerToCirclePos(cx, cy, sizeX, sizeY) {
  return {
    x: cx - sizeX / 2,
    y: cy - sizeY / 2,
  };
}
