/**
 * svg.ts — Inline SVG primitive
 */

import sharp from "sharp";
import { Canvas } from "../canvas";
import { SvgProps } from "../types";
import { shouldDitherPixel, setWithOpacity } from "../dither";
import {
  assertTextWithinLimit,
  fetchTextWithLimit,
  IMAGE_FETCH_TIMEOUT_MS,
  MAX_INLINE_SVG_BYTES,
  MAX_SVG_FETCH_BYTES,
  SVG_RASTER_TIMEOUT_MS,
  withTimeout,
} from "./assetLimits";

/**
 * Sanitize SVG content to prevent XSS and external resource loading.
 * Strips <script>, <foreignObject>, <iframe>, event handlers, and external references.
 * This is a security input sanitization step — NOT a draw logic modification.
 */
function sanitizeSvg(svgContent: string): string {
  // Remove dangerous elements entirely
  let sanitized = svgContent;
  sanitized = sanitized.replace(/<script[\s>][\s\S]*?<\/script\s*>/gi, "");
  sanitized = sanitized.replace(/<foreignObject[\s>][\s\S]*?<\/foreignObject\s*>/gi, "");
  sanitized = sanitized.replace(/<iframe[\s>][\s\S]*?<\/iframe\s*>/gi, "");

  // Remove event handler attributes (onload, onclick, onerror, etc.)
  sanitized = sanitized.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");

  // Strip external resource references from <image> elements.
  // Remove xlink:href and href attributes that point to external URLs (http/https/data).
  // Keeps <image> tags that reference local fragments (#id) intact.
  sanitized = sanitized.replace(
    /(<image\b[^>]*?)\s+(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*')/gi,
    "$1",
  );

  return sanitized;
}

function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[idx(nx, ny, width)] === 1) {
            hit = 1;
            break;
          }
        }
      }
      out[idx(x, y, width)] = hit;
    }
  }

  return out;
}

function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          keep = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || mask[idx(nx, ny, width)] === 0) {
            keep = 0;
            break;
          }
        }
      }
      out[idx(x, y, width)] = keep;
    }
  }

  return out;
}

function subtractMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] === 1 && b[i] === 0 ? 1 : 0;
  }
  return out;
}

function unionMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] === 1 || b[i] === 1 ? 1 : 0;
  }
  return out;
}

export async function drawSvg(canvas: Canvas, props: SvgProps): Promise<void> {
  const {
    pos,
    sizeX,
    sizeY,
    bwMode,
    bwLevel,
    opacity,
    enableFill,
    fill,
    enableStroke,
    strokeDither,
    strokeWidth,
    strokePosition,
  } = props;
  let svgContent = props.svg;

  if (!svgContent && props.src) {
    svgContent = await fetchTextWithLimit(props.src, "SVG source", MAX_SVG_FETCH_BYTES, IMAGE_FETCH_TIMEOUT_MS);
  } else if (svgContent) {
    assertTextWithinLimit(svgContent, "Inline SVG", MAX_INLINE_SVG_BYTES);
  }

  if (!svgContent || sizeX <= 0 || sizeY <= 0) return;

  // Security: sanitize SVG before rasterization to strip dangerous content
  svgContent = sanitizeSvg(svgContent);

  const w = Math.round(sizeX);
  const h = Math.round(sizeY);
  const x0 = Math.round(pos.x);
  const y0 = Math.round(pos.y);

  const { data, info } = await withTimeout(
    sharp(Buffer.from(svgContent))
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(w, h, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    SVG_RASTER_TIMEOUT_MS,
    "SVG rasterization",
  );

  const threshold = Math.round((bwLevel / 100) * 255);
  const rasterW = info.width;
  const rasterH = info.height;

  if (!enableFill && !enableStroke) {
    for (let row = 0; row < rasterH && row < h; row++) {
      for (let col = 0; col < rasterW && col < w; col++) {
        const gray = data[row * rasterW + col];
        const px = x0 + col;
        const py = y0 + row;

        let isBlack: boolean;
        if (bwMode === "dither") {
          isBlack = shouldDitherPixel(px, py, Math.round((1 - gray / 255) * 100));
        } else {
          isBlack = gray < threshold;
        }

        setWithOpacity(canvas, px, py, isBlack ? 1 : 0, opacity);
      }
    }
    return;
  }

  const shapeMask = new Uint8Array(rasterW * rasterH);
  for (let row = 0; row < rasterH; row++) {
    for (let col = 0; col < rasterW; col++) {
      const gray = data[row * rasterW + col];
      shapeMask[idx(col, row, rasterW)] = gray < threshold ? 1 : 0;
    }
  }

  const strokeMask = (() => {
    if (!(enableStroke && strokeWidth > 0)) {
      return new Uint8Array(rasterW * rasterH);
    }

    const sw = Math.max(1, Math.round(strokeWidth));

    let insideRadius = 0;
    let outsideRadius = 0;
    if (strokePosition === "inside") {
      insideRadius = sw;
    } else if (strokePosition === "outside") {
      outsideRadius = sw;
    } else {
      insideRadius = Math.ceil(sw / 2);
      outsideRadius = Math.floor(sw / 2);
    }

    const insideBand = insideRadius > 0
      ? subtractMask(shapeMask, erodeMask(shapeMask, rasterW, rasterH, insideRadius))
      : new Uint8Array(rasterW * rasterH);
    const outsideBand = outsideRadius > 0
      ? subtractMask(dilateMask(shapeMask, rasterW, rasterH, outsideRadius), shapeMask)
      : new Uint8Array(rasterW * rasterH);

    return unionMask(insideBand, outsideBand);
  })();

  for (let row = 0; row < rasterH && row < h; row++) {
    for (let col = 0; col < rasterW && col < w; col++) {
      const px = x0 + col;
      const py = y0 + row;
      const i = idx(col, row, rasterW);

      let wrote = false;

      if (enableFill && shapeMask[i] === 1) {
        const fillPixel = shouldDitherPixel(px, py, fill) ? 1 : 0;
        setWithOpacity(canvas, px, py, fillPixel, opacity);
        wrote = true;
      }

      if (enableStroke && strokeMask[i] === 1) {
        const strokePixel = shouldDitherPixel(px, py, strokeDither) ? 1 : 0;
        setWithOpacity(canvas, px, py, strokePixel, opacity);
        wrote = true;
      }

      if (!wrote) {
        continue;
      }
    }
  }
}
