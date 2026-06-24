/**
 * useAutoSave.test.js — Integration tests for auto-save hook.
 *
 * Tests verify observable behavior: when store state changes in specific
 * patterns, the correct API calls fire and docStore dirty state updates.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// ── Mock dependencies ────────────────────────────────────────────────

// Mock apiClient — intercept saveWidget calls.
vi.mock('../apiClient.js', () => ({
  saveWidget: vi.fn(() => Promise.resolve()),
}));

// Mock displayConfigStore — needed by docStore internally.
vi.mock('../../store/displayConfigStore.js', () => {
  const confirmGridSize = vi.fn();
  const resetGridSizeConfirmation = vi.fn();
  const getScreenSize = vi.fn(() => ({ width: 800, height: 480 }));
  return {
    getDisplayConfig: () => ({
      getScreenSize,
      confirmGridSize,
      resetGridSizeConfirmation,
    }),
  };
});

// Mock ids — deterministic IDs.
let _idCounter = 0;
vi.mock('../../utils/ids.js', () => ({
  createId: () => `test-id-${++_idCounter}`,
}));

// Mock mapper — lightweight pass-through so we don't pull in the full mapper.
vi.mock('../../models/mapper.js', () => ({
  importRuntimeJson: (json) => ({
    misc: { gridSize: '1x1', size: { width: 240, height: 240 }, tags: [], ...json?.misc },
    elements: json?.elements ?? [],
    sources: json?.sources ?? [],
    features: json?.features ?? { definitions: {}, values: {} },
  }),
  exportRuntimeJson: (doc) => ({ ...doc }),
  createNameGeneratorFromElements: () => (type) => `${type}_1`,
}));

import { useDocStore } from '../../store/docStore.js';
import { useWidgetStore } from '../widgetStore.js';
import { useAutoSaveStore } from '../autoSaveStore.js';
import { saveWidget } from '../apiClient.js';
import { useAutoSave } from '../useAutoSave.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Reset all stores to a clean slate. */
function resetStores() {
  useDocStore.setState({ focusedDocId: null, docs: {} });
  useWidgetStore.setState({
    widgets: [],
    activeWidgetId: null,
    activeWidgetName: '',
    loading: false,
    saving: false,
    error: null,
  });
  useAutoSaveStore.setState({
    enabled: false,
    lastSavedAt: null,
    saving: false,
    lastError: null,
  });
  _idCounter = 0;
}

