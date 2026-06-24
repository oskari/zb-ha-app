/**
 * circleGeometry.test.js — Tests for circle coordinate conversion helpers
 *
 * Covers: circlePosToCenter, centerToCirclePos, round-trip identity,
 * zero-size circles, and asymmetric sizeX/sizeY (ellipses).
 */

import { describe, it, expect } from 'vitest';
import { circlePosToCenter, centerToCirclePos } from '../circleGeometry.js';

// ── circlePosToCenter (editor top-left → engine center) ────────

describe('circlePosToCenter', () => {
  it('converts top-left to center for a symmetric circle', () => {
    const result = circlePosToCenter(10, 20, 100, 100);
    expect(result).toEqual({ cx: 60, cy: 70 });
  });

  it('converts top-left to center for an asymmetric ellipse', () => {
    const result = circlePosToCenter(10, 20, 80, 40);
    expect(result).toEqual({ cx: 50, cy: 40 });
  });

  it('handles zero-size circle', () => {
    const result = circlePosToCenter(10, 20, 0, 0);
    expect(result).toEqual({ cx: 10, cy: 20 });
  });

  it('handles origin position', () => {
    const result = circlePosToCenter(0, 0, 50, 50);
    expect(result).toEqual({ cx: 25, cy: 25 });
  });

  it('handles negative position values', () => {
    const result = circlePosToCenter(-50, -30, 100, 60);
    expect(result).toEqual({ cx: 0, cy: 0 });
  });
});

// ── centerToCirclePos (engine center → editor top-left) ────────

describe('centerToCirclePos', () => {
  it('converts center to top-left for a symmetric circle', () => {
    const result = centerToCirclePos(60, 70, 100, 100);
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it('converts center to top-left for an asymmetric ellipse', () => {
    const result = centerToCirclePos(50, 40, 80, 40);
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it('handles zero-size circle', () => {
    const result = centerToCirclePos(10, 20, 0, 0);
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it('handles negative resulting position', () => {
    const result = centerToCirclePos(10, 10, 100, 100);
    expect(result).toEqual({ x: -40, y: -40 });
  });
});

// ── Round-trip identity ────────────────────────────────────────

describe('round-trip identity', () => {
  const testCases = [
    { x: 10, y: 20, sx: 100, sy: 100, label: 'symmetric circle' },
    { x: 0, y: 0, sx: 50, sy: 50, label: 'origin position' },
    { x: -30, y: 15, sx: 80, sy: 40, label: 'asymmetric ellipse' },
    { x: 0, y: 0, sx: 0, sy: 0, label: 'zero-size circle' },
    { x: 100, y: 200, sx: 1, sy: 1, label: 'tiny circle' },
    { x: 0.5, y: 0.5, sx: 3.7, sy: 2.1, label: 'fractional values' },
  ];

  for (const { x, y, sx, sy, label } of testCases) {
    it(`top-left → center → top-left round-trips for ${label}`, () => {
      const { cx, cy } = circlePosToCenter(x, y, sx, sy);
      const { x: rx, y: ry } = centerToCirclePos(cx, cy, sx, sy);
      expect(rx).toBeCloseTo(x, 10);
      expect(ry).toBeCloseTo(y, 10);
    });

    it(`center → top-left → center round-trips for ${label}`, () => {
      const { x: tlX, y: tlY } = centerToCirclePos(x, y, sx, sy);
      const { cx, cy } = circlePosToCenter(tlX, tlY, sx, sy);
      expect(cx).toBeCloseTo(x, 10);
      expect(cy).toBeCloseTo(y, 10);
    });
  }
});
