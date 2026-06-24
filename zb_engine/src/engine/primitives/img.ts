/**
 * img.ts — Raster image primitive
 */

import sharp from "sharp";
import { Canvas } from "../canvas";
import { ImgProps } from "../types";
import { shouldDitherPixel, setWithOpacity } from "../dither";
import {
  fetchBufferWithLimit,
  IMAGE_FETCH_TIMEOUT_MS,
  MAX_IMAGE_FETCH_BYTES,
} from "./assetLimits";

export async function drawImg(canvas: Canvas, props: ImgProps): Promise<void> {
  const { src, pos, sizeX, sizeY, bwMode, bwLevel, opacity } = props;

  if (!src || sizeX <= 0 || sizeY <= 0) return;

  const w = Math.round(sizeX);
  const h = Math.round(sizeY);
  const x0 = Math.round(pos.x);
  const y0 = Math.round(pos.y);

  const imgBuffer = await fetchBufferWithLimit(
    src,
    "Image source",
    MAX_IMAGE_FETCH_BYTES,
    IMAGE_FETCH_TIMEOUT_MS,
  );

  const { data, info } = await sharp(imgBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(w, h, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const threshold = Math.round((bwLevel / 100) * 255);

  for (let row = 0; row < info.height && row < h; row++) {
    for (let col = 0; col < info.width && col < w; col++) {
      const gray = data[row * info.width + col];
      const px = x0 + col;
      const py = y0 + row;

      let isBlack: boolean;
      if (bwMode === "dither") {
        isBlack = shouldDitherPixel(px, py, Math.round((1 - gray / 255) * 100));
      } else {
        isBlack = gray < threshold;
      }

      if (isBlack) {
        setWithOpacity(canvas, px, py, 1, opacity);
      } else {
        setWithOpacity(canvas, px, py, 0, opacity);
      }
    }
  }
}
