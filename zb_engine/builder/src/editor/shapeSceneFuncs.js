/**
 * shapeSceneFuncs.js — Konva sceneFunc builders for rect & circle
 *
 * Plain Konva <Rect>/<Ellipse> cannot express the geometry the render engine
 * supports: rounded corners + inside/outside stroke (rect), and donut cutouts,
 * pie/wedge arcs, and inside/outside stroke (circle). These builders draw the
 * same geometry the engine rasterizes:
 *   - rect:   src/engine/primitives/rect.ts   (rounded rect + offset stroke band)
 *   - circle: src/engine/primitives/circle.ts (ellipse, innerSize, arc, stroke)
 *
 * Dither is approximated as a solid gray (the canvas convention) — these only
 * reproduce SHAPE, not the Bayer pattern. All drawing is in self-coordinates
 * (0..w, 0..h); callers position/transform the node via getCommonNodeProps.
 */

/** Trace a rounded-rect path (clamped radius), or a plain rect when r<=0. */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    ctx.closePath();
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Clamp the corner radius the same way the engine does (rect.ts:18). */
export function clampCornerRadius(radius, w, h) {
  return Math.max(0, Math.min(radius || 0, Math.floor(Math.min(w, h) / 2)));
}

/**
 * Resolve a circle's arc sweep to match the engine's isInArc (circle.ts:51-70).
 * The engine takes angles mod 360, so a non-zero arc whose start and end
 * normalize to the SAME angle (e.g. 0→360, or 90→90) is a zero-length sweep
 * that renders essentially nothing — NOT a full circle. A full circle is only
 * arcStart===0 && arcEnd===0 (the no-arc case).
 *
 * @returns {{fullCircle?: true, empty?: true, start: number, end: number}}
 *   fullCircle → draw the whole ellipse; empty → draw nothing; otherwise sweep
 *   [start, end] in radians (end may exceed 2π for wrap-around like 270→90).
 */
export function resolveArcSweep(arcStartDeg, arcEndDeg) {
  const hasArc = (arcStartDeg || 0) !== 0 || (arcEndDeg || 0) !== 0;
  if (!hasArc) return { fullCircle: true, start: 0, end: Math.PI * 2 };

  const norm = (deg) => ((((deg || 0) % 360) + 360) % 360) * Math.PI / 180;
  const start = norm(arcStartDeg);
  let end = norm(arcEndDeg);
  if (end === start) return { empty: true, start, end };
  if (end < start) end += Math.PI * 2; // wrap-around (e.g. 270→90)
  return { start, end };
}

/**
 * Build a sceneFunc for a rect element.
 * @param {object} o
 * @param {number} o.w @param {number} o.h
 * @param {number} o.radius            - corner radius (display px, pre-clamp)
 * @param {string|undefined} o.fillColor   - solid gray fill, or undefined to skip
 * @param {string|undefined} o.strokeColor - solid gray stroke, or undefined to skip
 * @param {number} o.strokeWidth
 * @param {string} o.strokePosition     - 'inside' | 'center' | 'outside'
 * @param {number[]} [o.dash]
 */
export function makeRectSceneFunc({ w, h, radius, fillColor, strokeColor, strokeWidth, strokePosition, dash }) {
  return (ctx) => {
    if (w <= 0 || h <= 0) return;
    const r = clampCornerRadius(radius, w, h);

    if (fillColor) {
      roundRectPath(ctx, 0, 0, w, h, r);
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    if (strokeColor && strokeWidth > 0) {
      const sw = strokeWidth;
      // Konva/canvas strokes are centered; offset the path so the sw-wide band
      // lands inside/outside the bounds, matching rect.ts outer/inner offsets.
      let off;
      let rr;
      if (strokePosition === 'inside') {
        off = sw / 2;
        rr = Math.max(0, r - sw / 2);
      } else if (strokePosition === 'outside') {
        off = -sw / 2;
        rr = r + sw / 2;
      } else {
        off = 0;
        rr = r;
      }
      roundRectPath(ctx, off, off, w - 2 * off, h - 2 * off, rr);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = sw;
      // The engine honors only the first on/off pair (rect.ts / circle.ts).
      ctx.setLineDash(Array.isArray(dash) && dash.length >= 2 ? [dash[0], dash[1]] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
}

/**
 * Build a sceneFunc for a circle/ellipse element.
 * Supports innerSize (donut), arcStartDeg/arcEndDeg (pie/wedge), and stroke
 * position — mirroring circle.ts. Angles use the same convention as the engine
 * (degrees, clockwise in canvas y-down space).
 * @param {object} o
 * @param {number} o.w @param {number} o.h
 * @param {string|undefined} o.fillColor
 * @param {string|undefined} o.strokeColor
 * @param {number} o.strokeWidth
 * @param {string} o.strokePosition
 * @param {number} [o.innerSize]   - 0..1 fraction; >0 cuts a donut hole
 * @param {number} [o.arcStartDeg] @param {number} [o.arcEndDeg]
 * @param {number[]} [o.dash]
 */
export function makeCircleSceneFunc({
  w,
  h,
  fillColor,
  strokeColor,
  strokeWidth,
  strokePosition,
  innerSize,
  arcStartDeg,
  arcEndDeg,
  dash,
}) {
  return (ctx) => {
    if (w <= 0 || h <= 0) return;
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2;
    const ry = h / 2;

    const sweep = resolveArcSweep(arcStartDeg, arcEndDeg);
    // A degenerate arc (start/end normalize equal) draws nothing in the engine.
    if (sweep.empty) return;
    const hasArc = !sweep.fullCircle;
    const start = sweep.start;
    const end = sweep.end;

    const inner = Math.max(0, Math.min(1, innerSize || 0));
    const hasInner = inner > 0;
    const innerRx = rx * inner;
    const innerRy = ry * inner;

    if (fillColor) {
      ctx.beginPath();
      if (hasArc) {
        ctx.ellipse(cx, cy, rx, ry, 0, start, end, false);
        if (hasInner) {
          // Inner arc reversed (counter-clockwise) carves the ring sector hole.
          ctx.ellipse(cx, cy, innerRx, innerRy, 0, end, start, true);
        } else {
          ctx.lineTo(cx, cy); // pie/wedge → close through the center
        }
        ctx.closePath();
      } else {
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, false);
        if (hasInner) {
          // Opposite winding leaves the inner ellipse unfilled (donut hole).
          ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2, true);
        }
      }
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    if (strokeColor && strokeWidth > 0) {
      const sw = strokeWidth;
      // Offset the outline radii so the centered stroke band sits inside/outside.
      let off;
      if (strokePosition === 'inside') off = -sw / 2;
      else if (strokePosition === 'outside') off = sw / 2;
      else off = 0;
      const orx = Math.max(0, rx + off);
      const ory = Math.max(0, ry + off);

      ctx.beginPath();
      ctx.ellipse(cx, cy, orx, ory, 0, hasArc ? start : 0, hasArc ? end : Math.PI * 2, false);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = sw;
      // The engine honors only the first on/off pair (rect.ts / circle.ts).
      ctx.setLineDash(Array.isArray(dash) && dash.length >= 2 ? [dash[0], dash[1]] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
}

/** Hit area = the element's bounding box (so thin arcs/rings stay easy to click). */
export function boxHitFunc(ctx, shape) {
  ctx.beginPath();
  ctx.rect(0, 0, shape.width(), shape.height());
  ctx.closePath();
  ctx.fillStrokeShape(shape);
}
