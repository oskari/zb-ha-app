/**
 * ImagePreview.jsx — Konva component for rendering img/svg elements on the canvas
 *
 * Renders a preview of image and SVG elements that matches the render engine's
 * 1-bit output (threshold/dither, fill silhouette, morphological stroke band)
 * rather than the raw full-color source. Shows a placeholder rectangle when the
 * source is empty or fails to load.
 *
 * Pipeline:
 *   1. Load src URL (img) or inline/url SVG (svg) into an HTMLImageElement.
 *   2. Convert it to a 1-bit HTMLCanvasElement via utils/oneBitImage.js, which
 *      mirrors src/engine/primitives/{img,svg}.ts exactly.
 *   3. Draw the converted canvas through <KonvaImage>.
 * Falls back to the raw image when pixel conversion is impossible (e.g. a
 * cross-origin source taints the canvas), so the element still displays.
 */

import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import { renderImage1bit, renderSvg1bit } from '../utils/oneBitImage.js';

/**
 * Load an image from a URL, returning a promise of the HTMLImageElement.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}

/**
 * Convert inline SVG content to a blob URL for rendering.
 *
 * When an SVG is loaded as a standalone document (via a blob URL into an
 * HTMLImageElement), the browser requires xmlns on the root <svg> element.
 * SVGs designed for HTML inline embedding often omit it, which causes
 * the browser to treat the document as plain XML and fire onerror.
 * Injects xmlns if absent.
 *
 * @param {string} svgContent
 * @returns {string}
 */
