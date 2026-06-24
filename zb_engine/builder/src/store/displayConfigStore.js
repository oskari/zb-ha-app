/**
 * displayConfigStore.js — Display configuration for the widget builder
 *
 * Holds TWO independent screen-size settings so resizing one view never
 * affects the other (see screenSizeForDocId in docStore.js):
 *
 *   widgetMode   — the widget's own (primary) size. 'full' (800×480) or
 *                  'panel' (720×480). Default 'panel'.
 *   displayMode  — the FULLSCREEN COMPANION size. 'full' (800×480),
 *                  'panel' (720×480), or 'custom' (user-defined). Default
 *                  'panel'.
 *
 * Size presets:
 *   'full'   — 800×480 (entire e-ink screen, no HA side panel)
 *   'panel'  — 720×480 (screen minus 80px HA side panel)
 *   'custom' — User-defined pixel dimensions (companion only)
 *
 * Both default to 'panel' and are changed via the Settings tab; getScreenSize(role)
 * resolves the right one for a given doc role.
 * Settings are persisted to localStorage so they survive page reloads.
 *
 * This module is platform-agnostic (no imports from platform/).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SCREEN_WIDTH, SCREEN_HEIGHT, SIDE_PANEL_WIDTH } from '../models/document.js';
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../utils/safeStorage.js';

// ── Display presets ────────────────────────────────────────────

export const DISPLAY_PRESETS = {
  full: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  panel: { width: SCREEN_WIDTH - SIDE_PANEL_WIDTH, height: SCREEN_HEIGHT },
};

// ── localStorage persistence ───────────────────────────────────

// Versioned key — bump the suffix to invalidate persisted configs after a
// change to the stored shape or the default mode.
const STORAGE_KEY = 'zb-display-config-v3';

function loadSavedConfig() {
  try {
    const raw = safeLocalStorageGetItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      displayMode: ['full', 'panel', 'custom'].includes(parsed.displayMode)
        ? parsed.displayMode
        : undefined,
      widgetMode: ['full', 'panel'].includes(parsed.widgetMode)
        ? parsed.widgetMode
        : undefined,
      customWidth:
        typeof parsed.customWidth === 'number' && parsed.customWidth > 0
          ? parsed.customWidth
          : undefined,
      customHeight:
        typeof parsed.customHeight === 'number' && parsed.customHeight > 0
          ? parsed.customHeight
          : undefined,
    };
  } catch {
    return {};
  }
}

function saveConfig(state) {
  safeLocalStorageSetItem(
    STORAGE_KEY,
    JSON.stringify({
      displayMode: state.displayMode,
      widgetMode: state.widgetMode,
      customWidth: state.customWidth,
      customHeight: state.customHeight,
    }),
  );
}

// ── Default modes ──────────────────────────────────────────────

/**
 * Both the widget and the fullscreen companion default to 'panel' (720×480) —
 * the standard HA deployment where the side panel reserves 80px. Either can be
 * switched to 'full' (800×480) independently via the Settings tab; the choice
 * is persisted to localStorage so it only needs to be set once.
 */
function detectDefaultMode() {
  return 'panel';
}

// ── Initial state (merge saved + defaults) ─────────────────────

const saved = loadSavedConfig();
const initialDisplayMode = saved.displayMode ?? detectDefaultMode();
const initialWidgetMode = saved.widgetMode ?? detectDefaultMode();
const initialCustomWidth = saved.customWidth ?? SCREEN_WIDTH;
const initialCustomHeight = saved.customHeight ?? SCREEN_HEIGHT;

// ── Store ──────────────────────────────────────────────────────

export const useDisplayConfigStore = create(
  immer((set, get) => ({
    /** Fullscreen-companion display mode: 'full' | 'panel' | 'custom' */
    displayMode: initialDisplayMode,

    /** Primary widget size mode: 'full' | 'panel' (independent of displayMode) */
    widgetMode: initialWidgetMode,

    /** Custom pixel dimensions (used when displayMode === 'custom') */
    customWidth: initialCustomWidth,
    customHeight: initialCustomHeight,

    /** Whether the user has confirmed the grid size for the current document. */
    gridSizeConfirmed: false,

    // ── Actions ──

    setDisplayMode(mode) {
      if (mode !== 'full' && mode !== 'panel' && mode !== 'custom') return;
      set((state) => {
        state.displayMode = mode;
      });
    },

    /** Set the primary widget size mode. Only the two presets — the primary
     *  has no custom size. */
    setWidgetMode(mode) {
      if (mode !== 'full' && mode !== 'panel') return;
      set((state) => {
        state.widgetMode = mode;
      });
    },

    setCustomSize(width, height) {
      set((state) => {
        state.customWidth = Math.max(1, Math.min(4096, Math.round(width)));
        state.customHeight = Math.max(1, Math.min(4096, Math.round(height)));
      });
    },

    confirmGridSize() {
      set((state) => {
        state.gridSizeConfirmed = true;
      });
    },

    resetGridSizeConfirmation() {
      set((state) => {
        state.gridSizeConfirmed = false;
      });
    },

    /**
     * Get the base screen dimensions for a given doc role. The primary widget
     * and the fullscreen companion read independent settings so resizing one
     * never affects the other.
     *
     * @param {'primary'|'companion'} [role] Defaults to companion behavior so
     *   existing no-arg callers (e.g. the mapper's fullscreen branch) are
     *   unaffected.
     * @returns {{ width: number, height: number }}
     */
    getScreenSize(role) {
      const { displayMode, widgetMode, customWidth, customHeight } = get();
      if (role === 'primary') {
        // Primary has presets only — no custom size.
        return DISPLAY_PRESETS[widgetMode] ?? DISPLAY_PRESETS.panel;
      }
      if (displayMode === 'custom') {
        return { width: customWidth, height: customHeight };
      }
      return DISPLAY_PRESETS[displayMode] ?? DISPLAY_PRESETS.panel;
    },
  })),
);

// Persist settings to localStorage on every state change.
useDisplayConfigStore.subscribe((state) => saveConfig(state));

// ── Convenience accessor ───────────────────────────────────────

export function getDisplayConfig() {
  return useDisplayConfigStore.getState();
}
