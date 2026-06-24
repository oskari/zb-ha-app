/**
 * sourceRefresh.test.js — Shared source-test runner + bulk refresh coverage.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useUiStore } from '../../store/uiStore.js';
import { _resetQueueForTests } from '../sourceTestQueue.js';
import { isSourceFetchable, refreshAllSources } from '../sourceRefresh.js';

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

describe('isSourceFetchable', () => {
  it('accepts an http source with an id', () => {
    expect(isSourceFetchable(httpSource())).toBe(true);
  });

  it('rejects a source without an id', () => {
    expect(isSourceFetchable({ kind: 'http' })).toBe(false);
  });

  it('rejects HA sources until entity_id is set, then accepts them', () => {
    expect(isSourceFetchable({ id: 'ha_1', kind: 'haState', entity_id: '' })).toBe(false);
    expect(isSourceFetchable({ id: 'ha_1', kind: 'haState', entity_id: 'sensor.temp' })).toBe(true);
    expect(isSourceFetchable({ id: 'ha_2', kind: 'haHistory', entity_id: '' })).toBe(false);
  });
});

describe('refreshAllSources', () => {
  beforeEach(() => {
    resetUiStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op and returns 0 when no platform handler is wired', () => {
    expect(refreshAllSources([httpSource()])).toBe(0);
  });

  it('re-fetches every fetchable source and caches the live values', async () => {
    const testHandler = vi.fn(async (cfg) => ({ data: { url: cfg.url, ok: true } }));
    useUiStore.getState().setSourceTestHandler(testHandler);

    const sources = [
      httpSource({ id: 'a', url: 'https://example.com/a' }),
      httpSource({ id: 'b', url: 'https://example.com/b' }),
      { id: 'ha_pending', kind: 'haState', entity_id: '' }, // skipped — no entity
    ];

    const queued = refreshAllSources(sources);
    expect(queued).toBe(2); // the empty-entity HA source is skipped

    await waitFor(() => {
      const cache = useUiStore.getState().sourceResponsesById;
      expect(cache.a?.data).toEqual({ url: 'https://example.com/a', ok: true });
      expect(cache.b?.data).toEqual({ url: 'https://example.com/b', ok: true });
      expect(cache.ha_pending).toBeUndefined();
    });
    expect(testHandler).toHaveBeenCalledTimes(2);
  });

  it('bypasses the once-per-mount gate: re-fetches the same source on every call', async () => {
    const testHandler = vi
      .fn()
      .mockResolvedValueOnce({ data: { v: 1 } })
      .mockResolvedValueOnce({ data: { v: 2 } });
    useUiStore.getState().setSourceTestHandler(testHandler);

    refreshAllSources([httpSource()]);
    await waitFor(() => {
      expect(useUiStore.getState().sourceResponsesById.source_1?.data).toEqual({ v: 1 });
    });

    refreshAllSources([httpSource()]);
    // Per-source 5s debounce in the queue gates the second fetch; wait it out.
    await waitFor(() => {
      expect(testHandler).toHaveBeenCalledTimes(2);
      expect(useUiStore.getState().sourceResponsesById.source_1?.data).toEqual({ v: 2 });
    }, { timeout: 7000 });
  }, 10_000);

  it('does not clear existing cached values up front (overwrite-on-success only)', () => {
    // A handler that never resolves — the fetch is in flight, not yet cached.
    useUiStore.getState().setSourceTestHandler(() => new Promise(() => {}));
    useUiStore.getState().setSourceResponse('source_1', {
      receivedAt: '2026-06-19T00:00:00.000Z',
      responseType: 'json',
      data: { stale: true },
    });

    refreshAllSources([httpSource()]);

    // Synchronously after queueing, the last-good value is still on the canvas.
    expect(useUiStore.getState().sourceResponsesById.source_1?.data).toEqual({ stale: true });
  });
});
