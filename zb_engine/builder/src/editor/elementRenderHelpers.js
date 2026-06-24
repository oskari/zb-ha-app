/**
 * elementRenderHelpers.js — Pure rendering helpers for canvas elements
 *
 * Extracted from CanvasArea.jsx.  These compute Konva shape props
 * (fill, stroke, dash, caps) from element model data.
 * All functions are pure — no component state or side effects.
 */

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function ditherPercentToGray(percent) {
  const n = Number(percent);
  const t = clamp01((Number.isFinite(n) ? n : 0) / 100);
  const v = Math.round(255 * (1 - t));
  return `rgb(${v} ${v} ${v})`;
}

export function getFill(element) {
  if (!element?.enableFill) return undefined;
  return ditherPercentToGray(element.fill);
}

export function getStroke(element) {
  if (!element?.enableStroke) return undefined;
  return ditherPercentToGray(element.strokeDither);
}

/**
 * The render engine honors only the FIRST on/off pair of a dash array
 * (line.ts / rect.ts / circle.ts read dash[0], dash[1]). Multi-segment patterns
 * like dash-dot are NOT rendered on the device, so the canvas must collapse them
 * to the first pair to stay WYSIWYG.
 */
function engineDash(dash) {
  return Array.isArray(dash) && dash.length >= 2 ? [dash[0], dash[1]] : [];
}

export function getStrokeProps(element) {
  const stroke = getStroke(element);
  if (!stroke) return {};

  const sw = element.strokeWidth ?? 1;
  const dash = engineDash(element.strokeDash);
  const hasDash = dash.length >= 2;

  // The engine only renders a real cap for 'round' (as end-circles, and only when
  // strokeWidth > 1 — line.ts:101). 'butt'/'square'/'pill' all produce butt ends
  // because drawSegment ignores the cap. Match that so the canvas == device.
  const konvaCap = element.strokeCap === 'round' && sw > 1 ? 'round' : 'butt';

  // Without dashes, lineCap alone handles caps correctly.
  if (!hasDash) {
    return { stroke, strokeWidth: sw, lineCap: konvaCap };
  }

  // With dashes: force lineCap "butt" so dash gaps render correctly. The round
  // end-caps (the only cap the engine draws) are added as separate circle
  // geometry by getEndpointCaps().
  return { stroke, strokeWidth: sw, dash, lineCap: 'butt' };
}

/**
 * When dashes are present, Konva's lineCap is forced to "butt" so dashes render
 * correctly, so the round end-caps are drawn as separate circle geometry at the
 * polyline endpoints. The engine draws end-caps ONLY for cap 'round' and only
 * when strokeWidth > 1 (line.ts drawCircleFill); 'butt'/'square'/'pill' get no
 * decoration. Returns the first/last cap circles, or null when none apply.
 */
export function getEndpointCaps(element) {
  const hasDash = Array.isArray(element.strokeDash) && element.strokeDash.length >= 2;
  if (!hasDash) return null;

  if (element.strokeCap !== 'round') return null;
  const sw = element.strokeWidth ?? 1;
  if (sw <= 1) return null;

  const pts = element.points;
  if (!Array.isArray(pts) || pts.length < 2) return null;

  const stroke = getStroke(element);
  if (!stroke) return null;

  return {
    type: 'round',
    first: pts[0],
    last: pts[pts.length - 1],
    radius: sw / 2,
    fill: stroke,
  };
}
