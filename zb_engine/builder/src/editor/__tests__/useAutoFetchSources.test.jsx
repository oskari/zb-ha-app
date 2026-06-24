/**
 * useAutoFetchSources.test.jsx — Canvas source auto-refetch hook coverage.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useUiStore } from '../../store/uiStore.js';
import { useAutoFetchSources } from '../useAutoFetchSources.js';
import { _resetQueueForTests } from '../sourceTestQueue.js';

function resetUiStore() {
  useUiStore.setState({
    sourceResponsesById: {},
    sourceTestHandler: null,
    pendingSourceTests: 0,
  });
  _resetQueueForTests();
}

function httpSource(overrides = {}) {
  return {
    id: 'source_1',
    kind: 'http',
    method: 'GET',
    url: 'https://example.com/data.json',
    responseType: 'json',
    enabled: true,
    ...overrides,
  };
}

describe('useAutoFetchSources', () => {
  beforeEach(() => {
    resetUiStore();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('tests a valid source on initial load and caches object data', async () => {
    const testHandler = vi.fn(async () => ({ data: { temperature: 22 } }));
    useUiStore.getState().setSourceTestHandler(testHandler);

    renderHook(() => useAutoFetchSources([httpSource()]));

    await waitFor(() => {
      expect(testHandler).toHaveBeenCalledTimes(1);
      expect(useUiStore.getState().sourceResponsesById.source_1?.data).toEqual({ temperature: 22 });
    });
    expect(testHandler.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: 'source_1',
      response: { type: 'json' },
    }));
  });

  it('caches primitive (number) source data on initial load', async () => {
    // A source whose value resolves to a bare number/string (e.g. a text
    // HTTP source or an haState `attribute`) must still populate the canvas
    // cache — the old object-only guard dropped these so bound elements
    // showed "(no data)" despite a successful fetch.
    const testHandler = vi.fn(async () => ({ data: 42 }));
    useUiStore.getState().setSourceTestHandler(testHandler);

    renderHook(() => useAutoFetchSources([httpSource()]));

    await waitFor(() => {
      expect(useUiStore.getState().sourceResponsesById.source_1?.data).toBe(42);
    });
  });

  it('caches a plain-text string value (text responseType)', async () => {
    const testHandler = vi.fn(async () => ({ data: 'hello' }));
    useUiStore.getState().setSourceTestHandler(testHandler);

    renderHook(() => useAutoFetchSources([httpSource({ responseType: 'text' })]));

    await waitFor(() => {
      const entry = useUiStore.getState().sourceResponsesById.source_1;
      expect(entry?.data).toBe('hello');
      expect(entry?.responseType).toBe('text');
    });
  });

  it('skips HA sources until the required entity_id is present', async () => {
    const testHandler = vi.fn(async () => ({ data: { state: 'on' } }));
    useUiStore.getState().setSourceTestHandler(testHandler);

    renderHook(() => useAutoFetchSources([
      { id: 'ha_1', kind: 'haState', entity_id: '', enabled: true },
    ]));

    await Promise.resolve();
    expect(testHandler).not.toHaveBeenCalled();
  });

  it('refetches when a data-affecting source field changes', async () => {
    const testHandler = vi
      .fn()
      .mockResolvedValueOnce({ data: { version: 1 } })
      .mockResolvedValueOnce({ data: { version: 2 } });
    useUiStore.getState().setSourceTestHandler(testHandler);

    const { rerender } = renderHook(
      ({ source }) => useAutoFetchSources([source]),
      { initialProps: { source: httpSource({ query: { page: 1 } }) } },
    );

    await waitFor(() => {
      expect(useUiStore.getState().sourceResponsesById.source_1?.data).toEqual({ version: 1 });
    });

    rerender({ source: httpSource({ query: { page: 2 } }) });

    // The per-source debounce inside `sourceTestQueue` enforces a 5 s
    // minimum interval between tests of the same source — a rapid
    // re-edit waits out the floor before the second handler call fires.
    await waitFor(() => {
      expect(testHandler).toHaveBeenCalledTimes(2);
      expect(useUiStore.getState().sourceResponsesById.source_1?.data).toEqual({ version: 2 });
    }, { timeout: 7000 });
  }, 10_000);
});

// ── Task 6: queue throttler behavior ───────────────────────────

describe('useAutoFetchSources — source-test queue throttling', () => {
  beforeEach(() => {
    resetUiStore();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  function makeBatch(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        id: `s_${i}`,
        kind: 'http',
        method: 'GET',
        url: `https://example.com/api/${i}`,
        responseType: 'json',
        enabled: true,
      });
    }
    return out;
  }

  it('caps in-flight tests at 3 and respects the rolling 60s start budget', async () => {
    let concurrent = 0;
    let peakConcurrent = 0;
    const startTimes = [];
    const releasers = [];

    const testHandler = vi.fn(() => {
      startTimes.push(Date.now());
      concurrent += 1;
      if (concurrent > peakConcurrent) peakConcurrent = concurrent;
      return new Promise((resolve) => {
        // Release each test after a short delay so the queue can drain.
        const release = () => {
          concurrent -= 1;
          resolve({ data: { ok: true } });
        };
        releasers.push(release);
      });
    });
    useUiStore.getState().setSourceTestHandler(testHandler);

    renderHook(() => useAutoFetchSources(makeBatch(50)));

    // Drain the initial 200ms-stagger so every source has been enqueued.
    await vi.advanceTimersByTimeAsync(50 * 200 + 100);

    // First three should be in flight (max-in-flight=3); rest queued.
    expect(peakConcurrent).toBeLessThanOrEqual(3);

    // Drain the queue: release in-flight tests, advance time. After the
    // rolling rate cap of 25 starts within 60 s is reached, the
    // dispatcher idles until the window slides — keep the clock moving
    // until the queue drains. Capped iteration count avoids hangs in CI.
    let safety = 200;
    while ((releasers.length > 0 || concurrent > 0 || testHandler.mock.calls.length < 50) && safety-- > 0) {
      while (releasers.length > 0) releasers.shift()();
      // Big jump so we cross the 60 s rolling-window boundary as needed.
      await vi.advanceTimersByTimeAsync(2_000);
    }
    while (releasers.length > 0) releasers.shift()();
    await vi.advanceTimersByTimeAsync(2_000);

    // Every source must eventually be tested.
    expect(testHandler).toHaveBeenCalledTimes(50);

    // Peak concurrency stayed within the cap throughout.
    expect(peakConcurrent).toBeLessThanOrEqual(3);

    // No rolling 60 s window may contain ≥30 starts (server limit).
    for (let i = 0; i < startTimes.length; i++) {
      let inWindow = 0;
      for (let j = i; j < startTimes.length; j++) {
        if (startTimes[j] - startTimes[i] < 60_000) inWindow += 1;
        else break;
      }
      expect(inWindow).toBeLessThan(30);
    }
  }, 30_000);

  it('time-to-first-test for source[0] is under 250 ms', async () => {
    const t0 = Date.now();
    let firstAt = -1;
    const testHandler = vi.fn(() => {
      if (firstAt < 0) firstAt = Date.now() - t0;
      return Promise.resolve({ data: { ok: true } });
    });
    useUiStore.getState().setSourceTestHandler(testHandler);

    renderHook(() => useAutoFetchSources(makeBatch(50)));

    // First source enqueues with delay=0 → one timer tick suffices.
    await vi.advanceTimersByTimeAsync(50);

    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(firstAt).toBeLessThan(250);
  }, 10_000);
});

