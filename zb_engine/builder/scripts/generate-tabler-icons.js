#!/usr/bin/env node
/**
 * generate-tabler-icons.js — Extract Tabler icon SVG data into a compact JSON file
 *
 * Reads all SVG files from @tabler/icons (outline + filled styles), extracts the
 * inner SVG content, and writes a compact JSON index. Also embeds tag arrays from
 * @tabler/icons/icons.json to enable tag-based search in the IconPickerModal.
 *
 * Output: builder/src/data/tabler-icons.json
 * Format: {
 *   "version": "3.41.1",
 *   "license": "MIT",
 *   "copyright": "Copyright (c) 2020-2026 Paweł Kuna",
 *   "source": "https://github.com/tabler/tabler-icons",
 *   "count": 6092,
 *   "icons": {
 *     "sun": { "d": "<path d=\"...\"/>...", "t": ["light","day","weather",...] },
 *     "sun-filled": { "d": "<path .../>...", "t": ["light","day","weather",...] }
 *   }
 * }
 *
 * Each icon entry uses compact keys:
 *   "d" — inner SVG content (the drawable paths/shapes)
 *   "t" — tag array for search (e.g. ["accept","yes","tick","done"] for circle-check)
 *
 * Tabler icons are stroke-based (outline) or fill-based (filled). The inner SVG
 * content preserves each icon's individual path/stroke/fill attributes so the
 * wrapper <svg> can use generic defaults.
 *
 * Usage: node scripts/generate-tabler-icons.js
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract inner SVG content from a complete SVG file string.
 * Strips the outer <svg ...> wrapper and the invisible bounding-box path.
 */
function extractInnerSvg(svgText) {
  // Remove the <svg ...> opening tag
  const openEnd = svgText.indexOf('>');
  if (openEnd === -1) return '';

  // Remove </svg> closing tag
  let inner = svgText.slice(openEnd + 1).replace(/<\/svg>\s*#?\s*$/, '');

  // Strip the invisible bounding-box path that Tabler adds to every icon
  inner = inner.replace(/<path\s+stroke="none"\s+d="M0 0h24v24H0z"\s+fill="none"\s*\/>/g, '');

  // Collapse whitespace
  inner = inner.replace(/\n\s*/g, '').trim();

  return inner;
}

/**
 * Read all SVG files from a directory and return { name → innerSvg } entries.
 * @param {string} dir   Absolute path to icon directory
 * @param {string} suffix  Optional suffix to append (e.g. "-filled")
 */
function readIconDir(dir, suffix = '') {
  const icons = {};
  let count = 0;

  let files;
  try {
    files = readdirSync(dir);
  } catch {
    console.warn(`  Skipping ${dir} (not found)`);
    return { icons, count };
  }

  for (const file of files) {
    if (!file.endsWith('.svg')) continue;

    const name = basename(file, '.svg') + suffix;
    const svgText = readFileSync(resolve(dir, file), 'utf-8');
    const inner = extractInnerSvg(svgText);

    if (inner) {
      icons[name] = inner;
      count++;
    }
  }

  return { icons, count };
}

/**
 * Load the tag map from @tabler/icons/icons.json.
 * Returns a map of { iconName → string[] } containing search tags.
 * Filled variants inherit the same tags as their base outline icon.
 *
 * @param {string} pkgDir  Absolute path to the @tabler/icons package directory
 * @returns {Record<string, string[]>}
 */
function loadTagMap(pkgDir) {
  const tagMap = {};
  try {
    const raw = readFileSync(resolve(pkgDir, 'icons.json'), 'utf-8');
    const meta = JSON.parse(raw);
    for (const [name, entry] of Object.entries(meta)) {
      if (Array.isArray(entry.tags)) {
        // Store tags as lowercase strings only (some entries include numbers)
        tagMap[name] = entry.tags.filter((t) => typeof t === 'string');
        // Pre-populate the filled variant with the same tags
        tagMap[`${name}-filled`] = tagMap[name];
      }
    }
  } catch (err) {
    console.warn('Could not load tags from icons.json:', err.message);
  }
  return tagMap;
}

function main() {
  const pkgDir = resolve(__dirname, '..', 'node_modules', '@tabler', 'icons');

  // Read version from package.json
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8'));
    version = pkg.version ?? 'unknown';
  } catch {
    console.warn('Could not read @tabler/icons version');
  }

  console.log(`Generating Tabler icons (v${version})...`);

  // Read outline icons (the primary set)
  const outlineDir = resolve(pkgDir, 'icons', 'outline');
  console.log(`  Reading outline icons from ${outlineDir}`);
  const outline = readIconDir(outlineDir);
  console.log(`  Found ${outline.count} outline icons`);

  // Read filled icons (appended with -filled suffix)
  const filledDir = resolve(pkgDir, 'icons', 'filled');
  console.log(`  Reading filled icons from ${filledDir}`);
  const filled = readIconDir(filledDir, '-filled');
  console.log(`  Found ${filled.count} filled icons`);

  // Load tags from icons.json (name → string[] map)
  console.log('  Loading tags from icons.json...');
  const tagMap = loadTagMap(pkgDir);
  console.log(`  Tags loaded for ${Object.keys(tagMap).length} icon variants`);

  // Merge (outline first, filled second — outline takes priority on name clash)
  // Convert each value to { d: svgInner, t: tags[] } format
  const allIcons = {};
  for (const [name, svgData] of Object.entries({ ...outline.icons, ...filled.icons })) {
    allIcons[name] = {
      d: svgData,
      t: tagMap[name] ?? [],
    };
  }
  const totalCount = Object.keys(allIcons).length;

  // Keep upstream attribution attached to the generated data. Tabler Icons is
  // MIT; read the copyright line from the installed package's LICENSE so it
  // tracks the pinned version, falling back to a known-good static line.
  let copyright = 'Copyright (c) 2020-2026 Paweł Kuna';
  try {
    const licenseText = readFileSync(resolve(pkgDir, 'LICENSE'), 'utf-8');
    const match = licenseText.match(/^Copyright .+$/m);
    if (match) copyright = match[0].trim();
  } catch {
    console.warn('Could not read @tabler/icons LICENSE; using fallback copyright line');
  }

  const output = {
    version,
    license: 'MIT',
    copyright,
    source: 'https://github.com/tabler/tabler-icons',
    count: totalCount,
    icons: allIcons,
  };

  const outDir = resolve(__dirname, '..', 'src', 'data');
  mkdirSync(outDir, { recursive: true });

  const outPath = resolve(outDir, 'tabler-icons.json');
  writeFileSync(outPath, JSON.stringify(output));

  console.log(`Generated ${totalCount} icons → ${outPath}`);
  console.log(`File size: ${(JSON.stringify(output).length / 1024 / 1024).toFixed(2)} MB`);
}

main();
