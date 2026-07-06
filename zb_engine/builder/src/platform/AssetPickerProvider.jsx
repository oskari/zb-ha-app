/**
 * AssetPickerProvider.jsx — Platform-side wiring for AssetPickerModal
 *
 * Lives in `platform/` because it owns server I/O (uploadAsset / listAssets /
 * deleteAsset). Mounts once in `App.jsx`. On mount it registers an
 * `openAssetPicker(onSelect)` callback into `uiStore`; core components
 * (Inspector panels) call that callback to open the picker without ever
 * importing platform modules directly (Engineering constraint §11).
 *
 * The provider keeps its UI state local: open/closed, the asset list, the
 * pending `onSelect` callback, and the in-flight upload / error flags. The
 * modal itself is purely presentational.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore.js';
import AssetPickerModal from '../components/AssetPickerModal.jsx';
import {
  uploadAsset,
  listAssets,
  deleteAsset,
  assetRawUrl,
} from './apiClient.js';

export default function AssetPickerProvider() {
  const setOpenAssetPicker = useUiStore((s) => s.setOpenAssetPicker);
  const setAssetUrlResolver = useUiStore((s) => s.setAssetUrlResolver);

  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Latest `onSelect` callback supplied by the caller of openAssetPicker.
  // Stored in a ref (not state) so the effect that registers the opener
  // doesn't capture a stale handler — each call replaces the ref before
  // the modal re-renders, and the modal reads it on `Select` click.
  const onSelectRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listAssets();
      setAssets(Array.isArray(next) ? next : []);
    } catch (e) {
      setError(e.message || 'Failed to load assets.');
    }
  }, []);

  // Register the opener once. Cleanup clears it so re-mounting (HMR /
  // route swap) cannot leave a dangling reference to a stale closure.
  useEffect(() => {
    setOpenAssetPicker((onSelect) => {
      onSelectRef.current = typeof onSelect === 'function' ? onSelect : null;
      setError(null);
      setOpen(true);
      // Refresh on every open so the list reflects uploads from other
      // tabs / sessions without forcing a full app reload.
      refresh();
    });
    return () => setOpenAssetPicker(null);
  }, [setOpenAssetPicker, refresh]);

  // Register the asset raw-URL resolver so the canvas preview can display
  // custom uploaded assets, whose payload `src` is an `asset:<filename>` token
  // the browser cannot load directly. `assetRawUrl` maps a filename to the
  // authenticated `/api/assets/<filename>/raw` endpoint. Cleared on unmount.
  useEffect(() => {
    setAssetUrlResolver(assetRawUrl);
    return () => setAssetUrlResolver(null);
  }, [setAssetUrlResolver]);

  const handleUpload = useCallback(
    async (file) => {
      setUploading(true);
      setError(null);
      try {
        await uploadAsset(file);
        await refresh();
      } catch (e) {
        setError(e.message || 'Upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (filename) => {
      try {
        await deleteAsset(filename);
        await refresh();
      } catch (e) {
        setError(e.message || 'Delete failed.');
      }
    },
    [refresh],
  );

  const handleSelect = useCallback((token) => {
    const cb = onSelectRef.current;
    onSelectRef.current = null;
    setOpen(false);
    if (cb) cb(token);
  }, []);

  const handleClose = useCallback(() => {
    onSelectRef.current = null;
    setOpen(false);
  }, []);

  return (
    <AssetPickerModal
      isOpen={open}
      onClose={handleClose}
      onSelect={handleSelect}
      assets={assets}
      onUpload={handleUpload}
      onDelete={handleDelete}
      uploading={uploading}
      error={error}
      rawUrl={assetRawUrl}
    />
  );
}
