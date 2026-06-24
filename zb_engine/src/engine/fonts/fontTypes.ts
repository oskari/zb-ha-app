/**
 * fontTypes.ts — Interfaces for bitmap font data
 */

/** A single glyph's metrics and pixel data as stored in the JSON file. */
export interface RawGlyph {
  codePoint: number;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  baseline: number;
  bitmap: string; // base64-encoded 1-bit packed rows
}

/** Decoded glyph ready for blitting. */
export interface DecodedGlyph {
  codePoint: number;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  baseline: number;
  /** Decoded 1-bit packed pixel data. MSB first, row-major. */
  pixels: Uint8Array;
}

/** Font file metadata. */
export interface FontMeta {
  font: string;
  familyName: string;
  variant: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  glyphCount: number;
}

/** A loaded font pack: metadata + decoded glyphs keyed by character. */
export interface FontPack {
  meta: FontMeta;
  glyphs: Map<string, DecodedGlyph>;
}

/** Available font weight names mapped from the file naming convention. */
export type FontWeightName = "Light" | "Regular" | "SemiBold" | "ExtraBold";
