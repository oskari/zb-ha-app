/**
 * oneBitImage.js — Browser-side 1-bit image/SVG conversion for the builder canvas
 *
 * Mirrors the render engine's raster pipeline so the editor surface shows what
 * the device will actually display, instead of the raw full-color source:
 *   - img:  src/engine/primitives/img.ts  (flatten → contain-resize → grayscale → threshold/dither)
 *   - svg:  src/engine/primitives/svg.ts  (same raster, then shapeMask fill-dither + morphological stroke band)
 *   - dither matrix: src/engine/dither.ts (8×8 Bayer)
 *
 * The engine runs server-side via sharp; here we rasterize with the browser's
 * 2D canvas. Grayscale luma is an approximation of sharp().grayscale() — exact
 * channel weights differ slightly, but the threshold (bwLevel) is user-tunable
 * and the dither convention already tolerates approximation on the canvas.
 *
 * Pixel addressing matches the engine: the Bayer pattern is indexed by the
 * element's GLOBAL artboard coordinate (posX/posY + col/row), so the dither
 * phase lines up with the rendered preview.
 */

// ── Dither (mirror src/engine/dither.ts) ───────────────────────

const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

const BAYER_NORMALIZED = BAYER_8X8.map((row) => row.map((v) => (v / 63) * 100));

/**
 * Determine if a pixel at (x, y) should be black given a dither level (0–100).
 * Identical to the engine's shouldDitherPixel.
 */
export function shouldDitherPixel(x, y, level) {
  if (level <= 0) return false;
  if (level >= 100) return true;
  const threshold = BAYER_NORMALIZED[y & 7][x & 7];
  return level > threshold;
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Approximate luminance of an sRGB pixel (Rec.601 weights). Stands in for the
 * engine's sharp().grayscale(); close enough for a 1-bit threshold preview.
 */
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Rasterize a loaded HTMLImageElement into a w×h ImageData using the engine's
 * `fit: contain` over a white background (flatten + centered letterbox).
 * Returns null if the canvas is tainted (cross-origin source without CORS) so
 * callers can fall back to showing the raw image.
 *
 * @param {CanvasImageSource} image
 * @param {number} w
 * @param {number} h
 * @param {number} iw - intrinsic source width
 * @param {number} ih - intrinsic source height
 * @returns {ImageData|null}
 */
function rasterizeContain(image, w, h, iw, ih) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // flatten({ background: white }) — transparent areas become white.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  if (iw > 0 && ih > 0) {
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.drawImage(image, dx, dy, dw, dh);
  } else {
    // No intrinsic size — stretch to fill (best effort).
    ctx.drawImage(image, 0, 0, w, h);
  }

  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas (cross-origin image without CORS headers).
    return null;
  }
}

/** Write a black/white pixel into an RGBA buffer, honoring opacity dithering. */
function putPixel(out, oi, value /* 1=black,0=white */, px, py, opacity) {
  const write = opacity >= 100 ? true : opacity > 0 && shouldDitherPixel(px, py, opacity);
  if (!write) {
    out[oi + 3] = 0; // opacity skip → leave transparent (underlying content shows)
    return;
  }
  const v = value === 1 ? 0 : 255;
  out[oi] = v;
  out[oi + 1] = v;
  out[oi + 2] = v;
  out[oi + 3] = 255;
}

// ── img conversion (mirror img.ts) ─────────────────────────────

/**
 * Convert a loaded raster image to a 1-bit HTMLCanvasElement, mirroring img.ts.
 * Every pixel in the box is written opaque black or white (matching the engine,
 * which overwrites underlying content with white where the image is light).
 *
 * @returns {HTMLCanvasElement|null} null if size invalid or source tainted.
 */
export function renderImage1bit({
  image,
  width,
  height,
  posX = 0,
  posY = 0,
  bwMode = 'threshold',
  bwLevel = 50,
  opacity = 100,
}) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!image || w <= 0 || h <= 0) return null;

  const iw = image.naturalWidth || image.width || 0;
  const ih = image.naturalHeight || image.height || 0;
  const src = rasterizeContain(image, w, h, iw, ih);
  if (!src) return null;
  const sd = src.data;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const outImg = octx.createImageData(w, h);
  const od = outImg.data;

  const threshold = Math.round((bwLevel / 100) * 255);
  const x0 = Math.round(posX);
  const y0 = Math.round(posY);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      const gray = luma(sd[i], sd[i + 1], sd[i + 2]);
      const px = x0 + col;
      const py = y0 + row;
      const isBlack =
        bwMode === 'dither'
          ? shouldDitherPixel(px, py, Math.round((1 - gray / 255) * 100))
          : gray < threshold;
      putPixel(od, i, isBlack ? 1 : 0, px, py, opacity);
    }
  }

  octx.putImageData(outImg, 0, 0);
  return out;
}

// ── SVG morphology (mirror svg.ts) ─────────────────────────────

function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return mask.slice();
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
          if (mask[ny * width + nx] === 1) {
            hit = 1;
            break;
          }
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

