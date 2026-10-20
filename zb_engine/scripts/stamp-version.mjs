#!/usr/bin/env node
/**
 * stamp-version.mjs — Write version.json for runtime identification.
 *
 * Run before `tsc` (npm prebuild) and in the Docker server-build stage.
 * Embeds the semver from package.json plus optional git commit and build time.
 *
 * Writes the same file to src/ (read by src/version.ts under vitest/ts runs)
 * and dist/ (read by the compiled dist/version.js). tsc only emits JSON that
 * is imported, so dist/version.json must be written here; tsc never removes
 * files it did not emit, so stamping before compiling is safe.
 *
 * ZB_STAMP_ROOT overrides the project root (tests).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.ZB_STAMP_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let commit;
try {
  commit = execSync("git rev-parse --short HEAD", {
    encoding: "utf8",
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  // Docker build context excludes .git; commit stays undefined.
}

const epoch = process.env.SOURCE_DATE_EPOCH;
const builtAt = epoch
  ? new Date(Number(epoch) * 1000).toISOString()
  : new Date().toISOString();

const info = {
  version: pkg.version,
  builtAt,
  ...(commit ? { commit } : {}),
};

const json = `${JSON.stringify(info, null, 2)}\n`;
for (const dir of ["src", "dist"]) {
  const outPath = join(root, dir, "version.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  console.log(`stamped ${outPath}: ${info.version}${commit ? ` (${commit})` : ""}`);
}
