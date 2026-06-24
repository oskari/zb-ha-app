/**
 * binEncoder.ts — Canvas → 1-bit packed binary (production mode)
 *
 * Per README "Output Formats":
 *   Packed 1-bit binary — 8 pixels per byte, MSB first.
 *   Content-Type: application/octet-stream
 *   Compact format for embedded consumers (ESP32 E-ink).
 */

import { Canvas } from "../engine/canvas";

/**
 * Encode a 1-bit canvas to a packed binary buffer.
 */
export function encodeBin(canvas: Canvas): Buffer {
  // The canvas buffer is already in the correct format:
  // 8 pixels per byte, MSB = leftmost pixel, row-major order.
  return Buffer.from(canvas.buffer);
}
