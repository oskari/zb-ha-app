/**
 * rect.ts — Rectangle primitive
 */

import { Canvas } from "../canvas";
import { RectProps } from "../types";
import { shouldDitherPixel, setWithOpacity } from "../dither";

export function drawRect(canvas: Canvas, props: RectProps): void {
  const { pos, sizeX, sizeY } = props;
  const x0 = Math.round(pos.x);
  const y0 = Math.round(pos.y);
  const w = Math.round(sizeX);
  const h = Math.round(sizeY);

  if (w <= 0 || h <= 0) return;

  const r = Math.min(props.strokeRadius, Math.floor(Math.min(w, h) / 2));

  if (props.enableFill) {
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (r > 0 && !isInsideRoundedRect(col, row, w, h, r)) continue;
        const px = x0 + col;
        const py = y0 + row;
        const val = shouldDitherPixel(px, py, props.fill) ? 1 : 0;
        setWithOpacity(canvas, px, py, val, props.opacity);
      }
    }
  }

  if (props.enableStroke && props.strokeWidth > 0) {
    drawRectStroke(canvas, x0, y0, w, h, r, props);
  }
}

function isInsideRoundedRect(
  col: number,
  row: number,
  w: number,
  h: number,
  r: number,
): boolean {
  if (col < r && row < r) {
    return isInsideCircle(col - r, row - r, r);
  }
  if (col >= w - r && row < r) {
    return isInsideCircle(col - (w - r - 1), row - r, r);
  }
  if (col < r && row >= h - r) {
    return isInsideCircle(col - r, row - (h - r - 1), r);
  }
  if (col >= w - r && row >= h - r) {
    return isInsideCircle(col - (w - r - 1), row - (h - r - 1), r);
  }
  return true;
}

function isInsideCircle(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy <= r * r;
}

function drawRectStroke(
  canvas: Canvas,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  props: RectProps,
): void {
  const sw = props.strokeWidth;
  const dither = props.strokeDither;
  const dash = props.strokeDash;
  const opacity = props.opacity;

  let outerOffset = 0;
  let innerOffset = 0;
  if (props.strokePosition === "inside") {
    outerOffset = 0;
    innerOffset = sw;
  } else if (props.strokePosition === "outside") {
    outerOffset = -sw;
    innerOffset = 0;
  } else {
    const half = Math.floor(sw / 2);
    outerOffset = -half;
    innerOffset = sw - half;
  }

  const ox0 = x0 + outerOffset;
  const oy0 = y0 + outerOffset;
  const ow = w - 2 * outerOffset;
  const oh = h - 2 * outerOffset;
  const ix0 = x0 + innerOffset;
  const iy0 = y0 + innerOffset;
  const iw = w - 2 * innerOffset;
  const ih = h - 2 * innerOffset;

  const hasDash = dash.length >= 2;
  const dashOn = hasDash ? dash[0] : 0;
  const dashOff = hasDash ? dash[1] : 0;
  const dashTotal = dashOn + dashOff;

  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const hw = w / 2;
  const hh = h / 2;

  for (let py = oy0; py < oy0 + oh; py++) {
    for (let px = ox0; px < ox0 + ow; px++) {
      const inOuter =
        r > 0
          ? isInsideRoundedRect(px - ox0, py - oy0, ow, oh, r + Math.abs(outerOffset))
          : true;
      if (!inOuter) continue;

      const inInner =
        iw > 0 && ih > 0
          ? px >= ix0 &&
            px < ix0 + iw &&
            py >= iy0 &&
            py < iy0 + ih &&
            (r > 0
              ? isInsideRoundedRect(px - ix0, py - iy0, iw, ih, Math.max(0, r - innerOffset))
              : true)
          : false;

      if (inInner) continue;

      if (hasDash && dashTotal > 0) {
        const dist = rectPerimeterDist(px, py, cx, cy, hw, hh);
        if (Math.floor(dist) % dashTotal >= dashOn) continue;
      }

      const val = shouldDitherPixel(px, py, dither) ? 1 : 0;
      setWithOpacity(canvas, px, py, val, opacity);
    }
  }
}

function rectPerimeterDist(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): number {
  const dx = px - cx;
  const dy = py - cy;
  const nx = hw > 0 ? dx / hw : 0;
  const ny = hh > 0 ? dy / hh : 0;

  if (ny <= -Math.abs(nx)) {
    return dx + hw;
  } else if (nx >= Math.abs(ny)) {
    return 2 * hw + dy + hh;
  } else if (ny >= Math.abs(nx)) {
    return 2 * hw + 2 * hh + hw - dx;
  } else {
    return 4 * hw + 2 * hh + hh - dy;
  }
}
