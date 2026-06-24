/**
 * group.ts — Group element (container with nested transforms)
 */

import { Canvas } from "../canvas";
import { GroupProps } from "../types";

type DrawElementFn = (canvas: Canvas, element: unknown) => Promise<void>;

export async function drawGroup(
  canvas: Canvas,
  props: GroupProps,
  drawElementFn: DrawElementFn,
): Promise<void> {
  if (!props.children || props.children.length === 0) return;

  for (const child of props.children) {
    if (!child.visible) continue;

    const offsetChild = {
      ...child,
      pos: {
        x: child.pos.x + props.pos.x,
        y: child.pos.y + props.pos.y,
      },
    };

    await drawElementFn(canvas, offsetChild as unknown);
  }
}
