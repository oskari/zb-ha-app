import { useEffect, useRef } from 'react';
import { useUiStore } from '../store/uiStore.js';
import { enqueueSourceTest, cancelPendingSourceTest } from './sourceTestQueue.js';
import { isSourceFetchable, makeSourceTestRunner } from './sourceRefresh.js';

/** Stagger between scheduling decisions on initial widget load (ms). */
const INITIAL_STAGGER_MS = 200;

function sourceFingerprint(source) {
  return JSON.stringify({
    kind: source.kind,
    entity_id: source.entity_id,
    hoursBack: source.hoursBack,
    attribute: source.attribute,
    daysAhead: source.daysAhead,
    maxEvents: source.maxEvents,
    includeOngoing: source.includeOngoing,
    locale: source.locale,
    eventFilter: source.eventFilter,
    url: source.url,
    method: source.method,
    query: source.query,
    headers: source.headers,
    auth: source.auth,
    bodyType: source.bodyType,
    body: source.body,
    responseType: source.responseType,
    enabled: source.enabled,
  });
}

/**
 * Auto-refetch tested source data when a source's data-affecting config
 * changes.
 *
 * Fetches go through `sourceTestQueue` so a widget with many sources
 * cannot trip the server-side `RATE_LIMIT_SOURCE_TEST` budget or fan
 * out 50 simultaneous HTTP calls. On initial load we stagger queue
 * scheduling by `INITIAL_STAGGER_MS` so source[0] starts promptly
 * without synchronously enqueuing every source at once.
 *
 * Failures remain non-fatal for the canvas preview.
 */
export function useAutoFetchSources(sources) {
  const prevSourceFingerprintRef = useRef({});
  const testedSourceIdsRef = useRef(new Set());
  const initialStaggerTimersRef = useRef(new Map());

  useEffect(() => {
    if (!sources) return;
    const testHandler = useUiStore.getState().sourceTestHandler;
    const clearSourceResponse = useUiStore.getState().clearSourceResponse;
    const prev = prevSourceFingerprintRef.current;
    const next = {};

    let staggerIndex = 0;
    for (const source of sources) {
      // Skip sources without an id and HA sources whose required entity_id
      // is not set yet — shared with the manual "Refresh data" action.
      if (!isSourceFetchable(source)) continue;

      const fp = sourceFingerprint(source);
      next[source.id] = fp;

      // Fetch if: config changed OR source was never requested (initial load).
      const configChanged = prev[source.id] && prev[source.id] !== fp;
      const neverTested = !testedSourceIdsRef.current.has(source.id);

      if ((configChanged || neverTested) && testHandler) {
        if (configChanged) clearSourceResponse(source.id);
        testedSourceIdsRef.current.add(source.id);

        const enqueue = () => {
          initialStaggerTimersRef.current.delete(source.id);
          // Same runner the manual "Test Source"/"Refresh data" paths use:
          // normalize against the source's responseType and cache any
          // non-null value (primitives included), overwrite-on-success only.
          enqueueSourceTest(source.id, makeSourceTestRunner(source));
        };

        // Cancel any prior staggered enqueue for this source so a rapid
        // re-edit during the initial-load window collapses to one queue
        // entry rather than two.
        const prevTimer = initialStaggerTimersRef.current.get(source.id);
        if (prevTimer != null) clearTimeout(prevTimer);

        if (configChanged) {
          // Config edits are user-driven and infrequent — enqueue
          // immediately. The queue's per-source debounce still
          // collapses rapid edits.
          enqueue();
        } else {
          // Initial-load batch: spread queue insertions across time so
          // the very first eligible source starts promptly without
          // synchronously building a 50-deep queue.
          const delay = staggerIndex * INITIAL_STAGGER_MS;
          staggerIndex += 1;
          if (delay === 0) {
            enqueue();
          } else {
            const handle = setTimeout(enqueue, delay);
            initialStaggerTimersRef.current.set(source.id, handle);
          }
        }
      }
    }
    prevSourceFingerprintRef.current = next;
  }, [sources]);

  // Cancel pending stagger timers + queue entries on unmount so the
  // dispatcher does not fire tests for a hook that is no longer alive.
  useEffect(() => {
    const timers = initialStaggerTimersRef.current;
    const tested = testedSourceIdsRef.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
      for (const id of tested) cancelPendingSourceTest(id);
    };
  }, []);
}
