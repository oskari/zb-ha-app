/**
 * polyline.js — Polyline corner rounding (mirrors src/engine/primitives/line.ts)
 *
 * The engine rounds polyline corners by a radius (quadratic-Bézier fillets) when
 * strokeRadius > 0. Porting it here lets the builder canvas reflect rounded line
 * elements and graph line charts the same way the device renders them.
 */

/**
 * Round the interior corners of a polyline. Endpoints are preserved.
 * Identical algorithm to line.ts roundPolyline.
 * @param {{x:number,y:number}[]} pts
 * @param {number} radius
 * @returns {{x:number,y:number}[]}
 */
export function roundPolyline(pts, radius) {
  if (pts.length < 3 || radius <= 0) return pts;

  const result = [pts[0]];

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const d1x = prev.x - curr.x;
    const d1y = prev.y - curr.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;

    const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y);

    if (len1 === 0 || len2 === 0) {
      result.push(curr);
      continue;
    }

    const r = Math.min(radius, len1 / 2, len2 / 2);

    const t1x = curr.x + (d1x / len1) * r;
    const t1y = curr.y + (d1y / len1) * r;
    const t2x = curr.x + (d2x / len2) * r;
    const t2y = curr.y + (d2y / len2) * r;

    result.push({ x: t1x, y: t1y });

    const steps = Math.max(4, Math.ceil(r));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      result.push({
        x: u * u * t1x + 2 * u * t * curr.x + t * t * t2x,
        y: u * u * t1y + 2 * u * t * curr.y + t * t * t2y,
      });
    }

    result.push({ x: t2x, y: t2y });
  }

  result.push(pts[pts.length - 1]);
  return result;
}
