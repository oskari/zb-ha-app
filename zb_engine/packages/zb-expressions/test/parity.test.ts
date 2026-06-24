/**
 * parity.test.ts — package-level canonical-behavior test.
 *
 * Replays the same fixture vectors that drive the root cross-engine
 * parity test, but only against the @zb/expressions package source. If
 * this passes, it means the package's evaluator + resolver produce the
 * canonical values declared in the fixture file — which is the
 * contract that lets us swap consumers over to the package in Phase 2.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveValue, createDataContext, type DataContext } from "../src/index";

interface BuilderContext {
  misc?: Record<string, unknown>;
  features?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}

interface FixtureCase {
  name: string;
  expression: unknown;
  context: BuilderContext;
  expectedKind: "value" | "throws";
  expected?: unknown;
  errorIncludes?: string;
}

function flatCtxFromFixture(fixtureCtx: BuilderContext): DataContext {
  const ctx = createDataContext();
  ctx.misc = fixtureCtx.misc ?? {};
  ctx.features = fixtureCtx.features ?? {};
  for (const [sourceId, data] of Object.entries(fixtureCtx.sources ?? {})) {
    (ctx as Record<string, unknown>)[sourceId] = data;
  }
  return ctx;
}

function materializeExpression(expr: unknown): unknown {
  if (expr === "PLACEHOLDER_NEST_19") {
    let e: unknown = "deep";
    for (let i = 0; i < 19; i++) e = { if: [true, e, "fallback"] };
    return e;
  }
  if (expr === "PLACEHOLDER_NEST_25") {
    let e: unknown = "deep";
    for (let i = 0; i < 25; i++) e = { if: [true, e, "fallback"] };
    return e;
  }
  return expr;
}

const fixturePath = join(__dirname, "..", "..", "..", "test", "fixtures", "expressionVectors.json");
const fixtures: FixtureCase[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("@zb/expressions canonical parity", () => {
  it("loads the full fixture corpus with unique names", () => {
    // Tight floor against the current 152-vector corpus: any *drop* fails here
    // (additions still pass), so silently losing fixtures can't go unnoticed.
    // Unique names guard against an accidental duplicate/overwrite that would
    // otherwise shadow a vector in the loop below.
    expect(fixtures.length).toBeGreaterThanOrEqual(152);
    expect(new Set(fixtures.map((f) => f.name)).size).toBe(fixtures.length);
  });

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const expression = materializeExpression(fixture.expression);
      const ctx = flatCtxFromFixture(fixture.context);

      if (fixture.expectedKind === "throws") {
        let threw = false;
        let message = "";
        try {
          resolveValue(expression, ctx);
        } catch (err) {
          threw = true;
          message = err instanceof Error ? err.message : String(err);
        }
        expect(threw).toBe(true);
        if (fixture.errorIncludes) {
          expect(message).toContain(fixture.errorIncludes);
        }
        return;
      }

      const result = resolveValue(expression, ctx);
      expect(result).toEqual(fixture.expected);
    });
  }
});
