/**
 * stampVersion.test.ts — build identity reaches the compiled output
 *
 * src/version.ts reads version.json next to itself, i.e. dist/version.json
 * at runtime. tsc does not copy un-imported JSON, so the stamp script must
 * write it into dist/ as well as src/.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(__dirname, "..", "scripts", "stamp-version.mjs");
let tmpRoot: string | undefined;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
});

describe("stamp-version.mjs", () => {
  it("writes version.json to both src/ and dist/", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "zb-stamp-"));
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ version: "9.8.7.dev6" }));

    execFileSync(process.execPath, [script], {
      env: { ...process.env, ZB_STAMP_ROOT: tmpRoot, SOURCE_DATE_EPOCH: "1700000000" },
      stdio: "pipe",
    });

    for (const dir of ["src", "dist"]) {
      const info = JSON.parse(readFileSync(join(tmpRoot, dir, "version.json"), "utf8"));
      expect(info.version).toBe("9.8.7.dev6");
      expect(info.builtAt).toBe("2023-11-14T22:13:20.000Z");
    }
  });
});
