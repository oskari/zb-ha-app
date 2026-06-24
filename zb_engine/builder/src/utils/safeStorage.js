/**
 * safeStorage.js — small localStorage guard for persisted UI preferences.
 *
 * Browsers can throw while reading `localStorage` (private mode, blocked
 * storage, quota errors, or malformed environment shims). These helpers keep
 * those failures recoverable so the Builder can still start with defaults.
 */

export function safeLocalStorageGetItem(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeLocalStorageSetItem(key, value) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageRemoveItem(key) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
