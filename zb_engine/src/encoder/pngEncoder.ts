/**
 * pngEncoder.ts — Canvas → PNG (development mode)
 *
 * Per README "Output Formats":
 *   PNG: 8-bit grayscale expanded from the 1-bit buffer.
 *   Content-Type: image/png
 *   Used during development for easy browser preview.
 */

import sharp from "sharp";
import { Canvas } from "../engine/canvas";

/**
 * Encode a 1-bit canvas to a PNG buffer.
 */
export async function encodePng(canvas: Canvas): Promise<Buffer> {
  const { width, height } = canvas;

  // Expand 1-bit → 8-bit grayscale: 0 (white) → 0xFF, 1 (black) → 0x00
  const grayscale = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = canvas.getPixel(x, y);
      grayscale[y * width + x] = pixel ? 0x00 : 0xff;
    }
  }

  return sharp(grayscale, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
