/**
 * safeStorage.test.js — localStorage guard tests.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  safeLocalStorageRemoveItem,
} from '../safeStorage.js';

describe('safeStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads, writes, and removes when localStorage is available', () => {
    const storage = {
      getItem: vi.fn(() => 'stored'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', storage);

    expect(safeLocalStorageGetItem('key')).toBe('stored');
    expect(safeLocalStorageSetItem('key', 'value')).toBe(true);
    expect(safeLocalStorageRemoveItem('key')).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith('key');
    expect(storage.setItem).toHaveBeenCalledWith('key', 'value');
    expect(storage.removeItem).toHaveBeenCalledWith('key');
  });

  it('returns safe fallbacks when storage operations throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('quota'); }),
      removeItem: vi.fn(() => { throw new Error('blocked'); }),
    });

    expect(safeLocalStorageGetItem('key')).toBeNull();
    expect(safeLocalStorageSetItem('key', 'value')).toBe(false);
    expect(safeLocalStorageRemoveItem('key')).toBe(false);
  });

  it('treats missing localStorage as unavailable', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(safeLocalStorageGetItem('key')).toBeNull();
    expect(safeLocalStorageSetItem('key', 'value')).toBe(false);
    expect(safeLocalStorageRemoveItem('key')).toBe(false);
  });
});
