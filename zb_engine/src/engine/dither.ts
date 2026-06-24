/**
 * dither.ts — Dither pattern generation
 *
 * Per README "Canvas Model":
 *   - Dithering simulates shades on a 1-bit canvas.
 *   - A dither value of 0 = all white, 100 = all black.
 *   - Uses an ordered (Bayer) dither matrix.
 */

/**
 * 8×8 Bayer ordered dither matrix.
 */
const BAYER_8X8: number[][] = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** Pre-computed: Bayer values normalized to 0–100 range. */
const BAYER_NORMALIZED: number[][] = BAYER_8X8.map((row) =>
  row.map((v) => (v / 63) * 100),
);

/**
 * Determine if a pixel at (x, y) should be black given a dither level.
 */
export function shouldDitherPixel(
  x: number,
  y: number,
  level: number,
): boolean {
  if (level <= 0) return false;
  if (level >= 100) return true;
  const threshold = BAYER_NORMALIZED[y & 7][x & 7];
  return level > threshold;
}

/**
 * Set a pixel on a canvas with opacity dithering.
 */
export function setWithOpacity(
  canvas: { setPixel(x: number, y: number, v: number): void },
  x: number,
  y: number,
  value: number,
  opacity: number,
): void {
  if (opacity >= 100) {
    canvas.setPixel(x, y, value);
  } else if (opacity > 0) {
    if (shouldDitherPixel(x, y, opacity)) {
      canvas.setPixel(x, y, value);
    }
  }
}
