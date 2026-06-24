/**
 * shapeSceneFuncs.test.js — Parity test for corner-radius clamping.
 *
 * The sceneFunc drawing needs a real 2D canvas (absent in this node env), but
 * the corner-radius clamp is pure and must match the engine's rect.ts:18
 * (`Math.min(strokeRadius, Math.floor(Math.min(w, h) / 2))`, never negative).
 */

import { describe, it, expect } from 'vitest';
import { clampCornerRadius, resolveArcSweep } from '../shapeSceneFuncs.js';

const TAU = Math.PI * 2;

describe('clampCornerRadius', () => {
  it('passes through a radius that fits', () => {
    expect(clampCornerRadius(8, 100, 60)).toBe(8);
  });

  it('caps at half the smaller side (matching the engine)', () => {
    expect(clampCornerRadius(999, 100, 60)).toBe(30); // floor(60/2)
    expect(clampCornerRadius(999, 41, 41)).toBe(20); // floor(41/2)
  });

  it('treats missing/zero/negative radius as 0', () => {
    expect(clampCornerRadius(0, 100, 100)).toBe(0);
    expect(clampCornerRadius(undefined, 100, 100)).toBe(0);
    expect(clampCornerRadius(-5, 100, 100)).toBe(0);
  });
});

describe('resolveArcSweep — matches the engine isInArc semantics (circle.ts)', () => {
  it('treats 0/0 as a full circle (the no-arc case)', () => {
    expect(resolveArcSweep(0, 0)).toEqual({ fullCircle: true, start: 0, end: TAU });
  });

  it('returns a forward sweep for a normal arc', () => {
    const s = resolveArcSweep(0, 270);
    expect(s.fullCircle).toBeUndefined();
    expect(s.empty).toBeUndefined();
    expect(s.start).toBeCloseTo(0, 9);
    expect(s.end).toBeCloseTo((270 * Math.PI) / 180, 9);
  });

  it('extends the end by 2π for wrap-around arcs (270→90)', () => {
    const s = resolveArcSweep(270, 90);
    expect(s.start).toBeCloseTo((270 * Math.PI) / 180, 9);
    expect(s.end).toBeCloseTo((90 * Math.PI) / 180 + TAU, 9);
    expect(s.end).toBeGreaterThan(s.start);
  });

  it('renders NOTHING for degenerate sweeps the engine drops (regression guard)', () => {
    // 0→360, equal-after-normalization, and 360→0 all render ~nothing in the
    // engine — the canvas must NOT draw a full circle for them.
    expect(resolveArcSweep(0, 360).empty).toBe(true);
    expect(resolveArcSweep(90, 90).empty).toBe(true);
    expect(resolveArcSweep(360, 0).empty).toBe(true);
  });
});
