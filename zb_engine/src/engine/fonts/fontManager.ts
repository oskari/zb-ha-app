/**
 * fontManager.ts — Load and cache bitmap fonts, resolve by family + size + weight
 *
 * Loads all bundled Latin fonts at init time from fonts/latin/*.json.
 * Font file naming convention: Sora_{size}px_{weight}.json
 * Weights: Light (300), Regular (400), SemiBold (600), ExtraBold (800)
 * Sizes:   10, 12, 16, 20, 26, 34, 44, 56
 *
 * Note: 14px has no font file — requests snap to 12px.
 *       12px Regular has no font file — requests snap to 12px Light.
 *       10px is only available in Regular weight.
 * Requested sizes/weights always snap to the nearest available variant.
 */

import * as fs from "fs";
import * as path from "path";
import {
  RawGlyph,
  DecodedGlyph,
  FontPack,
  FontMeta,
  FontWeightName,
} from "./fontTypes";

// ── Weight mapping ─────────────────────────────────────────────

const WEIGHT_ANCHORS: { value: number; name: FontWeightName }[] = [
  { value: 300, name: "Light" },
  { value: 400, name: "Regular" },
  { value: 600, name: "SemiBold" },
  { value: 800, name: "ExtraBold" },
];

function snapWeight(numericWeight: number): FontWeightName {
  let best = WEIGHT_ANCHORS[0];
  let bestDist = Math.abs(numericWeight - best.value);

  for (let i = 1; i < WEIGHT_ANCHORS.length; i++) {
    const candidate = WEIGHT_ANCHORS[i];
    const dist = Math.abs(numericWeight - candidate.value);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }

  return best.name;
}

// ── Font storage ───────────────────────────────────────────────

const fontCache = new Map<string, FontPack>();
let availableSizes: number[] = [];
const availableFamilies = new Set<string>();
let defaultFamily = "sora";
let initialized = false;

// ── Decoding ───────────────────────────────────────────────────

function decodeGlyph(raw: RawGlyph): DecodedGlyph {
  const pixels = Buffer.from(raw.bitmap, "base64");
  return {
    codePoint: raw.codePoint,
    width: raw.width,
    height: raw.height,
    xOffset: raw.xOffset,
    yOffset: raw.yOffset,
    xAdvance: raw.xAdvance,
    baseline: raw.baseline,
    pixels: new Uint8Array(pixels),
  };
}

function loadFontFile(filePath: string): FontPack {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const meta: FontMeta = {
    font: raw.font,
    familyName: raw.familyName,
    variant: raw.variant,
    fontSize: raw.fontSize,
    lineHeight: raw.lineHeight,
    letterSpacing: raw.letterSpacing,
    glyphCount: raw.glyphCount,
  };

  const glyphs = new Map<string, DecodedGlyph>();
  const rawGlyphs = raw.glyphs as Record<string, RawGlyph>;

  for (const [char, rawGlyph] of Object.entries(rawGlyphs)) {
    glyphs.set(char, decodeGlyph(rawGlyph));
  }

  return { meta, glyphs };
}

function parseFontJson(raw: Record<string, unknown>): FontPack {
  const meta: FontMeta = {
    font: raw.font as string,
    familyName: raw.familyName as string,
    variant: raw.variant as string,
    fontSize: raw.fontSize as number,
    lineHeight: raw.lineHeight as number,
    letterSpacing: raw.letterSpacing as number,
    glyphCount: raw.glyphCount as number,
  };

  const glyphs = new Map<string, DecodedGlyph>();
  const rawGlyphs = raw.glyphs as Record<string, RawGlyph>;

  for (const [char, rawGlyph] of Object.entries(rawGlyphs)) {
    glyphs.set(char, decodeGlyph(rawGlyph));
  }

  return { meta, glyphs };
}

// ── Initialization ─────────────────────────────────────────────

/**
 * Font directory — resolved relative to the compiled output location.
 * In the Docker container the layout is:
 *   /usr/src/app/dist/engine/fonts/fontManager.js   (this file, compiled)
 *   /usr/src/app/fonts/latin/*.json                  (font data)
 *
 * __dirname at runtime points to dist/engine/fonts, so we go up 3 levels
 * to reach the project root, then into fonts/latin.
 */
const FONT_DIR = path.resolve(__dirname, "../../../fonts/latin");

