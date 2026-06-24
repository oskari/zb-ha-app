/**
 * transform.ts — Affine transform support for elements
 *
 * Handles rotation, scale, and origin transforms by:
 * 1. Rendering the element to a temporary canvas at identity
 * 2. Inverse-mapping destination pixels through the transform to sample the source
 */

import { Canvas } from "./canvas";
import {
  ResolvedElement,
  BaseElementProps,
  CircleProps,
  LineProps,
} from "./types";

// ── Tracking Canvas ────────────────────────────────────────────

class TransformCanvas extends Canvas {
  readonly mask: Canvas;

  constructor(width: number, height: number) {
    super(width, height);
    this.mask = new Canvas(width, height);
  }

  override setPixel(x: number, y: number, value: number): void {
    super.setPixel(x, y, value);
    if (this.inBounds(x, y)) {
      this.mask.setPixel(x, y, 1);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hasNonIdentityTransform(el: BaseElementProps): boolean {
  return el.rotationDeg !== 0 || el.scale.x !== 1 || el.scale.y !== 1;
}

function getElementLocalBounds(el: ResolvedElement): Bounds {
  const pad = 2;
  switch (el.type) {
    case "rect":
    case "text":
    case "img":
    case "svg": {
      const e = el as ResolvedElement & { sizeX?: number; sizeY?: number; enableStroke?: boolean; strokeWidth?: number; strokePosition?: string };
      const sw = e.enableStroke && e.strokeWidth ? e.strokeWidth : 0;
      const extra =
        e.strokePosition === "outside"
          ? sw
          : e.strokePosition === "center"
            ? Math.ceil(sw / 2)
            : 0;
      return {
        x: e.pos.x - extra - pad,
        y: e.pos.y - extra - pad,
        w: (e.sizeX || 0) + 2 * extra + 2 * pad,
        h: (e.sizeY || 0) + 2 * extra + 2 * pad,
      };
    }
    case "circle": {
      const c = el as CircleProps;
      const sw = c.enableStroke && c.strokeWidth ? c.strokeWidth : 0;
      const rx = c.sizeX / 2 + sw + pad;
      const ry = c.sizeY / 2 + sw + pad;
      return {
        x: c.pos.x - rx,
        y: c.pos.y - ry,
        w: 2 * rx,
        h: 2 * ry,
      };
    }
    case "line": {
      const l = el as LineProps;
      if (l.points.length === 0) return { x: l.pos.x, y: l.pos.y, w: 0, h: 0 };
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [px, py] of l.points) {
        minX = Math.min(minX, px + l.pos.x);
        minY = Math.min(minY, py + l.pos.y);
        maxX = Math.max(maxX, px + l.pos.x);
        maxY = Math.max(maxY, py + l.pos.y);
      }
      const sw = l.strokeWidth + l.strokeRadius + pad;
      return {
        x: minX - sw,
        y: minY - sw,
        w: maxX - minX + 2 * sw,
        h: maxY - minY + 2 * sw,
      };
    }
    case "group":
    default:
      return { x: 0, y: 0, w: 9999, h: 9999 };
  }
}

function transformBounds(
  bounds: Bounds,
  centerX: number,
  centerY: number,
  angle: number,
  sx: number,
  sy: number,
): Bounds {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.h },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
  ];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const c of corners) {
    const dx = (c.x - centerX) * sx;
    const dy = (c.y - centerY) * sy;
    const wx = dx * cosA - dy * sinA + centerX;
    const wy = dx * sinA + dy * cosA + centerY;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }

  return {
    x: Math.floor(minX) - 1,
    y: Math.floor(minY) - 1,
    w: Math.ceil(maxX - minX) + 2,
    h: Math.ceil(maxY - minY) + 2,
  };
}

// ── Main transform function ────────────────────────────────────

export async function drawWithTransform(
  canvas: Canvas,
  el: ResolvedElement,
  drawFn: (canvas: Canvas, element: unknown) => Promise<void>,
): Promise<void> {
  if (el.scale.x === 0 && el.scale.y === 0) return;

  const temp = new TransformCanvas(canvas.width, canvas.height);

  await drawFn(temp, el);

  const centerX = el.pos.x + el.origin.x;
  const centerY = el.pos.y + el.origin.y;
  const angle = (el.rotationDeg * Math.PI) / 180;
  const sx = el.scale.x || 1e-10;
  const sy = el.scale.y || 1e-10;

  const cosInv = Math.cos(-angle);
  const sinInv = Math.sin(-angle);

  const localBounds = getElementLocalBounds(el);
  const worldBounds = transformBounds(localBounds, centerX, centerY, angle, sx, sy);

  const startX = Math.max(0, worldBounds.x);
  const startY = Math.max(0, worldBounds.y);
  const endX = Math.min(canvas.width - 1, worldBounds.x + worldBounds.w);
  const endY = Math.min(canvas.height - 1, worldBounds.y + worldBounds.h);

  for (let wy = startY; wy <= endY; wy++) {
    for (let wx = startX; wx <= endX; wx++) {
      const dx = wx - centerX;
      const dy = wy - centerY;

      const rx = dx * cosInv - dy * sinInv;
      const ry = dx * sinInv + dy * cosInv;

      const srcX = Math.round(rx / sx + centerX);
      const srcY = Math.round(ry / sy + centerY);

      if (
        temp.inBounds(srcX, srcY) &&
        temp.mask.getPixel(srcX, srcY) === 1
      ) {
        canvas.setPixel(wx, wy, temp.getPixel(srcX, srcY));
      }
    }
  }
}
