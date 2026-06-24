/**
 * circle.ts — Circle / Ellipse / Arc primitive
 */

import { Canvas } from "../canvas";
import { CircleProps } from "../types";
import { shouldDitherPixel, setWithOpacity } from "../dither";

export function drawCircle(canvas: Canvas, props: CircleProps): void {
  const cx = Math.round(props.pos.x);
  const cy = Math.round(props.pos.y);
  const rx = props.sizeX / 2;
  const ry = props.sizeY / 2;

  if (rx <= 0 || ry <= 0) return;

  const hasArc = props.arcStartDeg !== 0 || props.arcEndDeg !== 0;
  const startRad = hasArc ? (props.arcStartDeg * Math.PI) / 180 : 0;
  const endRad = hasArc ? (props.arcEndDeg * Math.PI) / 180 : Math.PI * 2;

  const left = Math.floor(cx - rx);
  const top = Math.floor(cy - ry);
  const right = Math.ceil(cx + rx);
  const bottom = Math.ceil(cy + ry);

  if (props.enableFill) {
    const innerRx = rx * props.innerSize;
    const innerRy = ry * props.innerSize;
    const hasInner = props.innerSize > 0;

    for (let py = top; py <= bottom; py++) {
      for (let px = left; px <= right; px++) {
        const dx = px - cx;
        const dy = py - cy;

        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
        if (hasInner && (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy) < 1) continue;
        if (hasArc && !isInArc(dx, dy, startRad, endRad)) continue;

        const val = shouldDitherPixel(px, py, props.fill) ? 1 : 0;
        setWithOpacity(canvas, px, py, val, props.opacity);
      }
    }
  }

  if (props.enableStroke && props.strokeWidth > 0) {
    drawCircleStroke(canvas, cx, cy, rx, ry, hasArc, startRad, endRad, props);
  }
}

function isInArc(
  dx: number,
  dy: number,
  startRad: number,
  endRad: number,
): boolean {
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;

  let start = startRad % (Math.PI * 2);
  let end = endRad % (Math.PI * 2);
  if (start < 0) start += Math.PI * 2;
  if (end < 0) end += Math.PI * 2;

  if (start <= end) {
    return angle >= start && angle <= end;
  } else {
    return angle >= start || angle <= end;
  }
}

function drawCircleStroke(
  canvas: Canvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  hasArc: boolean,
  startRad: number,
  endRad: number,
  props: CircleProps,
): void {
  const sw = props.strokeWidth;
  const dither = props.strokeDither;
  const opacity = props.opacity;

  let outerRx: number, outerRy: number, innerRx: number, innerRy: number;
  if (props.strokePosition === "inside") {
    outerRx = rx;
    outerRy = ry;
    innerRx = rx - sw;
    innerRy = ry - sw;
  } else if (props.strokePosition === "outside") {
    outerRx = rx + sw;
    outerRy = ry + sw;
    innerRx = rx;
    innerRy = ry;
  } else {
    const half = sw / 2;
    outerRx = rx + half;
    outerRy = ry + half;
    innerRx = rx - half;
    innerRy = ry - half;
  }

  if (innerRx < 0) innerRx = 0;
  if (innerRy < 0) innerRy = 0;

  const left = Math.floor(cx - outerRx);
  const top = Math.floor(cy - outerRy);
  const right = Math.ceil(cx + outerRx);
  const bottom = Math.ceil(cy + outerRy);

  const hasDash = props.strokeDash.length >= 2;

  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const dx = px - cx;
      const dy = py - cy;

      const outerDist =
        (dx * dx) / (outerRx * outerRx) + (dy * dy) / (outerRy * outerRy);
      if (outerDist > 1) continue;

      const innerDist =
        innerRx > 0 && innerRy > 0
          ? (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy)
          : 0;
      if (innerDist < 1 && innerRx > 0 && innerRy > 0) continue;

      if (hasArc && !isInArc(dx, dy, startRad, endRad)) continue;

      if (hasDash) {
        const angle = Math.atan2(dy, dx);
        const circumference = Math.PI * (outerRx + outerRy);
        const arcPos =
          ((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) *
          circumference;
        const dashOn = props.strokeDash[0];
        const dashOff = props.strokeDash[1];
        const dashTotal = dashOn + dashOff;
        if (arcPos % dashTotal >= dashOn) continue;
      }

      const val = shouldDitherPixel(px, py, dither) ? 1 : 0;
      setWithOpacity(canvas, px, py, val, opacity);
    }
  }
}
