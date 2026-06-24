/**
 * displayConfigStore.test.js — independent widget vs companion sizing.
 *
 * The primary widget (widgetMode) and the fullscreen companion (displayMode)
 * read separate settings so resizing one never affects the other.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useDisplayConfigStore,
  DISPLAY_PRESETS,
  getDisplayConfig,
} from '../displayConfigStore.js';

const FULL = { width: 800, height: 480 };
const PANEL = { width: 720, height: 480 };

beforeEach(() => {
  // Reset to defaults (panel/panel) via the public actions.
  const s = useDisplayConfigStore.getState();
  s.setDisplayMode('panel');
  s.setWidgetMode('panel');
  s.setCustomSize(800, 480);
});

describe('DISPLAY_PRESETS', () => {
  it('full is 800×480 and panel is 720×480', () => {
    expect(DISPLAY_PRESETS.full).toEqual(FULL);
    expect(DISPLAY_PRESETS.panel).toEqual(PANEL);
  });
});

describe('getScreenSize(role)', () => {
  it('defaults to panel (720×480) for both roles', () => {
    expect(getDisplayConfig().getScreenSize('primary')).toEqual(PANEL);
    expect(getDisplayConfig().getScreenSize('companion')).toEqual(PANEL);
  });

  it('a no-arg call resolves the companion (display mode) — keeps existing callers working', () => {
    useDisplayConfigStore.getState().setDisplayMode('full');
    expect(getDisplayConfig().getScreenSize()).toEqual(FULL);
  });

  it('widget and companion sizes are independent', () => {
    // Make the widget full; companion must stay panel.
    useDisplayConfigStore.getState().setWidgetMode('full');
    expect(getDisplayConfig().getScreenSize('primary')).toEqual(FULL);
    expect(getDisplayConfig().getScreenSize('companion')).toEqual(PANEL);

    // Now flip them: companion full, widget panel.
    useDisplayConfigStore.getState().setWidgetMode('panel');
    useDisplayConfigStore.getState().setDisplayMode('full');
    expect(getDisplayConfig().getScreenSize('primary')).toEqual(PANEL);
    expect(getDisplayConfig().getScreenSize('companion')).toEqual(FULL);
  });

  it('companion supports custom size; primary ignores custom and stays on its preset', () => {
    useDisplayConfigStore.getState().setDisplayMode('custom');
    useDisplayConfigStore.getState().setCustomSize(640, 384);
    expect(getDisplayConfig().getScreenSize('companion')).toEqual({ width: 640, height: 384 });
    expect(getDisplayConfig().getScreenSize('primary')).toEqual(PANEL);
  });
});

describe('setWidgetMode', () => {
  it('accepts the two presets', () => {
    useDisplayConfigStore.getState().setWidgetMode('full');
    expect(useDisplayConfigStore.getState().widgetMode).toBe('full');
    useDisplayConfigStore.getState().setWidgetMode('panel');
    expect(useDisplayConfigStore.getState().widgetMode).toBe('panel');
  });

  it('rejects "custom" and invalid values — the primary has no custom size', () => {
    useDisplayConfigStore.getState().setWidgetMode('full');
    useDisplayConfigStore.getState().setWidgetMode('custom');
    expect(useDisplayConfigStore.getState().widgetMode).toBe('full');
    useDisplayConfigStore.getState().setWidgetMode('nonsense');
    expect(useDisplayConfigStore.getState().widgetMode).toBe('full');
  });
});
