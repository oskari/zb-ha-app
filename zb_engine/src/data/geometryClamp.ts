/**
 * geometryClamp.ts — Bound resolved element geometry before the frozen engine
 *
 * The frozen draw primitives (`src/engine/primitives/{rect,circle,line}.ts`)
 * use resolved geometry directly as synchronous pixel-loop bounds, and the
 * frozen `num()` returns Infinity / huge magnitudes verbatim. A literal or
 * binding-resolved oversize value therefore drives a non-terminating (or
 * multi-minute) synchronous loop that wedges the event loop.
 *
 * `schema/elementSchema.ts` already rejects non-finite / absurd LITERAL
 * geometry. This out-of-engine pre-render pass mirrors `svgPreprocessor.ts`
 * (same group recursion + copy-on-write shape) and clamps RUNTIME-RESOLVED
 * geometry — sizes, strokeWidth AND pos/point coordinates — to `MAX_RASTER_AXIS`
 * (canvas scale) so every frozen draw-loop pixel bbox is O(MAX_RASTER_AXIS^2).
 * Two loop shapes must be bounded: rect/circle loops scale with SIZE, while the
 * line loop scales with the coordinate SPAN of (point + pos) — so coordinates
 * are clamped to canvas scale, not merely made finite.
 *
 * It does NOT modify anything under `src/engine/`, and it is a mitigation seam,
 * not a fix inside the loops; the terminable render worker remains the hard
 * backstop for any residual slow-but-finite loop (e.g. many-segment lines,
 * whose points-array length this pass leaves uncapped).
 *
 * A literal number is written back ONLY when clamping actually changes the
 * RESOLVED value, so in-bounds literals AND in-bounds bindings keep their
 * object identity (the render-result cache stays effective) and bindings are
 * never replaced with resolved literals.
 */

import { resolveValue, type DataContext } from "@zb/expressions";
import { MAX_RASTER_AXIS } from "./rasterLimits";

/** Mirror the engine's group-recursion limit (`elementResolver.ts`). */
const MAX_GROUP_DEPTH = 10;

/** Coerce a resolved value to a number, mirroring the engine's `num()`. */
function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

/** Clamp sizes / strokeWidth to `[0, MAX_RASTER_AXIS]`; non-finite → 0. */
const clampSize = (n: number): number =>
  Math.min(MAX_RASTER_AXIS, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Clamp a coordinate (pos, line point) to `[-MAX_RASTER_AXIS, MAX_RASTER_AXIS]`;
 * non-finite → 0. Uses canvas scale (NOT the looser `MAX_GEOMETRY_COORD`) so
 * the frozen line primitive's coordinate-span-bounded loop stays bounded.
 */
const clampCoord = (n: number): number =>
  Math.min(MAX_RASTER_AXIS, Math.max(-MAX_RASTER_AXIS, Number.isFinite(n) ? n : 0));

/**
 * Clamp resolved geometry on a single element. Returns the original reference
 * when nothing is out of bounds; otherwise a shallow copy with only the
 * offending fields rewritten to finite literals.
 */
function clampElement(
  el: Record<string, unknown>,
  ctx: DataContext,
): Record<string, unknown> {
  let next: Record<string, unknown> | null = null;
  const mutate = (): Record<string, unknown> => (next ??= { ...el });

  // pos — a circle/line loop bound. Only a non-array object with x/y.
  if ("pos" in el) {
    const rp = resolveValue(el.pos, ctx);
    if (rp !== null && typeof rp === "object" && !Array.isArray(rp)) {
      const p = rp as Record<string, unknown>;
      const rx = num(p.x, 0);
      const ry = num(p.y, 0);
      const cx = clampCoord(rx);
      const cy = clampCoord(ry);
      if (cx !== rx || cy !== ry) {
        mutate().pos = { x: cx, y: cy };
      }
    }
  }

  // sizeX / sizeY — rect/circle loop bounds (also graph after expansion).
  if ("sizeX" in el) {
    const r = num(resolveValue(el.sizeX, ctx), 0);
    const c = clampSize(r);
    if (c !== r) mutate().sizeX = c;
  }
  if ("sizeY" in el) {
    const r = num(resolveValue(el.sizeY, ctx), 0);
    const c = clampSize(r);
    if (c !== r) mutate().sizeY = c;
  }

  // strokeWidth — grows rect/svg stroke loops.
  if ("strokeWidth" in el) {
    const dflt =
      el.type === "rect" ||
      el.type === "circle" ||
      el.type === "line" ||
      el.type === "svg"
        ? 1
        : 0;
    const r = num(resolveValue(el.strokeWidth, ctx), dflt);
    const c = clampSize(r);
    if (c !== r) mutate().strokeWidth = c;
  }

  // line points — the coordinate-span-bounded loop; clamp to canvas scale.
  if (el.type === "line" && Array.isArray(el.points)) {
    const points = el.points as unknown[];
    let pointsChanged = false;
    const clamped = points.map((pt) => {
      if (!Array.isArray(pt)) return pt;
      const rx = num(resolveValue(pt[0], ctx), 0);
      const ry = num(resolveValue(pt[1], ctx), 0);
      const cx = clampCoord(rx);
      const cy = clampCoord(ry);
      if (cx !== rx || cy !== ry) {
        pointsChanged = true;
        return [cx, cy];
      }
      return pt;
    });
    if (pointsChanged) mutate().points = clamped;
  }

  return next ?? el;
}

function clampElementsInternal(
  elements: Record<string, unknown>[],
  ctx: DataContext,
  depth: number,
): Record<string, unknown>[] {
  // Stop recursing past the engine's group depth limit — anything deeper
  // would be rejected by the resolver anyway.
  if (depth >= MAX_GROUP_DEPTH) return elements;

  return elements.map((el) => {
    if (el.type === "group" && Array.isArray(el.children)) {
      const children = el.children as Record<string, unknown>[];
      const clampedChildren = clampElementsInternal(children, ctx, depth + 1);
      // Preserve referential equality if no descendant changed.
      const changed = clampedChildren.some((child, i) => child !== children[i]);
      return changed ? { ...el, children: clampedChildren } : el;
    }
    return clampElement(el, ctx);
  });
}

/**
 * Clamp resolved geometry on every element (recursing into `group` children up
 * to `MAX_GROUP_DEPTH`). Called from `renderService.preparePipeline` after user
 * assets and before graph expansion, mirroring `normalizeSvgElements`.
 *
 * @returns A new array; unchanged elements share their original reference.
 */
export function clampElementGeometry(
  elements: Record<string, unknown>[],
  ctx: DataContext,
): Record<string, unknown>[] {
  return clampElementsInternal(elements, ctx, 0);
}
