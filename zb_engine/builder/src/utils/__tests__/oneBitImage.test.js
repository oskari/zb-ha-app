/**
 * oneBitImage.test.js — Parity tests for the canvas 1-bit dither math.
 *
 * The pixel-rendering functions need a real 2D canvas (absent in this node test
 * env), so we cover shouldDitherPixel here — the parity-critical core that must
 * match the engine's src/engine/dither.ts exactly, since the builder canvas and
 * the device renderer have to agree on which pixels are black.
 */

import { describe, it, expect } from 'vitest';
import { shouldDitherPixel } from '../oneBitImage.js';

// Mirror of the engine's normalized Bayer threshold for cross-checking.
const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];
const threshold = (x, y) => (BAYER_8X8[y & 7][x & 7] / 63) * 100;

describe('shouldDitherPixel — boundaries', () => {
  it('is always white at level <= 0', () => {
    expect(shouldDitherPixel(0, 0, 0)).toBe(false);
    expect(shouldDitherPixel(3, 5, -10)).toBe(false);
  });

  it('is always black at level >= 100', () => {
    expect(shouldDitherPixel(0, 0, 100)).toBe(true);
    expect(shouldDitherPixel(7, 7, 250)).toBe(true);
  });
});

describe('shouldDitherPixel — matches the engine Bayer matrix', () => {
  it('reproduces level > threshold for the first row', () => {
    // BAYER row 0 normalized ≈ [0, 50.8, 12.7, 63.5, 3.2, 54.0, 15.9, 66.7]
    expect(shouldDitherPixel(0, 0, 50)).toBe(true); //  50 > 0
    expect(shouldDitherPixel(1, 0, 50)).toBe(false); // 50 > 50.8 → false
    expect(shouldDitherPixel(2, 0, 50)).toBe(true); //  50 > 12.7
    expect(shouldDitherPixel(3, 0, 50)).toBe(false); // 50 > 63.5 → false
    expect(shouldDitherPixel(4, 0, 50)).toBe(true); //  50 > 3.2
  });

  it('agrees with the recomputed threshold across the whole 8×8 tile', () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        for (const level of [10, 25, 50, 75, 90]) {
          expect(shouldDitherPixel(x, y, level)).toBe(level > threshold(x, y));
        }
      }
    }
  });

  it('tiles with period 8 in both axes', () => {
    for (const level of [20, 50, 80]) {
      expect(shouldDitherPixel(9, 8, level)).toBe(shouldDitherPixel(1, 0, level));
      expect(shouldDitherPixel(15, 23, level)).toBe(shouldDitherPixel(7, 7, level));
    }
  });
});
