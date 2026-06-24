/**
 * companionId.test.js — unit tests for fullscreen companion ID helpers
 *
 * Verifies the round-trip and collision-safety guarantees documented in
 * `companionId.js`.
 */

import { describe, it, expect } from 'vitest';
import {
  FULLSCREEN_SUFFIX,
  fullscreenIdFor,
  isFullscreenId,
  primaryIdOf,
} from '../companionId.js';

describe('fullscreenIdFor', () => {
  it('appends the fullscreen suffix to a primary widget id', () => {
    expect(fullscreenIdFor('widget_abc_123')).toBe(`widget_abc_123${FULLSCREEN_SUFFIX}`);
  });

  it('returns null for falsy / non-string input', () => {
    expect(fullscreenIdFor('')).toBeNull();
    expect(fullscreenIdFor(null)).toBeNull();
    expect(fullscreenIdFor(undefined)).toBeNull();
    expect(fullscreenIdFor(42)).toBeNull();
  });
});

describe('isFullscreenId', () => {
  it('accepts a derived companion id', () => {
    expect(isFullscreenId('foo::fullscreen')).toBe(true);
  });

  it('rejects a primary widget id (no suffix)', () => {
    expect(isFullscreenId('widget_abc_123')).toBe(false);
  });

  it('rejects the bare suffix on its own (no widget portion)', () => {
    expect(isFullscreenId(FULLSCREEN_SUFFIX)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isFullscreenId(null)).toBe(false);
    expect(isFullscreenId(undefined)).toBe(false);
    expect(isFullscreenId(123)).toBe(false);
  });
});

describe('primaryIdOf', () => {
  it('strips the suffix from a companion id', () => {
    expect(primaryIdOf('widget_abc::fullscreen')).toBe('widget_abc');
  });

  it('returns the input unchanged for a primary id', () => {
    expect(primaryIdOf('widget_abc')).toBe('widget_abc');
  });
});

describe('round-trip', () => {
  it('fullscreenIdFor → primaryIdOf is identity for valid ids', () => {
    const id = 'widget_xyz_42';
    expect(primaryIdOf(fullscreenIdFor(id))).toBe(id);
  });
});

describe('collision safety', () => {
  it('the suffix is not allowed in the server-side widget ID regex', () => {
    // Widget IDs must match /^[a-z0-9_-]+$/i per src/core/widgetService.ts.
    // The double-colon in FULLSCREEN_SUFFIX is therefore unrepresentable in
    // any real widget ID, guaranteeing companion ids never collide.
    const SERVER_WIDGET_ID_RE = /^[a-z0-9_-]+$/i;
    expect(SERVER_WIDGET_ID_RE.test(FULLSCREEN_SUFFIX)).toBe(false);
    expect(SERVER_WIDGET_ID_RE.test(fullscreenIdFor('legitimate_id'))).toBe(false);
  });
});
