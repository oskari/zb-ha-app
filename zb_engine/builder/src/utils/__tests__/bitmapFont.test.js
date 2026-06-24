/**
 * bitmapFont.test.js — Tests for the bitmap-font color parser.
 *
 * Regression coverage for the text-dither bug: the canvas approximates a
 * dither percentage as a solid gray via ditherPercentToGray(), which emits the
 * modern space-separated CSS form "rgb(v v v)". parseColor() must understand
 * that form — when it only parsed #hex it fell through to black, so text always
 * rendered solid black on the canvas regardless of its configured dither level
 * while the engine preview correctly dithered it.
 */

import { describe, it, expect } from 'vitest';
import { parseColor } from '../bitmapFont.js';
import { ditherPercentToGray } from '../../editor/elementRenderHelpers.js';

describe('parseColor — hex', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#D42D32')).toEqual([212, 45, 50]);
  });

  it('parses 3-digit shorthand hex', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#000')).toEqual([0, 0, 0]);
  });
});

describe('parseColor — rgb()/rgba()', () => {
  it('parses modern space-separated rgb() (the ditherPercentToGray form)', () => {
    expect(parseColor('rgb(128 128 128)')).toEqual([128, 128, 128]);
    expect(parseColor('rgb(0 0 0)')).toEqual([0, 0, 0]);
    expect(parseColor('rgb(255 255 255)')).toEqual([255, 255, 255]);
  });

  it('parses legacy comma-separated rgb()', () => {
    expect(parseColor('rgb(64,64,64)')).toEqual([64, 64, 64]);
    expect(parseColor('rgb(64, 64, 64)')).toEqual([64, 64, 64]);
  });

  it('parses rgba() and ignores the alpha channel', () => {
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
  });

  it('clamps out-of-range channels', () => {
    expect(parseColor('rgb(300 -5 128)')).toEqual([255, 0, 128]);
  });
});

describe('parseColor — invalid input', () => {
  it('falls back to black for unrecognised strings', () => {
    expect(parseColor('not-a-color')).toEqual([0, 0, 0]);
  });

  it('falls back to black for non-string input', () => {
    expect(parseColor(undefined)).toEqual([0, 0, 0]);
    expect(parseColor(null)).toEqual([0, 0, 0]);
  });
});

describe('parseColor ∘ ditherPercentToGray — the canvas text-dither contract', () => {
  // The canvas builds text fill as ditherPercentToGray(percent) and feeds it
  // straight into renderBitmapText -> parseColor. These must round-trip so the
  // gray level (the canvas stand-in for a dither pattern) survives to pixels.
  it('100% dither maps to black ink', () => {
    expect(parseColor(ditherPercentToGray(100))).toEqual([0, 0, 0]);
  });

  it('0% dither maps to white', () => {
    expect(parseColor(ditherPercentToGray(0))).toEqual([255, 255, 255]);
  });

  it('a mid dither level produces a real gray, not black', () => {
    const [r, g, b] = parseColor(ditherPercentToGray(50));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(0); // regression guard: must NOT collapse to black
    expect(r).toBeLessThan(255);
  });
});
