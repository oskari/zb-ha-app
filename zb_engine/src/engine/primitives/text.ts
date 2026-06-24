/**
 * text.ts — Text primitive (bitmap font renderer)
 */

import { Canvas } from "../canvas";
import { TextProps } from "../types";
import { getFontForFamily } from "../fonts/fontManager";
import { blitGlyphClipped } from "../fonts/glyphRenderer";
import { DecodedGlyph } from "../fonts/fontTypes";

export function drawText(canvas: Canvas, props: TextProps): void {
  const { text, pos, sizeX, sizeY, fontSize, fontWeight, textAlign, lineHeight, fill, opacity } = props;

  if (!text || sizeX <= 0 || sizeY <= 0) return;

  const font = getFontForFamily(props.fontFamily, fontSize, fontWeight);
  if (!font) return;

  const x0 = Math.round(pos.x);
  const y0 = Math.round(pos.y);
  const w = Math.round(sizeX);
  const h = Math.round(sizeY);

  const sampleGlyph = font.glyphs.values().next().value as DecodedGlyph | undefined;
  const baseline = sampleGlyph?.baseline ?? Math.round(fontSize * 0.75);

  const lines = text.split("\n");
  const lineSpacing = Math.round(fontSize * lineHeight);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineY = y0 + lineIdx * lineSpacing;

    if (lineY >= y0 + h) break;

    let lineWidth = 0;
    for (const char of line) {
      const glyph = font.glyphs.get(char);
      if (glyph) {
        lineWidth += glyph.xAdvance + font.meta.letterSpacing;
      }
    }
    if (line.length > 0) lineWidth -= font.meta.letterSpacing;

    let cursorX: number;
    if (textAlign === "center") {
      cursorX = x0 + Math.round((w - lineWidth) / 2);
    } else if (textAlign === "right") {
      cursorX = x0 + w - lineWidth;
    } else {
      cursorX = x0;
    }

    for (const char of line) {
      const glyph = font.glyphs.get(char);
      if (!glyph) {
        const spaceGlyph = font.glyphs.get(" ");
        cursorX += spaceGlyph?.xAdvance ?? Math.round(fontSize * 0.3);
        continue;
      }

      if (cursorX >= x0 + w) break;

      blitGlyphClipped(canvas, glyph, cursorX, lineY + baseline - glyph.baseline, fill, opacity, x0, y0, w, h);
      cursorX += glyph.xAdvance + font.meta.letterSpacing;
    }
  }
}
