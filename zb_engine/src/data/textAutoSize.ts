/**
 * textAutoSize.ts — Expand text element bounding boxes to fit resolved content
 *
 * After data sources are fetched and bindings can be resolved, text elements
 * may contain dynamic values that are wider/taller than the static sizeX/sizeY
 * baked into the payload at deploy time. This module measures the resolved text
 * using the same bitmap font metrics as the draw engine and expands (never
 * shrinks) the bounding box so that no glyphs are clipped.
 *
 * This runs in the render pipeline (renderService.ts), between source fetching
 * and the engine's render() call. It does NOT modify any engine code — it only
 * patches the element records that are passed into the engine.
 */

import { resolveValue, type DataContext } from "@zb/expressions";
import { getFontForFamily, fontsReady } from "../engine/fonts/fontManager";
import type { FontPack, DecodedGlyph } from "../engine/fonts/fontTypes";

// ── Helpers ────────────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function str(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

// ── Text measurement (mirrors engine text.ts layout logic) ─────

/**
 * Measure the visual pixel width of a single line, including the last
 * glyph's overhang beyond its xAdvance.  This matches the builder's
 * measureLineVisual() and reflects the actual pixel extent that would
 * be clipped by the engine's blitGlyphClipped().
 */
function measureLineVisual(line: string, font: FontPack): number {
  let width = 0;
  let lastGlyphOverhang = 0;

  for (const char of line) {
    const glyph = font.glyphs.get(char);
    if (glyph) {
      lastGlyphOverhang = Math.max(0, glyph.xOffset + glyph.width - glyph.xAdvance);
      width += glyph.xAdvance + font.meta.letterSpacing;
    } else {
      const space = font.glyphs.get(" ");
      width += space?.xAdvance ?? Math.round(font.meta.fontSize * 0.3);
      lastGlyphOverhang = 0;
    }
  }

  if (line.length > 0) width -= font.meta.letterSpacing;
  return width + lastGlyphOverhang;
}

/**
 * Measure the pixel bounds required to render a text string without clipping.
 * Mirrors the builder's measureTextBounds() with the same 4 px padding.
 */
function measureText(
  text: string,
  font: FontPack,
  fontSize: number,
  lineHeight: number,
): { width: number; height: number } {
  const lines = text.split("\n");
  const lineSpacing = Math.round(fontSize * lineHeight);

  let maxLineWidth = 0;
  for (const line of lines) {
    const w = measureLineVisual(line, font);
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const padding = 4;
  return {
    width: maxLineWidth + padding,
    height: lines.length * lineSpacing + padding,
  };
}

// ── Resolve text value (mirrors engine elementResolver.ts) ─────

/**
 * Resolve a text element's display string the same way the engine does:
 * resolve the binding, fall back to fallbackText, then coerce to string.
 */
function resolveTextValue(el: Record<string, unknown>, ctx: DataContext): string {
  let text = resolveValue(el.text, ctx);
  const fallback = str(resolveValue(el.fallbackText, ctx) as string, "");

  if (text === null || text === undefined || text === "") {
    text = fallback;
  }

  return str(text, "");
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Walk the element array and expand sizeX/sizeY on text elements whose
 * resolved content exceeds the stored bounding box.  Non-text elements
 * are returned unchanged.  Bounding boxes are only grown, never shrunk,
 * so the user's intentional layout (center/right alignment anchoring)
 * is preserved when the live value is shorter than the design-time value.
 */
export async function expandTextBounds(
  elements: Record<string, unknown>[],
  ctx: DataContext,
): Promise<Record<string, unknown>[]> {
  await fontsReady;

  return elements.map((el) => {
    if (el.type !== "text") return el;

    const textStr = resolveTextValue(el, ctx);
    if (!textStr) return el;

    const fontSize = num(el.fontSize, 16);
    const fontWeight = num(el.fontWeight, 400);
    const fontFamily = str(el.fontFamily, "sans-serif");
    const lineHeight = num(el.lineHeight, 1.2);

    const font = getFontForFamily(fontFamily, fontSize, fontWeight);
    if (!font) return el;

    const measured = measureText(textStr, font, fontSize, lineHeight);

    const currentW = num(el.sizeX, 0);
    const currentH = num(el.sizeY, 0);

    // Expand only — never shrink
    if (measured.width <= currentW && measured.height <= currentH) return el;

    return {
      ...el,
      sizeX: Math.max(currentW, measured.width),
      sizeY: Math.max(currentH, measured.height),
    };
  });
}
