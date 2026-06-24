/**
 * sourceTestQueue.js — Client-side throttler for source-test fetches.
 *
 * Sits between `useAutoFetchSources` and the platform-injected
 * `sourceTestHandler` so a widget with many sources cannot:
 *   - Trip the server-side `RATE_LIMIT_SOURCE_TEST` (30 / 60 s per session).
 *   - Drive more than `MAX_IN_FLIGHT` parallel HTTP fetches at once.
 *   - Re-test the same source faster than `PER_SOURCE_DEBOUNCE_MS`.
 *
 * Module-scoped state is intentional: the queue is conceptually a single
 * per-tab dispatcher — moving it onto a React ref would create one queue
 * per CanvasArea mount and defeat the start-rate cap.
 */

import { useUiStore } from '../store/uiStore.js';

const MAX_IN_FLIGHT = 3;
/**
 * Stay below the server's `RATE_LIMIT_SOURCE_TEST = 30 / 60 s` budget by a
 * margin so transient retries never push us over.
 */
const GLOBAL_START_RATE = 25;
const RATE_WINDOW_MS = 60_000;
const PER_SOURCE_DEBOUNCE_MS = 5_000;

// ── State ──────────────────────────────────────────────────────

const queue = [];                       // [{ sourceId, run, abortController }]
const pendingBySourceId = new Map();    // sourceId → queue entry
const lastStartedAt = new Map();        // sourceId → ms timestamp
const recentStartTimes = [];            // rolling list of global start ts
let inFlight = 0;
let tickHandle = null;

// ── Hooks for tests ────────────────────────────────────────────

/** Reset all queue state. Tests only — production never calls this. */
export function _resetQueueForTests() {
  if (tickHandle != null) clearTimeout(tickHandle);
  tickHandle = null;
  queue.length = 0;
  pendingBySourceId.clear();
  lastStartedAt.clear();
  recentStartTimes.length = 0;
  inFlight = 0;
  publishPendingCount();
}

// ── Internals ──────────────────────────────────────────────────

function publishPendingCount() {
  // Optional uiStore field — guarded so a missing setter (e.g. during
  // store teardown in a test) cannot throw inside the dispatcher.
  const setter = useUiStore.getState().setPendingSourceTests;
  if (typeof setter === 'function') setter(queue.length + inFlight);
}

function pruneRecentStarts(now) {
  while (recentStartTimes.length && now - recentStartTimes[0] > RATE_WINDOW_MS) {
    recentStartTimes.shift();
  }
}

function nextEligibleTime(sourceId, now) {
  const last = lastStartedAt.get(sourceId);
  if (last !== undefined && now - last < PER_SOURCE_DEBOUNCE_MS) {
    return last + PER_SOURCE_DEBOUNCE_MS;
  }
  return now;
}

function scheduleTick(delayMs) {
  const wait = Math.max(0, delayMs | 0);
  if (tickHandle != null) return;
  tickHandle = setTimeout(() => {
    tickHandle = null;
    tick();
  }, wait);
}

function tick() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const now = Date.now();
    pruneRecentStarts(now);

    if (recentStartTimes.length >= GLOBAL_START_RATE) {
      const wait = recentStartTimes[0] + RATE_WINDOW_MS - now;
      scheduleTick(wait);
      return;
    }

    let idx = -1;
    let minWait = Number.POSITIVE_INFINITY;
    for (let i = 0; i < queue.length; i++) {
      const eligibleAt = nextEligibleTime(queue[i].sourceId, now);
      if (eligibleAt <= now) {
        idx = i;
        break;
      }
      const w = eligibleAt - now;
      if (w < minWait) minWait = w;
    }
    if (idx === -1) {
      scheduleTick(minWait);
      return;
    }

    const entry = queue.splice(idx, 1)[0];
    pendingBySourceId.delete(entry.sourceId);
    inFlight += 1;
    recentStartTimes.push(now);
    lastStartedAt.set(entry.sourceId, now);
    publishPendingCount();

    Promise.resolve()
      .then(() => entry.run(entry.abortController.signal))
      .catch(() => { /* failures are non-fatal — caller already swallowed */ })
      .finally(() => {
        inFlight -= 1;
        publishPendingCount();
        scheduleTick(0);
      });
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Queue a source-test run. If a previous pending entry for the same
 * `sourceId` exists, it is aborted and replaced — this is what allows
 * rapid config edits to coalesce into a single test.
 *
 * `run(signal)` is invoked when the dispatcher releases this slot. The
 * signal aborts when the source's config changes again before its turn
 * (prior in-flight calls are NOT aborted by this signal — they have
 * already started).
 *
 * Returns the `AbortController` so callers (tests) can observe abort.
 */
export function enqueueSourceTest(sourceId, run) {
  const prior = pendingBySourceId.get(sourceId);
  if (prior) {
    prior.abortController.abort();
    const i = queue.indexOf(prior);
    if (i >= 0) queue.splice(i, 1);
  }
  const abortController = new AbortController();
  const entry = { sourceId, run, abortController };
  queue.push(entry);
  pendingBySourceId.set(sourceId, entry);
  publishPendingCount();
  scheduleTick(0);
  return abortController;
}

/**
 * Drop a pending entry for `sourceId` without running it. No-op if the
 * source has no pending entry (already running, or never queued).
 */
export function cancelPendingSourceTest(sourceId) {
  const prior = pendingBySourceId.get(sourceId);
  if (!prior) return;
  prior.abortController.abort();
  const i = queue.indexOf(prior);
  if (i >= 0) queue.splice(i, 1);
  pendingBySourceId.delete(sourceId);
  publishPendingCount();
}
