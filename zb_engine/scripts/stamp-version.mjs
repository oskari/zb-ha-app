#!/usr/bin/env node
/**
 * stamp-version.mjs — Write src/version.json for runtime identification.
 *
 * Run before `tsc` (npm prebuild) and in the Docker server-build stage.
 * Embeds the semver from package.json plus optional git commit and build time.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let commit;
try {
  commit = execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: root }).trim();
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

const outPath = join(root, "src", "version.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(info, null, 2)}\n`);
console.log(`stamped ${outPath}: ${info.version}${commit ? ` (${commit})` : ""}`);
