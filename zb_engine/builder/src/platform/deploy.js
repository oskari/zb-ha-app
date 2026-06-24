/**
 * deploy.js — Slot-aware deploy orchestration for the active widget.
 *
 * The Deploy button in TopBar pushes the editor's current state to the
 * server's live render slots. A widget always has at least a `"primary"`
 * slot; it MAY also have a `"fullscreen"` companion. Each slot has its
 * own server-side payload file and its own image cache (`image.bin` /
 * `image_fullscreen.bin`) served on port 8000.
 *
 * Design — modular slot enumeration:
 *
 *   `collectDeployTargets(activeWidgetId)` returns an array of
 *   `{ slot, payload }` entries by inspecting the doc store. Today it
 *   returns 1–2 entries (primary + optional fullscreen). To add a new
 *   per-device slot in the future:
 *
 *     1. Pick a stable slot name (`"primary" | "fullscreen" | <new>"`).
 *     2. Decide where the doc lives in the store (parallel companion
 *        suffix like `companionId.js`, or a separate sub-doc map).
 *     3. Append a new branch to `collectDeployTargets` that pushes
 *        `{ slot, payload }` when that doc exists for the widget.
 *     4. Add matching server routes (mirror the `image_fullscreen.*`
 *        pattern in `imageApp.ts` and the slot type in `adapters.ts`).
 *
 *   `deployActiveWidget` then automatically iterates whatever the
 *   collector returns — no other call sites need to change.
 */

import { useDocStore, getDocById } from '../store/docStore.js';
import { fullscreenIdFor } from '../store/companionId.js';
import { exportRuntimeJson } from '../models/mapper.js';
import * as api from './apiClient.js';

/**
 * Enumerate every slot that should be deployed for the given widget.
 *
 * @param {string} activeWidgetId  Primary widget id (NOT a companion id).
 * @returns {Array<{ slot: 'primary'|'fullscreen', payload: object }>}
 *          Empty array when no widget is active.
 */
export function collectDeployTargets(activeWidgetId) {
  if (!activeWidgetId) return [];

  const targets = [];
  const docs = useDocStore.getState().docs;

  // Slot 1: primary (always present when a widget is active).
  const primaryDoc = getDocById(activeWidgetId);
  if (primaryDoc) {
    targets.push({ slot: 'primary', payload: exportRuntimeJson(primaryDoc) });
  }

  // Slot 2: fullscreen companion — only when a companion entry exists.
  const companionId = fullscreenIdFor(activeWidgetId);
  if (docs[companionId]) {
    // The companion inherits the primary's sources (merged in at export time)
    // so the user need not re-declare them on the fullscreen view.
    targets.push({
      slot: 'fullscreen',
      payload: exportRuntimeJson(docs[companionId].doc, {
        slot: 'fullscreen',
        primarySources: primaryDoc?.sources,
      }),
    });
  }

  return targets;
}

/**
 * Deploy every slot of the active widget sequentially.
 *
 * Sequential (not parallel) because the server's RenderGuard only allows
 * one render at a time (ENGINEERING_CONSTRAINTS §12); concurrent requests would just
 * 409. Sequential keeps error reporting clean too.
 *
 * @param {string} activeWidgetId
 * @returns {Promise<Array<{ slot: string, ok: boolean, error?: string }>>}
 *          Per-slot result list. Throws only if `activeWidgetId` is
 *          missing or no targets resolved; per-slot failures are returned
 *          in the result so the caller can surface a partial success.
 */
export async function deployActiveWidget(activeWidgetId) {
  const targets = collectDeployTargets(activeWidgetId);
  if (targets.length === 0) {
    throw new Error('Nothing to deploy — no active widget.');
  }

  const results = [];
  for (const { slot, payload } of targets) {
    try {
      await api.deployPayload(payload, { slot });
      results.push({ slot, ok: true });
    } catch (err) {
      results.push({ slot, ok: false, error: err.message });
    }
  }
  return results;
}
