/**
 * BitmapText.jsx — Konva component that renders text using actual bitmap fonts
 *
 * Replaces Konva <Text> to produce pixel-accurate previews matching the
 * draw engine's bitmap font rendering (src/engine/primitives/text.ts).
 *
 * Props mirror Konva <Text> for easy drop-in replacement:
 *   text, x, y, width, height, fontSize, fontFamily, fontStyle (weight),
 *   align, lineHeight, fill, listening, opacity
 *
 * Falls back to Konva <Text> if bitmap fonts are not yet loaded.
 */

import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Text } from 'react-konva';
import { renderBitmapText, fontsReady } from '../utils/bitmapFont.js';
import { useUiStore } from '../store/uiStore.js';

/**
 * Parse a numeric font weight from fontStyle string.
 * Konva <Text> uses fontStyle for both style ("italic") and weight ("600").
 * @param {string|number|undefined} fontStyle
 * @returns {number}
 */
function parseFontWeight(fontStyle) {
  if (typeof fontStyle === 'number') return fontStyle;
  if (typeof fontStyle === 'string') {
    const n = parseInt(fontStyle, 10);
    if (!isNaN(n)) return n;
  }
  return 400;
}

/**
 * Default a falsy fill to black; otherwise pass the value through unchanged.
 * Callers pass rgb()/hex strings (or undefined), so no color conversion is
 * needed here.
 * @param {string|undefined} fill
 * @returns {string}
 */
function normalizeFill(fill) {
  if (!fill) return '#000000';
  return fill;
}

export default function BitmapText({
  text,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fontSize = 16,
  fontFamily = 'Sora',
  fontStyle,
  fontWeight,
  align = 'left',
  lineHeight = 1.0,
  fill = '#000000',
  listening,
  opacity,
  // Pass through any other Konva node props (ref, visible, rotation, etc.)
  ...rest
}) {
  const imageRef = useRef(null);
  const [canvas, setCanvas] = useState(null);

  // Subscribe to font-loading state so the effect re-runs when fonts become ready.
  const fontsLoaded = useUiStore((s) => s.bitmapFontsLoaded);

  const weight = fontWeight ?? parseFontWeight(fontStyle);
  const color = normalizeFill(fill);

  useEffect(() => {
    if (!fontsLoaded || !fontsReady() || !text || width <= 0 || height <= 0) {
      setCanvas(null);
      return;
    }

    const result = renderBitmapText({
      text,
      width,
      height,
      fontSize,
      fontWeight: weight,
      fontFamily,
      textAlign: align,
      lineHeight,
      color,
    });

    setCanvas(result);
  }, [fontsLoaded, text, width, height, fontSize, weight, fontFamily, align, lineHeight, color]);

  // Force Konva node to redraw when canvas changes
  useEffect(() => {
    if (imageRef.current) {
      imageRef.current.getLayer()?.batchDraw();
    }
  }, [canvas]);

  // Fallback to Konva <Text> when bitmap fonts aren't loaded
  if (!fontsReady() || !canvas) {
    return (
      <Text
        x={x}
        y={y}
        width={width}
        height={height}
        text={text}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fontStyle={String(weight)}
        align={align}
        lineHeight={lineHeight}
        fill={fill}
        listening={listening}
        opacity={opacity}
        {...rest}
      />
    );
  }

  return (
    <KonvaImage
      ref={imageRef}
      x={x}
      y={y}
      width={width}
      height={height}
      image={canvas}
      listening={listening}
      opacity={opacity}
      hitFunc={listening !== false ? (context, shape) => {
        context.beginPath();
        context.rect(0, 0, shape.width(), shape.height());
        context.closePath();
        context.fillStrokeShape(shape);
      } : undefined}
      {...rest}
    />
  );
}
