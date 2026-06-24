/**
 * downsampling.ts — Generic Largest-Triangle-Three-Buckets (LTTB) downsampler.
 *
 * Single source of truth for LTTB across the codebase
 * (ENGINEERING_CONSTRAINTS §6). The graph normalizer and the HA history
 * fetchers both call into this — do not copy the algorithm elsewhere.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation" (2013).
 */

/**
 * Reduce `points` to at most `maxPoints` items while preserving visual
 * shape. Returns the input unchanged when it already fits.
 *
 * `getX` / `getY` are accessors so callers can plug in their own point
 * shape (NormalizedPoint, HaHistoryPoint, …) without paying for an
 * intermediate copy. `getY` may return null to denote a data gap; null
 * is treated as 0 for triangle-area math (consistent with the previous
 * inlined implementation).
 */
export function downsampleLTTB<T>(
  points: ReadonlyArray<T>,
  maxPoints: number,
  getX: (p: T) => number,
  getY: (p: T) => number | null,
): T[] {
  if (maxPoints < 3 || points.length <= maxPoints) {
    return points.slice() as T[];
  }

  const out: T[] = [points[0]];
  const bucketSize = (points.length - 2) / (maxPoints - 2);
  let prevIndex = 0;

  for (let i = 1; i < maxPoints - 1; i++) {
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor(i * bucketSize) + 1, points.length - 1);

    const nextStart = Math.floor(i * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, points.length - 1);
    let avgX = 0;
    let avgY = 0;
    let avgCount = 0;
    for (let j = nextStart; j <= nextEnd; j++) {
      avgX += getX(points[j]);
      avgY += getY(points[j]) ?? 0;
      avgCount++;
    }
    if (avgCount > 0) { avgX /= avgCount; avgY /= avgCount; }

    let maxArea = -1;
    let maxIndex = bucketStart;
    const prevPt = points[prevIndex];
    const prevX = getX(prevPt);
    const prevY = getY(prevPt) ?? 0;

    for (let j = bucketStart; j <= bucketEnd; j++) {
      const pt = points[j];
      const area = Math.abs(
        (prevX - avgX) * ((getY(pt) ?? 0) - prevY) -
        (prevX - getX(pt)) * (avgY - prevY),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    out.push(points[maxIndex]);
    prevIndex = maxIndex;
  }

  out.push(points[points.length - 1]);
  return out;
}
