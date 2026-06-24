/**
 * line.ts — Polyline primitive
 */

import { Canvas } from "../canvas";
import { LineProps } from "../types";
import { shouldDitherPixel, setWithOpacity } from "../dither";

function roundPolyline(
  pts: { x: number; y: number }[],
  radius: number,
): { x: number; y: number }[] {
  if (pts.length < 3 || radius <= 0) return pts;

  const result: { x: number; y: number }[] = [pts[0]];

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

export function drawLine(canvas: Canvas, props: LineProps): void {
  const { points, pos } = props;
  if (points.length < 2) return;
  if (!props.enableStroke) return;

  const sw = props.strokeWidth;
  const dither = props.strokeDither;
  const opacity = props.opacity;
  const dash = props.strokeDash;
  const hasDash = dash.length >= 2;

  let pts = points.map(([x, y]) => ({
    x: x + pos.x,
    y: y + pos.y,
  }));

  if (props.strokeRadius > 0 && pts.length > 2) {
    pts = roundPolyline(pts, props.strokeRadius);
  }

  let totalDist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    totalDist = drawSegment(
      canvas,
      p0.x,
      p0.y,
      p1.x,
      p1.y,
      sw,
      dither,
      opacity,
      hasDash,
      dash,
      totalDist,
    );
  }

  if (props.strokeCap === "round" && sw > 1) {
    const capRadius = sw / 2;
    drawCircleFill(canvas, pts[0].x, pts[0].y, capRadius, dither, opacity);
    drawCircleFill(
      canvas,
      pts[pts.length - 1].x,
      pts[pts.length - 1].y,
      capRadius,
      dither,
      opacity,
    );
  }
}

function drawSegment(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  dither: number,
  opacity: number,
  hasDash: boolean,
  dash: number[],
  startDist: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return startDist;

  const halfW = width / 2;

  const minX = Math.floor(Math.min(x0, x1) - halfW - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + halfW + 1);
  const minY = Math.floor(Math.min(y0, y1) - halfW - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + halfW + 1);

  const dashOn = hasDash ? dash[0] : 0;
  const dashOff = hasDash ? dash[1] : 0;
  const dashTotal = dashOn + dashOff;
  const lenSq = length * length;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const ex = px - x0;
      const ey = py - y0;

      let t = (ex * dx + ey * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const closestX = x0 + dx * t;
      const closestY = y0 + dy * t;

      const pdx = px - closestX;
      const pdy = py - closestY;
      const perpDistSq = pdx * pdx + pdy * pdy;

      if (perpDistSq > halfW * halfW) continue;

      if (hasDash && dashTotal > 0) {
        const lineDist = startDist + t * length;
        if (Math.floor(lineDist) % dashTotal >= dashOn) continue;
      }

      const val = shouldDitherPixel(px, py, dither) ? 1 : 0;
      setWithOpacity(canvas, px, py, val, opacity);
    }
  }

  return startDist + length;
}

function drawCircleFill(
  canvas: Canvas,
  cx: number,
  cy: number,
  r: number,
  dither: number,
  opacity: number,
): void {
  const ir = Math.ceil(r);
  for (let dy = -ir; dy <= ir; dy++) {
    for (let dx = -ir; dx <= ir; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(cx + dx);
      const py = Math.round(cy + dy);
      const val = shouldDitherPixel(px, py, dither) ? 1 : 0;
      setWithOpacity(canvas, px, py, val, opacity);
    }
  }
}
