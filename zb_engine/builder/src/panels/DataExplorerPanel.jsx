import { useMemo } from 'react';

import DataTree from '../components/DataTree.jsx';
import { useDocStore, selectFocusedSources } from '../store/docStore.js';
import { useUiStore } from '../store/uiStore.js';

export default function DataExplorerPanel() {
  const sources = useDocStore(selectFocusedSources);
  const selectedSourceId = useUiStore((s) => s.selectedSourceId);
  const sourceResponsesById = useUiStore((s) => s.sourceResponsesById);

  const selectedSource = useMemo(
    () => sources.find((s) => s?.id === selectedSourceId) || null,
    [sources, selectedSourceId],
  );

  const responseEntry = selectedSourceId ? sourceResponsesById?.[selectedSourceId] : null;
  const responseData = responseEntry?.data ?? null;

  return (
    <div className="panel-body" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Data Explorer</h3>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          {selectedSource ? selectedSource.name : 'No source selected'}
        </div>
      </div>

      {!selectedSource && (
        <div style={{ marginTop: '12px', opacity: 0.7 }}>
          Select a source in the Sources tab, then click “Test Source”.
        </div>
      )}

      {selectedSource && !responseEntry && (
        <div style={{ marginTop: '12px', opacity: 0.7 }}>
          No test response captured yet. Click “Test Source” for this source.
        </div>
      )}

      {selectedSource && responseEntry && (
        <div style={{ marginTop: '12px' }}>
          <DataTree data={responseData} />
        </div>
      )}
    </div>
  );
}
