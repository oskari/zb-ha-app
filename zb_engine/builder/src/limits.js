/**
 * limits.js — Centralised builder-side limits and thresholds
 *
 * Runtime-tuneable constants for the widget builder. This file MUST NOT
 * import from any other builder module to avoid circular dependencies.
 */

// ── Auto-save ──────────────────────────────────────────────────

/** Debounce interval before auto-save triggers after a doc change (ms). */
export const AUTOSAVE_DEBOUNCE_MS = 5000;