function svgToBlobUrl(svgContent) {
  let content = svgContent;
  const svgTagStart = content.indexOf('<svg');
  if (svgTagStart !== -1) {
    const openEnd = content.indexOf('>', svgTagStart);
    if (openEnd !== -1 && !content.slice(svgTagStart, openEnd).includes('xmlns=')) {
      // Insert xmlns immediately after "<svg" so existing attributes are preserved
      content =
        content.slice(0, svgTagStart + 4) +
        ' xmlns="http://www.w3.org/2000/svg"' +
        content.slice(svgTagStart + 4);
    }
  }
  const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Parse the viewBox dimensions from an SVG string.
 * Returns { vbW, vbH } in user units, or null if absent/unparseable.
 * Used as the SVG's intrinsic aspect ratio for the engine's `fit: contain`
 * letterbox (browser naturalWidth/Height is unreliable for viewBox-only SVGs).
 *
 * @param {string} svgContent
 * @returns {{ vbW: number, vbH: number } | null}
 */
function parseSvgViewBox(svgContent) {
  const match = svgContent.match(/viewBox\s*=\s*["'][\s,]*[\d.+-]+[\s,]+[\d.+-]+[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)["']/i);
  if (!match) return null;
  const vbW = parseFloat(match[1]);
  const vbH = parseFloat(match[2]);
  if (!isFinite(vbW) || !isFinite(vbH) || vbW <= 0 || vbH <= 0) return null;
  return { vbW, vbH };
}

/**
 * Placeholder — dashed rectangle with type label, shown when no image is available.
 */
function Placeholder({ width, height, label }) {
  return (
    <Group>
      <Rect
        width={width}
        height={height}
        fill="#f5f5f5"
        stroke="#999"
        strokeWidth={1}
        dash={[4, 4]}
      />
      {/* Diagonal cross lines */}
      <Line points={[0, 0, width, height]} stroke="#ccc" strokeWidth={1} listening={false} />
      <Line points={[width, 0, 0, height]} stroke="#ccc" strokeWidth={1} listening={false} />
      <Text
        x={0}
        y={height / 2 - 6}
        width={width}
        text={label}
        fontSize={11}
        fontFamily="system-ui, sans-serif"
        fill="#999"
        align="center"
        listening={false}
      />
    </Group>
  );
}

/**
 * ImagePreview — renders img or svg elements on the Konva canvas as 1-bit.
 *
 * Props (spread from getCommonNodeProps + element data):
 * @param {object} props
 * @param {string} props.elementType - 'img' or 'svg'
 * @param {string} [props.src] - URL source (for img or svg-from-url)
 * @param {string} [props.svgData] - Inline SVG content (for svg elements)
 * @param {number} props.width - Display width
 * @param {number} props.height - Display height
 * @param {number} [props.posX] - Element artboard X (aligns dither phase to the engine)
 * @param {number} [props.posY] - Element artboard Y
 * @param {string} [props.bwMode] - 'threshold' | 'dither'
 * @param {number} [props.bwLevel] - Black/white level 0–100
 * @param {boolean} [props.enableFill] - Fill the shape silhouette (svg only)
 * @param {number} [props.fill] - Fill dither intensity 0–100 (svg only)
 * @param {boolean} [props.enableStroke] - Whether to render a stroke outline (svg only)
 * @param {number} [props.strokeDither] - Stroke intensity 0–100 (svg only)
 * @param {number} [props.strokeWidth] - Stroke width in px (svg only)
 * @param {string} [props.strokePosition] - 'inside'|'outside'|'center' (svg only)
 */
export default function ImagePreview({
  elementType,
  src,
  svgData,
  width,
  height,
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
}) {
  const [image, setImage] = useState(null);
  // The 1-bit converted canvas (null until ready, or when conversion is skipped/failed).
  const [processed, setProcessed] = useState(null);
  // Tracks whether the most recent load attempt ended in an error, so the
  // placeholder can show a distinct "failed" label instead of the generic empty one.
  const [loadFailed, setLoadFailed] = useState(false);
  const blobUrlRef = useRef(null);
  const imageRef = useRef(null);
  // Debounce timer for inline SVG loads — prevents a blob URL creation/revoke
  // cascade on every keystroke while the user is editing the SVG textarea.
  const debounceRef = useRef(null);

  // ── Load the source into an HTMLImageElement ──────────────────
  useEffect(() => {
    setLoadFailed(false);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    let cancelled = false;

    async function load() {
      let url = '';

      if (elementType === 'svg' && svgData) {
        // Inline SVG → blob URL. No stroke filter is injected here: the stroke
        // band (and fill silhouette) are composited in pixel space by
        // renderSvg1bit, matching the engine exactly.
        const blobUrl = svgToBlobUrl(svgData);
        blobUrlRef.current = blobUrl;
        url = blobUrl;
      } else if (src) {
        url = src;
      }

      if (!url) {
        if (!cancelled) setImage(null);
        return;
      }

      try {
        const img = await loadImage(url);
        if (!cancelled) setImage(img);
      } catch {
        if (!cancelled) {
          setImage(null);
          setLoadFailed(true);
        }
      }
    }

    // Debounce inline SVG loads to absorb rapid updates while the user edits the
    // SVG textarea. URL-based sources only change on explicit user action.
    if (elementType === 'svg' && svgData) {
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        load();
      }, 300);
    } else {
      load();
    }

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [elementType, src, svgData]);

  // ── Convert the loaded image to 1-bit (mirrors the engine) ────
  useEffect(() => {
    if (!image) {
      setProcessed(null);
      return;
    }

    let canvas = null;
    if (elementType === 'svg') {
      const vb = svgData ? parseSvgViewBox(svgData) : null;
      canvas = renderSvg1bit({
        image,
        width,
        height,
        intrinsicW: vb?.vbW ?? 0,
        intrinsicH: vb?.vbH ?? 0,
        posX,
        posY,
        bwMode,
        bwLevel,
        enableFill,
        fill,
        enableStroke,
        strokeDither,
        strokeWidth,
        strokePosition,
      });
    } else {
      canvas = renderImage1bit({
        image,
        width,
        height,
        posX,
        posY,
        bwMode,
        bwLevel,
      });
    }

    // canvas is null when conversion is impossible (e.g. a cross-origin source
    // taints the canvas); fall through to the raw-image fallback in render.
    setProcessed(canvas);
  }, [
    image,
    elementType,
    svgData,
    width,
    height,
    posX,
    posY,
    bwMode,
    bwLevel,
    enableFill,
    fill,
    enableStroke,
    strokeDither,
    strokeWidth,
    strokePosition,
  ]);

  // Force Konva to redraw when the converted canvas changes.
  useEffect(() => {
    imageRef.current?.getLayer()?.batchDraw();
  }, [processed]);

  if (!image) {
    const label = elementType === 'svg'
      ? (loadFailed ? 'SVG load failed' : '📐 SVG')
      : (loadFailed ? 'Image load failed' : '🖼️ Image');
    return <Placeholder width={width} height={height} label={label} />;
  }

  // Prefer the 1-bit conversion; fall back to the raw image only when conversion
  // was not possible (keeps cross-origin sources visible).
  return (
    <KonvaImage
      ref={imageRef}
      image={processed ?? image}
      width={width}
      height={height}
      listening={false}
    />
  );
}
