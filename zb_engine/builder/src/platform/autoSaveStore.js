/**
 * autoSaveStore.js — Zustand store for auto-save state
 *
 * Manages auto-save toggle preference and last-saved timestamp.
 * Persisted to localStorage so the preference survives reloads.
 *
 * ENGINEERING_CONSTRAINTS: Lives in platform/ — persistence is a platform concern.
 */

import { create } from 'zustand';
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../utils/safeStorage.js';

const LS_KEY = 'zb-autosave';

function loadPreference() {
  try {
    const raw = safeLocalStorageGetItem(LS_KEY);
    if (raw !== null) return JSON.parse(raw);
  } catch (err) {
    console.warn('[autoSave] Corrupt localStorage data — resetting to defaults.', err);
  }
  return { enabled: false };
}

function savePreference(enabled) {
  safeLocalStorageSetItem(LS_KEY, JSON.stringify({ enabled }));
}

export const useAutoSaveStore = create((set) => ({
  enabled: loadPreference().enabled,
  lastSavedAt: null,   // epoch ms of last successful auto-save
  saving: false,
  lastError: null,     // error message from most recent failed auto-save

  /** Toggle auto-save on/off. Persists to localStorage. */
  toggle() {
    set((state) => {
      const next = !state.enabled;
      savePreference(next);
      return { enabled: next };
    });
  },

  /** Mark auto-save as in-progress. */
  setSaving(saving) {
    set({ saving });
  },

  /** Record a successful auto-save timestamp and clear any prior error. */
  markSaved() {
    set({ lastSavedAt: Date.now(), saving: false, lastError: null });
  },

  /** Record a failed auto-save attempt. */
  markFailed(message) {
    set({ saving: false, lastError: message });
  },

  /** Clear the error state (e.g. after the user dismisses it). */
  clearError() {
    set({ lastError: null });
  },
}));