function erodeMask(mask, width, height, radius) {
  if (radius <= 0) return mask.slice();
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
          if (nx < 0 || nx >= width || mask[ny * width + nx] === 0) {
            keep = 0;
            break;
          }
        }
      }
      out[y * width + x] = keep;
    }
  }
  return out;
}

function subtractMask(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === 1 && b[i] === 0 ? 1 : 0;
  return out;
}

function unionMask(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === 1 || b[i] === 1 ? 1 : 0;
  return out;
}

/**
 * Build the morphological stroke band mask, mirroring svg.ts strokeMask logic.
 * Radius is in display pixels (the raster is already at display size).
 */
function buildStrokeMask(shapeMask, w, h, strokeWidth, strokePosition) {
  const sw = Math.max(1, Math.round(strokeWidth));
  let insideRadius = 0;
  let outsideRadius = 0;
  if (strokePosition === 'inside') {
    insideRadius = sw;
  } else if (strokePosition === 'outside') {
    outsideRadius = sw;
  } else {
    insideRadius = Math.ceil(sw / 2);
    outsideRadius = Math.floor(sw / 2);
  }

  const insideBand =
    insideRadius > 0
      ? subtractMask(shapeMask, erodeMask(shapeMask, w, h, insideRadius))
      : new Uint8Array(w * h);
  const outsideBand =
    outsideRadius > 0
      ? subtractMask(dilateMask(shapeMask, w, h, outsideRadius), shapeMask)
      : new Uint8Array(w * h);

  return unionMask(insideBand, outsideBand);
}

// ── svg conversion (mirror svg.ts) ─────────────────────────────

/**
 * Convert a loaded, rasterizable SVG image to a 1-bit HTMLCanvasElement,
 * mirroring svg.ts. With neither fill nor stroke enabled this is a plain
 * threshold/dither (like img). Otherwise it dither-fills the shape silhouette
 * (gray < threshold) at `fill` and composites a morphological stroke band at
 * `strokeDither`, leaving non-shape/non-stroke pixels transparent — exactly as
 * the engine leaves the underlying canvas untouched there.
 *
 * @param {object} opts
 * @param {CanvasImageSource} opts.image - loaded SVG image
 * @param {number} [opts.intrinsicW] - SVG aspect width (viewBox), for contain fit
 * @param {number} [opts.intrinsicH] - SVG aspect height (viewBox), for contain fit
 * @returns {HTMLCanvasElement|null}
 */
export function renderSvg1bit({
  image,
  width,
  height,
  intrinsicW = 0,
  intrinsicH = 0,
  posX = 0,
  posY = 0,
  bwMode = 'threshold',
  bwLevel = 50,
  enableFill = false,
  fill = 100,
  enableStroke = false,
  strokeDither = 100,
  strokeWidth = 1,
  strokePosition = 'center',
  opacity = 100,
}) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!image || w <= 0 || h <= 0) return null;

  const iw = intrinsicW > 0 ? intrinsicW : image.naturalWidth || image.width || 0;
  const ih = intrinsicH > 0 ? intrinsicH : image.naturalHeight || image.height || 0;
  const src = rasterizeContain(image, w, h, iw, ih);
  if (!src) return null;
  const sd = src.data;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const outImg = octx.createImageData(w, h);
  const od = outImg.data;

  const threshold = Math.round((bwLevel / 100) * 255);
  const x0 = Math.round(posX);
  const y0 = Math.round(posY);

  // Plain 1-bit conversion when neither fill nor stroke is active.
  if (!enableFill && !enableStroke) {
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        const gray = luma(sd[i], sd[i + 1], sd[i + 2]);
        const px = x0 + col;
        const py = y0 + row;
        const isBlack =
          bwMode === 'dither'
            ? shouldDitherPixel(px, py, Math.round((1 - gray / 255) * 100))
            : gray < threshold;
        putPixel(od, i, isBlack ? 1 : 0, px, py, opacity);
      }
    }
    octx.putImageData(outImg, 0, 0);
    return out;
  }

  // shapeMask = dark pixels of the rasterized SVG.
  const shapeMask = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      shapeMask[row * w + col] = luma(sd[i], sd[i + 1], sd[i + 2]) < threshold ? 1 : 0;
    }
  }

  const strokeMask =
    enableStroke && strokeWidth > 0
      ? buildStrokeMask(shapeMask, w, h, strokeWidth, strokePosition)
      : new Uint8Array(w * h);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const m = row * w + col;
      const i = m * 4;
      const px = x0 + col;
      const py = y0 + row;

      let wrote = false;
      if (enableFill && shapeMask[m] === 1) {
        putPixel(od, i, shouldDitherPixel(px, py, fill) ? 1 : 0, px, py, opacity);
        wrote = true;
      }
      if (enableStroke && strokeMask[m] === 1) {
        // Stroke overwrites fill where they overlap (engine order).
        putPixel(od, i, shouldDitherPixel(px, py, strokeDither) ? 1 : 0, px, py, opacity);
        wrote = true;
      }
      if (!wrote) od[i + 3] = 0; // untouched → transparent
    }
  }

  octx.putImageData(outImg, 0, 0);
  return out;
}
