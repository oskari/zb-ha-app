/**
 * types.ts — Shared TypeScript types for element properties
 */

// ── Transform ──────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface TransformProps {
  pos: Point;
  rotationDeg: number;
  scale: Point;
  origin: Point;
}

// ── Size ───────────────────────────────────────────────────────

export interface SizeProps {
  sizeX: number;
  sizeY: number;
}

// ── Fill Dither ────────────────────────────────────────────────

export interface FillProps {
  enableFill: boolean;
  fill: number;
}

// ── Stroke ─────────────────────────────────────────────────────

export interface StrokeProps {
  enableStroke: boolean;
  strokeDither: number;
  strokeWidth: number;
  strokeDash: number[];
  strokeCap: "butt" | "round";
  strokePosition: "inside" | "center" | "outside";
  strokeRadius: number;
}

// ── Opacity ────────────────────────────────────────────────────

export interface OpacityProps {
  opacity: number;
}

// ── Resolved element base ──────────────────────────────────────

export interface BaseElementProps extends TransformProps, OpacityProps {
  type: string;
  visible: boolean;
}

// ── Per-type resolved props ────────────────────────────────────

export interface RectProps extends BaseElementProps, SizeProps, FillProps, StrokeProps {
  type: "rect";
}

export interface CircleProps extends BaseElementProps, SizeProps, FillProps, Omit<StrokeProps, "strokeRadius"> {
  type: "circle";
  arcStartDeg: number;
  arcEndDeg: number;
  innerSize: number;
}

export interface LineProps extends BaseElementProps, StrokeProps {
  type: "line";
  points: [number, number][];
}

export interface TextProps extends BaseElementProps, SizeProps, FillProps {
  type: "text";
  text: string;
  fallbackText: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
}

export interface ImgProps extends BaseElementProps, SizeProps {
  type: "img";
  src: string;
  bwMode: "threshold" | "dither";
  bwLevel: number;
}

export interface SvgProps extends BaseElementProps, SizeProps, FillProps, StrokeProps {
  type: "svg";
  svg: string;
  src: string;
  bwMode: "threshold" | "dither";
  bwLevel: number;
}

export interface GroupProps extends BaseElementProps {
  type: "group";
  children: ResolvedElement[];
}

/** Union of all resolved element types. */
export type ResolvedElement =
  | RectProps
  | CircleProps
  | LineProps
  | TextProps
  | ImgProps
  | SvgProps
  | GroupProps;

// ── Defaults ───────────────────────────────────────────────────

export const TRANSFORM_DEFAULTS: TransformProps = {
  pos: { x: 0, y: 0 },
  rotationDeg: 0,
  scale: { x: 1, y: 1 },
  origin: { x: 0, y: 0 },
};

export const SIZE_DEFAULTS: SizeProps = {
  sizeX: 0,
  sizeY: 0,
};

export const FILL_DEFAULTS: FillProps = {
  enableFill: false,
  fill: 0,
};

export const STROKE_DEFAULTS: StrokeProps = {
  enableStroke: false,
  strokeDither: 100,
  strokeWidth: 1,
  strokeDash: [],
  strokeCap: "butt",
  strokePosition: "center",
  strokeRadius: 0,
};

export const OPACITY_DEFAULTS: OpacityProps = {
  opacity: 100,
};
