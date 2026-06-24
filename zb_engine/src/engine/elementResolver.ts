/**
 * elementResolver.ts — Resolve raw element defs into typed props
 */

import { DataContext } from "../expressions/context";
import { resolveValue } from "../expressions/bindingResolver";
import {
  BaseElementProps,
  RectProps,
  CircleProps,
  LineProps,
  TextProps,
  ImgProps,
  SvgProps,
  GroupProps,
  ResolvedElement,
  TRANSFORM_DEFAULTS,
  SIZE_DEFAULTS,
  FILL_DEFAULTS,
  STROKE_DEFAULTS,
  OPACITY_DEFAULTS,
  Point,
} from "./types";

// ── Helpers ────────────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function str(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function point(v: unknown, fallback: Point): Point {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    return {
      x: num(obj.x, fallback.x),
      y: num(obj.y, fallback.y),
    };
  }
  return fallback;
}

function numArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => num(x, 0));
  return [];
}

// ── Resolve shared blocks ──────────────────────────────────────

function resolveBase(raw: Record<string, unknown>, ctx: DataContext): BaseElementProps {
  return {
    type: str(raw.type, ""),
    visible: bool(resolveValue(raw.visible, ctx), true),
    pos: point(resolveValue(raw.pos, ctx), TRANSFORM_DEFAULTS.pos),
    rotationDeg: num(resolveValue(raw.rotationDeg, ctx), TRANSFORM_DEFAULTS.rotationDeg),
    scale: point(resolveValue(raw.scale, ctx), TRANSFORM_DEFAULTS.scale),
    origin: point(resolveValue(raw.origin, ctx), TRANSFORM_DEFAULTS.origin),
    opacity: num(resolveValue(raw.opacity, ctx), OPACITY_DEFAULTS.opacity),
  };
}

function resolveSize(raw: Record<string, unknown>, ctx: DataContext) {
  return {
    sizeX: num(resolveValue(raw.sizeX, ctx), SIZE_DEFAULTS.sizeX),
    sizeY: num(resolveValue(raw.sizeY, ctx), SIZE_DEFAULTS.sizeY),
  };
}

function resolveFill(raw: Record<string, unknown>, ctx: DataContext) {
  return {
    enableFill: bool(resolveValue(raw.enableFill, ctx), FILL_DEFAULTS.enableFill),
    fill: num(resolveValue(raw.fill, ctx), FILL_DEFAULTS.fill),
  };
}

function resolveStroke(raw: Record<string, unknown>, ctx: DataContext) {
  return {
    enableStroke: bool(resolveValue(raw.enableStroke, ctx), STROKE_DEFAULTS.enableStroke),
    strokeDither: num(resolveValue(raw.strokeDither, ctx), STROKE_DEFAULTS.strokeDither),
    strokeWidth: num(resolveValue(raw.strokeWidth, ctx), STROKE_DEFAULTS.strokeWidth),
    strokeDash: numArray(resolveValue(raw.strokeDash, ctx)),
    strokeCap: str(resolveValue(raw.strokeCap, ctx), STROKE_DEFAULTS.strokeCap) as "butt" | "round",
    strokePosition: str(resolveValue(raw.strokePosition, ctx), STROKE_DEFAULTS.strokePosition) as "inside" | "center" | "outside",
    strokeRadius: num(resolveValue(raw.strokeRadius, ctx), STROKE_DEFAULTS.strokeRadius),
  };
}

// ── Per-type resolvers ─────────────────────────────────────────

function resolveRect(raw: Record<string, unknown>, ctx: DataContext): RectProps {
  return {
    ...resolveBase(raw, ctx),
    type: "rect",
    ...resolveSize(raw, ctx),
    ...resolveFill(raw, ctx),
    ...resolveStroke(raw, ctx),
  };
}

function resolveCircle(raw: Record<string, unknown>, ctx: DataContext): CircleProps {
  const stroke = resolveStroke(raw, ctx);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { strokeRadius: _sr, ...strokeWithoutRadius } = stroke;
  return {
    ...resolveBase(raw, ctx),
    type: "circle",
    ...resolveSize(raw, ctx),
    ...resolveFill(raw, ctx),
    ...strokeWithoutRadius,
    arcStartDeg: num(resolveValue(raw.arcStartDeg, ctx), 0),
    arcEndDeg: num(resolveValue(raw.arcEndDeg, ctx), 0),
    innerSize: Math.max(0, Math.min(1, num(resolveValue(raw.innerSize, ctx), 0))),
  };
}

