/**
 * useWidgetImport.js — Shared file-picker + missing-asset confirm flow.
 */

import { useCallback, useRef, useState } from 'react';
import { useWidgetStore } from './widgetStore.js';

export function useWidgetImport() {
  const loading = useWidgetStore((s) => s.loading);
  const inspectWidgetImportFile = useWidgetStore((s) => s.inspectWidgetImportFile);
  const importParsedWidget = useWidgetStore((s) => s.importParsedWidget);

  const fileInputRef = useRef(null);
  const [pendingImport, setPendingImport] = useState(null);

  const triggerImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const result = await inspectWidgetImportFile(file);
    if (result.status === 'missing_assets') {
      setPendingImport(result);
      return;
    }
    if (result.status === 'error') {
      return;
    }

    await importParsedWidget(result.parsed);
  }, [inspectWidgetImportFile, importParsedWidget]);

  const confirmPendingImport = useCallback(async () => {
    if (!pendingImport?.parsed) return;
    await importParsedWidget(pendingImport.parsed);
    setPendingImport(null);
  }, [pendingImport, importParsedWidget]);

  const cancelPendingImport = useCallback(() => {
    setPendingImport(null);
  }, []);

  const missingAssetsMessage = pendingImport?.missingAssets?.length
    ? `This widget references ${pendingImport.missingAssets.length} uploaded asset(s) that are not on this system:\n\n${pendingImport.missingAssets.join('\n')}\n\nImport anyway? Images will be missing until you re-upload them.`
    : '';

  return {
    fileInputRef,
    triggerImport,
    handleFileChange,
    pendingImport,
    confirmPendingImport,
    cancelPendingImport,
    missingAssetsMessage,
    loading,
  };
}
