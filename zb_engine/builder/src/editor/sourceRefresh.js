/**
 * sourceRefresh.js — Shared source-test runner + bulk canvas refresh.
 *
 * Both the auto-fetch hook (`useAutoFetchSources`) and the manual
 * "Refresh data" toolbar action fetch a source's live value the same way:
 * call the platform `sourceTestHandler`, normalize against the source's
 * `responseType`, and cache any non-null result on the canvas. Centralising
 * that here keeps the two paths byte-for-byte identical and routes every
 * fetch through `sourceTestQueue` so the server `RATE_LIMIT_SOURCE_TEST`
 * budget is respected no matter who triggers it.
 */

import { normalizeSourceForExport } from '../models/mapper.js';
import { normalizeResponseData } from '../utils/responseData.js';
import { useUiStore } from '../store/uiStore.js';
import { enqueueSourceTest } from './sourceTestQueue.js';

/**
 * A source is fetchable when it has an id and — for HA kinds — a non-empty
 * `entity_id` (the required field may not be set yet). HTTP sources are
 * always fetchable; an empty URL simply fails at fetch time, non-fatally.
 */
export function isSourceFetchable(source) {
  if (!source?.id) return false;
  if ((source.kind === 'haState' || source.kind === 'haHistory' || source.kind === 'haCalendar') && !source.entity_id) {
    return false;
  }
  return true;
}

/**
 * Build the queue runner that tests one source and caches its live value.
 *
 * Overwrite-on-success only: a null/failed normalization leaves the prior
 * cache entry untouched, so a transient fetch failure never clobbers the
 * last-good value the canvas is showing. The abort `signal` fires only when
 * a newer test for the same source was queued before this one's turn, so we
 * drop stale results and keep the cache on the latest config.
 */
export function makeSourceTestRunner(source) {
  return async (signal) => {
    const testHandler = useUiStore.getState().sourceTestHandler;
    if (!testHandler) return;
    const result = await testHandler(normalizeSourceForExport(source));
    if (signal?.aborted) return;
    // Primitive results (a text/HTTP source or an haState `attribute`
    // resolving to a string/number) must populate the cache too — a plain
    // `typeof === 'object'` guard would silently drop them and leave bound
    // text/graph elements showing "(no data)" despite a successful fetch.
    const responseType = source.responseType || 'json';
    const normalized = normalizeResponseData(responseType, result?.data);
    if (normalized != null) {
      useUiStore.getState().setSourceResponse(source.id, {
        receivedAt: new Date().toISOString(),
        responseType,
        data: normalized,
      });
    }
  };
}

/**
 * Re-fetch every fetchable source through the throttled queue, bypassing the
 * auto-fetch hook's once-per-mount gate (so unchanged sources refresh too).
 * Does NOT clear existing responses first — the canvas keeps its last-good
 * values until a fresh one arrives. No-op when no platform handler is wired
 * (standalone). Returns the number of sources queued.
 */
export function refreshAllSources(sources) {
  if (!sources || !useUiStore.getState().sourceTestHandler) return 0;
  let count = 0;
  for (const source of sources) {
    if (!isSourceFetchable(source)) continue;
    enqueueSourceTest(source.id, makeSourceTestRunner(source));
    count += 1;
  }
  return count;
}
