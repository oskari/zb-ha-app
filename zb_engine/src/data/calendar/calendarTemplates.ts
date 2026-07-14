/**
 * calendarTemplates.ts — Row templates for calendarList rendering
 *
 * Events expose structured fields; locale-specific prose is composed via
 * optional element templates using {{field}} placeholders.
 */

import { createDataContext, resolveValue, type DataContext } from "@zb/expressions";
import type { HaCalendarEvent } from "../sourceFetcher";

export const DEFAULT_CALENDAR_DATE_ROW_TEMPLATE = "{{date_short}}{{relative_suffix}}";
export const DEFAULT_CALENDAR_DETAIL_ROW_TEMPLATE = "{{summary}}{{time_suffix}}{{until_suffix}}";

/** Flatten event fields onto a data context for template resolution. */
export function calendarEventTemplateContext(event: HaCalendarEvent): DataContext {
  const ctx = createDataContext();
  for (const [key, value] of Object.entries(event)) {
    (ctx as Record<string, unknown>)[key] = value;
  }
  return ctx;
}

export function applyCalendarRowTemplate(template: string, event: HaCalendarEvent): string {
  const resolved = resolveValue(template, calendarEventTemplateContext(event));
  if (resolved == null) return "";
  return String(resolved).trim();
}
