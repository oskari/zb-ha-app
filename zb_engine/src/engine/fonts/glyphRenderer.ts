/**
 * glyphRenderer.ts — Blit decoded glyph pixels onto a 1-bit canvas
 */

import { Canvas } from "../canvas";
import { DecodedGlyph } from "./fontTypes";
import { shouldDitherPixel } from "../dither";

/**
 * Blit a glyph clipped to a bounding box.
 */
export function blitGlyphClipped(
  canvas: Canvas,
  glyph: DecodedGlyph,
  x: number,
  y: number,
  fill: number,
  opacity: number,
  clipX: number,
  clipY: number,
  clipW: number,
  clipH: number,
): void {
  const gx = Math.round(x + glyph.xOffset);
  const gy = Math.round(y + glyph.yOffset);
  const stride = Math.ceil(glyph.width / 8);

  const clipRight = clipX + clipW;
  const clipBottom = clipY + clipH;

  for (let row = 0; row < glyph.height; row++) {
    const py = gy + row;
    if (py < clipY || py >= clipBottom) continue;
    if (py < 0 || py >= canvas.height) continue;

    for (let col = 0; col < glyph.width; col++) {
      const px = gx + col;
      if (px < clipX || px >= clipRight) continue;
      if (px < 0 || px >= canvas.width) continue;

      const byteIdx = row * stride + (col >> 3);
      const bitIdx = 7 - (col & 7);
      const isInk = (glyph.pixels[byteIdx] >> bitIdx) & 1;

      if (isInk) {
        const val = shouldDitherPixel(px, py, fill) ? 1 : 0;

        if (opacity >= 100) {
          canvas.setPixel(px, py, val);
        } else if (opacity > 0) {
          if (shouldDitherPixel(px, py, opacity)) {
            canvas.setPixel(px, py, val);
          }
        }
      }
    }
  }
}
