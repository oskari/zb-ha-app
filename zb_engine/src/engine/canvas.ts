/**
 * canvas.ts — 1-bit canvas buffer
 *
 * Per README "Canvas Model":
 *   - Coordinate system: top-left origin (0,0), X→right, Y→down
 *   - Color model: strictly 1-bit (0 = white, 1 = black)
 *   - Stored as a Uint8Array with 1 bit per pixel, packed 8 pixels per byte, MSB first
 */

export class Canvas {
  readonly width: number;
  readonly height: number;

  /** Packed 1-bit buffer. 8 pixels per byte, MSB = leftmost pixel. */
  readonly buffer: Uint8Array;

  /** Number of bytes per row (ceil(width / 8)). */
  readonly stride: number;

  constructor(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid canvas size: ${width}x${height}`);
    }
    this.width = Math.floor(width);
    this.height = Math.floor(height);
    this.stride = Math.ceil(this.width / 8);
    this.buffer = new Uint8Array(this.stride * this.height);
  }

  /** Returns true if (x, y) is within bounds. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Get pixel value at (x, y).
   * @returns 0 (white) or 1 (black). Returns 0 for out-of-bounds.
   */
  getPixel(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    const byteIndex = y * this.stride + (x >> 3);
    const bitIndex = 7 - (x & 7);
    return (this.buffer[byteIndex] >> bitIndex) & 1;
  }

  /**
   * Set pixel at (x, y) to black (1) or white (0).
   * Out-of-bounds writes are silently ignored.
   */
  setPixel(x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) return;
    const byteIndex = y * this.stride + (x >> 3);
    const bitIndex = 7 - (x & 7);
    if (value) {
      this.buffer[byteIndex] |= 1 << bitIndex;
    } else {
      this.buffer[byteIndex] &= ~(1 << bitIndex);
    }
  }

  /** Fill entire canvas with a value (0 = white, 1 = black). */
  clear(value: 0 | 1 = 0): void {
    this.buffer.fill(value ? 0xff : 0x00);
  }
}
