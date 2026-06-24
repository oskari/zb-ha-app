/**
 * elementBounds.test.ts — Group nesting depth + total element caps
 *
 * A crafted payload with unbounded recursive `group` nesting could blow the
 * stack (RangeError) during Zod's `z.lazy` parse, or expand pathologically.
 * `payloadSchema` now gates the raw `elements` array on depth + total count
 * BEFORE the recursive parse.
 */

import { describe, it, expect } from "vitest";
import { payloadSchema } from "../src/schema/payloadSchema";
import { MAX_ELEMENT_NESTING_DEPTH, MAX_TOTAL_ELEMENTS } from "../src/limits";

const base = { misc: { size: { width: 800, height: 480 } }, features: {}, sources: [] };

/** Build a single chain of nested groups `depth` levels deep with a rect leaf. */
function nestedGroups(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { type: "rect", width: 1, height: 1 };
  for (let i = 0; i < depth - 1; i++) {
    node = { type: "group", children: [node] };
  }
  return node;
}

describe("element nesting depth cap", () => {
  it("accepts nesting at the limit", () => {
    const payload = { ...base, elements: [nestedGroups(MAX_ELEMENT_NESTING_DEPTH)] };
    expect(payloadSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects nesting one past the limit", () => {
    const payload = { ...base, elements: [nestedGroups(MAX_ELEMENT_NESTING_DEPTH + 1)] };
    const res = payloadSchema.safeParse(payload);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /nesting depth/i.test(i.message))).toBe(true);
    }
  });

  it("does NOT throw (stack overflow) on a pathologically deep payload", () => {
    const payload = { ...base, elements: [nestedGroups(100_000)] };
    // safeParse must return a clean failure, never throw a RangeError.
    let res: ReturnType<typeof payloadSchema.safeParse>;
    expect(() => {
      res = payloadSchema.safeParse(payload);
    }).not.toThrow();
    expect(res!.success).toBe(false);
  });
});

describe("total element count cap", () => {
  it("rejects a group with more children than the total cap", () => {
    const children = Array.from({ length: MAX_TOTAL_ELEMENTS + 5 }, () => ({
      type: "rect",
      width: 1,
      height: 1,
    }));
    const payload = { ...base, elements: [{ type: "group", children }] };
    const res = payloadSchema.safeParse(payload);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /total element count/i.test(i.message))).toBe(true);
    }
  });

  it("rejects a top-level array over the 2000 cap", () => {
    const elements = Array.from({ length: 2001 }, () => ({ type: "rect", width: 1, height: 1 }));
    const res = payloadSchema.safeParse({ ...base, elements });
    expect(res.success).toBe(false);
  });

  it("accepts a moderately nested, moderately wide tree", () => {
    const elements = [
      {
        type: "group",
        children: [
          { type: "rect", width: 1, height: 1 },
          { type: "group", children: [{ type: "text", text: "hi" }] },
        ],
      },
      { type: "circle" },
    ];
    expect(payloadSchema.safeParse({ ...base, elements }).success).toBe(true);
  });
});
