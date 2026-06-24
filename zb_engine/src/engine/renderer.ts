/**
 * renderer.ts — Main render pipeline
 *
 * Per README "Architecture > Processing Phases":
 *   Phase 4 (Draw): elements[] array → 1-bit pixel buffer
 *   Elements are drawn in order (first = bottom layer, last = top).
 */

import { Canvas } from "./canvas";
import { DataContext } from "../expressions/context";
import { resolveElement } from "./elementResolver";
import { RenderError, RenderErrorInfo } from "../errors/renderError";
import {
  ResolvedElement,
  RectProps,
  CircleProps,
  LineProps,
  TextProps,
  ImgProps,
  SvgProps,
  GroupProps,
} from "./types";

import { drawRect } from "./primitives/rect";
import { drawCircle } from "./primitives/circle";
import { drawLine } from "./primitives/line";
import { drawText } from "./primitives/text";
import { fontsReady } from "./fonts/fontManager";
import { drawImg } from "./primitives/img";
import { drawSvg } from "./primitives/svg";
import { drawGroup } from "./primitives/group";
import { hasNonIdentityTransform, drawWithTransform } from "./transform";

interface RenderResult {
  canvas: Canvas;
  errors: RenderErrorInfo[];
}

/**
 * Draw a single resolved element directly (no transform wrapping).
 */
async function drawElementDirect(canvas: Canvas, element: unknown): Promise<void> {
  const el = element as ResolvedElement;
  switch (el.type) {
    case "rect":
      drawRect(canvas, el as RectProps);
      break;
    case "circle":
      drawCircle(canvas, el as CircleProps);
      break;
    case "line":
      drawLine(canvas, el as LineProps);
      break;
    case "text":
      drawText(canvas, el as TextProps);
      break;
    case "img":
      await drawImg(canvas, el as ImgProps);
      break;
    case "svg":
      await drawSvg(canvas, el as SvgProps);
      break;
    case "group":
      await drawGroup(canvas, el as GroupProps, drawElement);
      break;
    default:
      throw new Error(`Unknown element type: "${(el as { type: string }).type}"`);
  }
}

/**
 * Draw a single resolved element onto the canvas.
 */
async function drawElement(canvas: Canvas, element: unknown): Promise<void> {
  const el = element as ResolvedElement;
  if (hasNonIdentityTransform(el)) {
    await drawWithTransform(canvas, el, drawElementDirect);
  } else {
    await drawElementDirect(canvas, element);
  }
}

/**
 * Render all elements onto a new canvas.
 */
export async function render(
  elements: Record<string, unknown>[],
  ctx: DataContext,
  width: number,
  height: number,
): Promise<RenderResult> {
  await fontsReady;

  const canvas = new Canvas(width, height);
  const errors: RenderErrorInfo[] = [];

  for (let i = 0; i < elements.length; i++) {
    const raw = elements[i];
    try {
      const resolved = resolveElement(raw, ctx);
      if (!resolved.visible) continue;
      await drawElement(canvas, resolved);
    } catch (err) {
      const type = typeof raw.type === "string" ? raw.type : "unknown";
      const renderErr = new RenderError(
        i,
        type,
        err instanceof Error ? err.message : String(err),
      );
      errors.push(renderErr.toInfo());
    }
  }

  return { canvas, errors };
}