function resolveLine(raw: Record<string, unknown>, ctx: DataContext): LineProps {
  const rawPoints = raw.points;
  let points: [number, number][] = [];
  if (Array.isArray(rawPoints)) {
    points = rawPoints.map((p) => {
      if (Array.isArray(p) && p.length >= 2) {
        return [
          num(resolveValue(p[0], ctx), 0),
          num(resolveValue(p[1], ctx), 0),
        ] as [number, number];
      }
      return [0, 0] as [number, number];
    });
  }
  return {
    ...resolveBase(raw, ctx),
    type: "line",
    points,
    ...resolveStroke(raw, ctx),
  };
}

function resolveText(raw: Record<string, unknown>, ctx: DataContext): TextProps {
  let text = resolveValue(raw.text, ctx);
  const fallback = str(resolveValue(raw.fallbackText, ctx), "");
  if (text === null || text === undefined || text === "") {
    text = fallback;
  }
  return {
    ...resolveBase(raw, ctx),
    type: "text",
    ...resolveSize(raw, ctx),
    ...resolveFill(raw, ctx),
    text: str(text, ""),
    fallbackText: fallback,
    fontFamily: str(resolveValue(raw.fontFamily, ctx), "sans-serif"),
    fontSize: num(resolveValue(raw.fontSize, ctx), 16),
    fontWeight: num(resolveValue(raw.fontWeight, ctx), 400),
    textAlign: str(resolveValue(raw.textAlign, ctx), "left") as "left" | "center" | "right",
    lineHeight: num(resolveValue(raw.lineHeight, ctx), 1.2),
  };
}

function resolveImg(raw: Record<string, unknown>, ctx: DataContext): ImgProps {
  return {
    ...resolveBase(raw, ctx),
    type: "img",
    ...resolveSize(raw, ctx),
    src: str(resolveValue(raw.src, ctx), ""),
    bwMode: str(resolveValue(raw.bwMode, ctx), "threshold") as "threshold" | "dither",
    bwLevel: num(resolveValue(raw.bwLevel, ctx), 50),
  };
}

function resolveSvg(raw: Record<string, unknown>, ctx: DataContext): SvgProps {
  return {
    ...resolveBase(raw, ctx),
    type: "svg",
    ...resolveSize(raw, ctx),
    ...resolveFill(raw, ctx),
    ...resolveStroke(raw, ctx),
    svg: str(resolveValue(raw.svg, ctx), ""),
    src: str(resolveValue(raw.src, ctx), ""),
    bwMode: str(resolveValue(raw.bwMode, ctx), "threshold") as "threshold" | "dither",
    bwLevel: num(resolveValue(raw.bwLevel, ctx), 50),
  };
}

const MAX_GROUP_DEPTH = 10;

function resolveGroup(raw: Record<string, unknown>, ctx: DataContext, depth: number): GroupProps {
  if (depth >= MAX_GROUP_DEPTH) {
    throw new Error(`Group nesting exceeds maximum depth of ${MAX_GROUP_DEPTH}`);
  }
  const rawChildren = Array.isArray(raw.children) ? raw.children : [];
  return {
    ...resolveBase(raw, ctx),
    type: "group",
    children: rawChildren.map((child) =>
      resolveElementInternal(child as Record<string, unknown>, ctx, depth + 1),
    ),
  };
}

// ── Internal resolver (depth-aware) ────────────────────────────

function resolveElementInternal(
  raw: Record<string, unknown>,
  ctx: DataContext,
  depth: number,
): ResolvedElement {
  const type = str(raw.type, "");
  switch (type) {
    case "rect":
      return resolveRect(raw, ctx);
    case "circle":
      return resolveCircle(raw, ctx);
    case "line":
      return resolveLine(raw, ctx);
    case "text":
      return resolveText(raw, ctx);
    case "img":
      return resolveImg(raw, ctx);
    case "svg":
      return resolveSvg(raw, ctx);
    case "group":
      return resolveGroup(raw, ctx, depth);
    default:
      throw new Error(`Unknown element type: "${type}"`);
  }
}

/**
 * Resolve a raw element (with bindings) into a fully typed element.
 */
export function resolveElement(
  raw: Record<string, unknown>,
  ctx: DataContext,
): ResolvedElement {
  return resolveElementInternal(raw, ctx, 0);
}
