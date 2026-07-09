/**
 * expander.ts — calendarList expansion orchestrator
 *
 * Converts calendarList elements into text primitives before the frozen
 * renderer runs. Mirrors the graph expander pattern.
 */

import { resolveValue, type DataContext } from "@zb/expressions";
import { logError } from "../../core/logger";
import { MAX_CALENDAR_LIST_LINES } from "../../limits";
import type { HaCalendarResult } from "../sourceFetcher";

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function str(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  return fallback;
}

export interface ExpandResult {
  elements: Record<string, unknown>[];
  errors: string[];
}

function expandCalendarListElement(
  raw: Record<string, unknown>,
  ctx: DataContext,
): Record<string, unknown>[] {
  const visible = resolveValue(raw.visible, ctx);
  if (visible === false) return [];

  const sourceId = str(resolveValue(raw.sourceId, ctx), "");
  if (!sourceId) {
    throw new Error("sourceId is required");
  }

  const posRaw = raw.pos as { x?: unknown; y?: unknown } | undefined;
  const baseX = num(resolveValue(posRaw?.x, ctx), 0);
  const baseY = num(resolveValue(posRaw?.y, ctx), 0);
  const lineHeight = num(resolveValue(raw.lineHeight, ctx), 36);
  const maxLines = Math.min(
    num(resolveValue(raw.maxLines, ctx), 5),
    MAX_CALENDAR_LIST_LINES,
  );
  const fontSize = num(resolveValue(raw.fontSize, ctx), 16);
  const fontWeight = num(resolveValue(raw.fontWeight, ctx), 400);
  const textAlign = str(resolveValue(raw.textAlign, ctx), "left");
  const enableFill = bool(resolveValue(raw.enableFill, ctx), true);
  const fill = num(resolveValue(raw.fill, ctx), 100);
  const opacity = num(resolveValue(raw.opacity, ctx), 100);
  const emptyText = str(resolveValue(raw.emptyText, ctx), "Ei tulevia tapahtumia");

  const sourceData = sourceId ? (ctx[sourceId] as HaCalendarResult | undefined) : undefined;
  const events = Array.isArray(sourceData?.events) ? sourceData.events : [];
  const lineCount = events.length === 0 ? 1 : Math.min(maxLines, events.length);

  const out: Record<string, unknown>[] = [];

  for (let i = 0; i < lineCount; i++) {
    const text = events.length === 0
      ? (i === 0 ? emptyText : "")
      : (events[i]?.label ?? "");

    if (!text && events.length > 0) continue;

    out.push({
      type: "text",
      visible: true,
      pos: { x: baseX, y: baseY + i * lineHeight },
      sizeX: 0,
      sizeY: 0,
      text,
      fallbackText: "",
      fontFamily: "sans-serif",
      fontSize,
      fontWeight,
      textAlign,
      lineHeight: 1.2,
      enableFill,
      fill,
      opacity,
    });
  }

  return out;
}

/**
 * Expand all calendarList elements in an elements array.
 * Non-calendarList elements pass through unchanged.
 */
export function expandCalendarListElements(
  elements: Record<string, unknown>[],
  ctx: DataContext,
): ExpandResult {
  const result: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const el of elements) {
    if (el.type === "calendarList") {
      try {
        const expanded = expandCalendarListElement(el, ctx);
        result.push(...expanded);
      } catch (err) {
        const id = typeof el.id === "string" ? el.id : typeof el.name === "string" ? el.name : "unknown";
        const message = err instanceof Error ? err.message : String(err);
        logError("calendarList.expand.failure", { id, error: err });
        errors.push(`CalendarList "${id}": ${message}`);
      }
    } else {
      result.push(el);
    }
  }

  return { elements: result, errors };
}
