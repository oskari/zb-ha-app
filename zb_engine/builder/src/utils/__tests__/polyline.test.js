/**
 * polyline.test.js — Parity tests for roundPolyline (mirrors line.ts).
 */

import { describe, it, expect } from 'vitest';
import { roundPolyline } from '../polyline.js';

describe('roundPolyline', () => {
  it('returns the input unchanged for fewer than 3 points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(roundPolyline(pts, 5)).toBe(pts);
  });

  it('returns the input unchanged for radius <= 0', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(roundPolyline(pts, 0)).toBe(pts);
  });

  it('preserves endpoints and fillets the interior corner', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const out = roundPolyline(pts, 4);

    // Endpoints unchanged.
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 10 });

    // The sharp corner is replaced by a fillet (more vertices, corner removed).
    expect(out.length).toBeGreaterThan(3);
    expect(out.some((p) => p.x === 10 && p.y === 0)).toBe(false);

    // Tangent points sit `radius` back along each edge from the corner.
    expect(out).toContainEqual({ x: 6, y: 0 }); // 4 units back toward (0,0)
    expect(out).toContainEqual({ x: 10, y: 4 }); // 4 units toward (10,10)
  });

  it('clamps the radius to half the shorter adjacent edge', () => {
    // Edges of length 10; radius 100 clamps to 5 → tangent points at the midpoints.
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const out = roundPolyline(pts, 100);
    expect(out).toContainEqual({ x: 5, y: 0 });
    expect(out).toContainEqual({ x: 10, y: 5 });
  });
});
