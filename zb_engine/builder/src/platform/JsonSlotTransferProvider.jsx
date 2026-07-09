/**
 * JsonSlotTransferProvider.jsx — Platform-side wiring for JSON tab file I/O
 *
 * Registers download/upload handlers into uiStore so LeftPanel (core) can offer
 * slot-level JSON file transfer without importing platform modules or calling
 * browser file APIs directly. Mirrors AssetPickerProvider (Engineering §11).
 */

import { useEffect, useRef } from 'react';
import { exportRuntimeJson } from '../models/mapper.js';
import { useUiStore } from '../store/uiStore.js';
import {
  downloadJsonFile,
  parseWidgetImportFile,
  readFileAsText,
  sanitizeFilename,
} from '../utils/widgetTransfer.js';

export default function JsonSlotTransferProvider() {
  const fileInputRef = useRef(null);
  const pendingUploadRef = useRef(null);

  useEffect(() => {
    useUiStore.getState().setDownloadJsonSlotHandler(
      ({ doc, slot, primarySources, widgetName }) => {
        const exported = exportRuntimeJson(doc, {
          slot,
          primarySources: slot === 'fullscreen' ? primarySources : undefined,
        });
        const suffix = slot === 'fullscreen' ? 'fullscreen' : 'primary';
        const baseName = sanitizeFilename(widgetName || 'widget');
        downloadJsonFile(`zerrybit-widget-${baseName}-${suffix}.json`, exported);
      },
    );

    useUiStore.getState().setOpenJsonSlotUpload((context, onLoaded) => {
      pendingUploadRef.current = { context, onLoaded };
      fileInputRef.current?.click();
    });

    return () => {
      useUiStore.getState().setDownloadJsonSlotHandler(null);
      useUiStore.getState().setOpenJsonSlotUpload(null);
    };
  }, []);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const pending = pendingUploadRef.current;
    pendingUploadRef.current = null;
    if (!file || !pending) return;

    try {
      const text = await readFileAsText(file);
      const parsed = parseWidgetImportFile(text);
      const { slot } = pending.context;
      const payload = slot === 'fullscreen' && parsed.fullscreen
        ? parsed.fullscreen
        : parsed.doc;
      pending.onLoaded({ payload });
    } catch (err) {
      pending.onLoaded({ error: err.message || 'Upload failed' });
    }
  };

  return (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,application/json"
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  );
}