/** Set up a standard widget in both widgetStore and docStore. */
function setupWidget(id, name = 'Test Widget') {
  // Set up docStore entry
  useDocStore.getState().openDoc(id, {
    misc: { gridSize: '1x1' },
    elements: [],
    sources: [],
    features: {},
  });
  useDocStore.getState().switchFocus(id);

  // Set up widgetStore
  useWidgetStore.setState({
    activeWidgetId: id,
    activeWidgetName: name,
    widgets: [{ id, name }],
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useAutoSave', () => {
  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('doc edit with autosave enabled triggers debounced save', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Mutate the doc — triggers subscription
    act(() => {
      useDocStore.getState().addElement('rect');
    });

    // Not called immediately (debounced)
    expect(saveWidget).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(5500);
      // Flush microtasks for async _doSave
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).toHaveBeenCalledTimes(1);
    expect(saveWidget).toHaveBeenCalledWith('w1', expect.objectContaining({
      name: 'Test Widget',
      doc: expect.any(Object),
      fullscreen: null,
    }));

    // markClean should have been called
    expect(useDocStore.getState().docs['w1'].dirty).toBe(false);
  });

  it('doc edit with autosave disabled does NOT trigger save', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: false });

    renderHook(() => useAutoSave());

    act(() => {
      useDocStore.getState().addElement('rect');
    });

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).not.toHaveBeenCalled();
  });

  it('name change with clean doc triggers save (forceNameSave)', async () => {
    setupWidget('w1', 'Original Name');
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Simulate a widget switch to initialize the name baseline
    act(() => {
      useWidgetStore.setState({
        activeWidgetId: 'w1',
        activeWidgetName: 'Original Name',
      });
    });

    // Now change the name — doc is NOT dirty
    expect(useDocStore.getState().docs['w1'].dirty).toBe(false);
    act(() => {
      useWidgetStore.setState({ activeWidgetName: 'Renamed Widget' });
    });

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    // Save should have been called despite doc not being dirty
    expect(saveWidget).toHaveBeenCalledTimes(1);
    expect(saveWidget).toHaveBeenCalledWith('w1', expect.objectContaining({
      name: 'Renamed Widget',
      doc: expect.any(Object),
      fullscreen: null,
    }));
  });

  it('name reverted to last-saved value skips redundant save', async () => {
    setupWidget('w1', 'Original Name');
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Trigger a real widget switch to initialize the name baseline.
    // Switch away to null, then back to w1 so the subscription fires.
    act(() => {
      useWidgetStore.setState({ activeWidgetId: null, activeWidgetName: '' });
    });
    act(() => {
      useWidgetStore.setState({ activeWidgetId: 'w1', activeWidgetName: 'Original Name' });
    });

    // Rename to something new, then revert back to the baseline
    act(() => {
      useWidgetStore.setState({ activeWidgetName: 'Temporary Name' });
    });
    act(() => {
      useWidgetStore.setState({ activeWidgetName: 'Original Name' });
    });

    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    // Should NOT save — name is back to the last-saved value
    expect(saveWidget).not.toHaveBeenCalled();
  });

  it('widget switch flushes departing widget save immediately', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Edit w1 to start a debounce timer
    act(() => {
      useDocStore.getState().addElement('rect');
    });

    // Now switch to w2 (simulating widgetStore update)
    // First set up w2 in docStore
    act(() => {
      useDocStore.getState().openDoc('w2', {
        misc: { gridSize: '1x1' },
        elements: [],
        sources: [],
        features: {},
      });
    });

    // Switch widget — should flush w1's pending save
    act(() => {
      useWidgetStore.setState({ activeWidgetId: 'w2', activeWidgetName: 'Widget 2' });
    });

    // The flush fires _doSave immediately (synchronously triggers async)
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).toHaveBeenCalledTimes(1);
    expect(saveWidget).toHaveBeenCalledWith('w1', expect.objectContaining({
      name: 'Test Widget',
      doc: expect.any(Object),
      fullscreen: null,
    }));
  });

  it('toggle autosave ON with dirty doc triggers immediate save', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: false });

    renderHook(() => useAutoSave());

    // Dirty the doc while autosave is off
    act(() => {
      useDocStore.getState().addElement('rect');
    });
    expect(useDocStore.getState().docs['w1'].dirty).toBe(true);

    // Turn on autosave
    act(() => {
      useAutoSaveStore.setState({ enabled: true });
    });

    // Should schedule an immediate save (0ms timeout = next tick)
    await act(async () => {
      vi.advanceTimersByTime(50);
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).toHaveBeenCalledTimes(1);
  });

  it('_doSave skips when widgetStore is already saving', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: true });
    useWidgetStore.setState({ saving: true }); // manual save in progress

    renderHook(() => useAutoSave());

    act(() => {
      useDocStore.getState().addElement('rect');
    });

    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).not.toHaveBeenCalled();
  });

  it('second edit resets debounce timer (only one save fires)', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // First edit
    act(() => {
      useDocStore.getState().addElement('rect');
    });

    // Wait 3s (less than 5s debounce), then second edit
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    act(() => {
      useDocStore.getState().addElement('text');
    });

    // Advance 5.5s from second edit — should trigger exactly 1 save total
    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    // Only one save — the timer was reset by the second edit
    expect(saveWidget).toHaveBeenCalledTimes(1);
  });

  // ── Companion-presence triggers ───────────────────────────────────

  it('adding a fullscreen companion triggers a debounced save with the companion in the body', async () => {
    setupWidget('w1');
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Open the companion entry — equivalent to ensureFullscreenCompanion,
    // which also marks the primary dirty so _doSave actually fires.
    act(() => {
      useDocStore.getState().openDoc('w1::fullscreen', {
        misc: { gridSize: '3x2' },
        elements: [],
        sources: [],
        features: {},
      });
      useDocStore.setState((s) => { s.docs['w1'].dirty = true; });
    });

    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).toHaveBeenCalledTimes(1);
    expect(saveWidget).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        name: 'Test Widget',
        fullscreen: expect.objectContaining({
          misc: expect.objectContaining({ gridSize: '3x2' }),
        }),
      }),
    );
  });

  it('removing a fullscreen companion triggers a save with fullscreen=null', async () => {
    setupWidget('w1');
    // Pre-seed a companion entry so the hook's first snapshot sees it.
    useDocStore.getState().openDoc('w1::fullscreen', {
      misc: { gridSize: '3x2' },
      elements: [],
      sources: [],
      features: {},
    });
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Now delete the companion — equivalent to deleteFullscreenCompanion,
    // which marks the primary dirty so the next save writes fullscreen=null.
    act(() => {
      useDocStore.getState().closeDoc('w1::fullscreen');
      useDocStore.setState((s) => { s.docs['w1'].dirty = true; });
    });

    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).toHaveBeenCalledTimes(1);
    expect(saveWidget).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ name: 'Test Widget', fullscreen: null }),
    );
  });

  it('editing inside the companion doc triggers a debounced save', async () => {
    setupWidget('w1');
    useDocStore.getState().openDoc('w1::fullscreen', {
      misc: { gridSize: '3x2' },
      elements: [],
      sources: [],
      features: {},
    });
    useAutoSaveStore.setState({ enabled: true });

    renderHook(() => useAutoSave());

    // Focus into the companion and add an element.
    act(() => {
      useDocStore.getState().switchFocus('w1::fullscreen');
    });
    act(() => {
      useDocStore.getState().addElement('rect');
    });

    await act(async () => {
      vi.advanceTimersByTime(5500);
      await vi.runAllTimersAsync();
    });

    expect(saveWidget).toHaveBeenCalledTimes(1);
    expect(saveWidget).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        fullscreen: expect.objectContaining({
          elements: expect.any(Array),
        }),
      }),
    );
  });
});
