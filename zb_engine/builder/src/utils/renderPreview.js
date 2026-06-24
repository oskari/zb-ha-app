/**
 * renderPreview.js — Trigger a server preview render for the focused slot.
 *
 * Shared by the TopBar ⟳ button and the canvas "Refresh data" action so both
 * render the same slot identically (and publish any per-element warnings to
 * the central store). Core-only: the actual render goes through the injected
 * `previewRenderer`, so this never imports a platform module.
 */

import { useDocStore, getFocusedDoc, getInheritedPrimarySources } from '../store/docStore.js';
import { isFullscreenId } from '../store/companionId.js';
import { useUiStore } from '../store/uiStore.js';
import { exportRuntimeJson } from '../models/mapper.js';

/**
 * Render the currently-focused slot's preview. No-op (returns null) when no
 * renderer is wired (standalone) or there is no focused doc. Publishes the
 * render warnings via `notifyRenderComplete` so PreviewTab can surface them
 * regardless of which control triggered the render. Returns the render result.
 */
export async function renderFocusedPreview() {
  const { previewRenderer } = useUiStore.getState();
  if (!previewRenderer) return null;

  const focusedDocId = useDocStore.getState().focusedDocId;
  const doc = getFocusedDoc();
  if (!doc) return null;

  // Render the slot the user is currently editing. A companion render
  // inherits its primary's sources (undefined for the primary slot, so the
  // merge is a no-op there).
  const slot = isFullscreenId(focusedDocId) ? 'fullscreen' : 'primary';
  const payload = exportRuntimeJson(doc, {
    slot,
    primarySources: getInheritedPrimarySources(focusedDocId),
  });
  const result = await previewRenderer(payload, { slot });
  useUiStore.getState().notifyRenderComplete(result?.renderWarnings);
  return result;
}