function initFonts(): void {
  if (initialized) return;

  if (!fs.existsSync(FONT_DIR)) {
    console.warn(`[FONTS] Font directory not found: ${FONT_DIR}`);
    initialized = true;
    return;
  }

  const files = fs.readdirSync(FONT_DIR).filter((f) => f.endsWith(".json"));
  const sizeSet = new Set<number>();

  const pattern = /^(.+)_(\d+)px_(\w+)\.json$/;

  for (const file of files) {
    const match = file.match(pattern);
    if (!match) continue;

    const family = match[1].toLowerCase();
    const size = parseInt(match[2], 10);
    const weight = match[3] as FontWeightName;
    const key = `${family}-${size}-${weight}`;

    const fontPack = loadFontFile(path.join(FONT_DIR, file));
    fontCache.set(key, fontPack);
    sizeSet.add(size);
    availableFamilies.add(family);
  }

  availableSizes = Array.from(sizeSet).sort((a, b) => a - b);
  if (availableFamilies.size > 0) {
    const families = Array.from(availableFamilies).sort((a, b) => a.localeCompare(b));
    defaultFamily = families[0];
    if (availableFamilies.has("sora")) {
      defaultFamily = "sora";
    }
  }
  console.log(`[FONTS] Loaded ${fontCache.size} font packs from ${FONT_DIR}`);
  initialized = true;
}

async function initFontsAsync(): Promise<void> {
  if (initialized) return;

  try {
    await fs.promises.access(FONT_DIR);
  } catch {
    console.warn(`[FONTS] Font directory not found: ${FONT_DIR}`);
    initialized = true;
    return;
  }

  const allFiles = await fs.promises.readdir(FONT_DIR);
  const files = allFiles.filter((f) => f.endsWith(".json"));
  const sizeSet = new Set<number>();
  const pattern = /^(.+)_(\d+)px_(\w+)\.json$/;

  const loadTasks = files.map(async (file) => {
    const match = file.match(pattern);
    if (!match) return;

    const family = match[1].toLowerCase();
    const size = parseInt(match[2], 10);
    const weight = match[3] as FontWeightName;
    const key = `${family}-${size}-${weight}`;

    const content = await fs.promises.readFile(path.join(FONT_DIR, file), "utf-8");
    const raw = JSON.parse(content);
    const fontPack = parseFontJson(raw);

    fontCache.set(key, fontPack);
    sizeSet.add(size);
    availableFamilies.add(family);
  });

  await Promise.all(loadTasks);

  availableSizes = Array.from(sizeSet).sort((a, b) => a - b);
  if (availableFamilies.size > 0) {
    const families = Array.from(availableFamilies).sort((a, b) => a.localeCompare(b));
    defaultFamily = families[0];
    if (availableFamilies.has("sora")) {
      defaultFamily = "sora";
    }
  }
  console.log(`[FONTS] Loaded ${fontCache.size} font packs from ${FONT_DIR}`);
  initialized = true;
}

/** Eagerly start loading fonts at module import time (non-blocking). */
export const fontsReady: Promise<void> = initFontsAsync();

// ── Size snapping ──────────────────────────────────────────────

function snapSize(requested: number): number {
  if (availableSizes.length === 0) return requested;

  let best = availableSizes[0];
  let bestDist = Math.abs(requested - best);

  for (let i = 1; i < availableSizes.length; i++) {
    const dist = Math.abs(requested - availableSizes[i]);
    if (dist < bestDist) {
      best = availableSizes[i];
      bestDist = dist;
    }
  }

  return best;
}

// ── Public API ─────────────────────────────────────────────────

export function getFontForFamily(
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
): FontPack | null {
  if (!initialized) initFonts();

  if (fontCache.size === 0) return null;

  const requestedFamily = (fontFamily || "").trim().toLowerCase();
  const family = availableFamilies.has(requestedFamily) ? requestedFamily : defaultFamily;
  const size = snapSize(fontSize);
  const weight = snapWeight(fontWeight);
  const exactKey = `${family}-${size}-${weight}`;

  const exact = fontCache.get(exactKey);
  if (exact) return exact;

  for (const candidateFamily of availableFamilies) {
    const candidateKey = `${candidateFamily}-${size}-${weight}`;
    const candidate = fontCache.get(candidateKey);
    if (candidate) return candidate;
  }

  // Weight fallback — try other weights at the same size, closest first.
  // Handles cases like 12px where Regular doesn't exist but Light does.
  const weightNames = WEIGHT_ANCHORS.map((a) => a.name);
  const requestedIdx = weightNames.indexOf(weight);
  for (let offset = 1; offset < weightNames.length; offset++) {
    for (const dir of [-1, 1]) {
      const idx = requestedIdx + dir * offset;
      if (idx < 0 || idx >= weightNames.length) continue;
      const altWeight = weightNames[idx];
      const altKey = `${family}-${size}-${altWeight}`;
      const alt = fontCache.get(altKey);
      if (alt) return alt;
      for (const candidateFamily of availableFamilies) {
        const altFamKey = `${candidateFamily}-${size}-${altWeight}`;
        const altFam = fontCache.get(altFamKey);
        if (altFam) return altFam;
      }
    }
  }

  return null;
}
