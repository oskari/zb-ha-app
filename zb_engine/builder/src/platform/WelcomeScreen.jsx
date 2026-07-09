/**
 * WelcomeScreen.jsx — Landing screen shown on app startup
 *
 * Presents the user with two choices:
 *   1. Continue editing an existing saved widget
 *   2. Create a new widget (proceeds to the grid size selector)
 *
 * This component lives in platform/ because it reads from widgetStore
 * which communicates with the server.
 */

import { useEffect, useState } from 'react';
import { useWidgetStore } from './widgetStore.js';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { useWidgetImport } from './useWidgetImport.js';

export default function WelcomeScreen({ onNewWidget, onOpenWidget }) {
  const widgets = useWidgetStore((s) => s.widgets);
  const loading = useWidgetStore((s) => s.loading);
  const error = useWidgetStore((s) => s.error);
  const fetchWidgets = useWidgetStore((s) => s.fetchWidgets);

  const {
    fileInputRef,
    triggerImport,
    handleFileChange,
    pendingImport,
    confirmPendingImport,
    cancelPendingImport,
    missingAssetsMessage,
    loading: importLoading,
  } = useWidgetImport();

  const [hasFetched, setHasFetched] = useState(false);
  const [widgetName, setWidgetName] = useState('');

  useEffect(() => {
    if (!hasFetched) {
      setHasFetched(true);
      fetchWidgets();
    }
  }, [hasFetched, fetchWidgets]);

  // Check for duplicate names among existing widgets
  const trimmedName = widgetName.trim();
  const isDuplicate = trimmedName.length > 0 &&
    widgets.some((w) => w.name === trimmedName);

  const handleCreate = () => {
    if (isDuplicate) return;
    onNewWidget(trimmedName || '');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCreate();
  };

  return (
    <div className="welcome-overlay">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div className="welcome-card">
        <h1 className="welcome-title">
          ZerryBit Widget Builder<span className="welcome-beta-badge">Beta</span>
        </h1>
        <p className="welcome-subtitle">Create or continue editing an e-ink widget.</p>

        {/* Name input + New Widget button */}
        <div className="welcome-new-group">
          <input
            className={`welcome-name-input${isDuplicate ? ' welcome-name-input--error' : ''}`}
            type="text"
            value={widgetName}
            onChange={(e) => setWidgetName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Widget name (optional)"
            maxLength={100}
          />
          {isDuplicate && (
            <p className="welcome-name-error">A widget with this name already exists</p>
          )}
          <button
            type="button"
            className="btn btn-primary welcome-new-btn"
            onClick={handleCreate}
            disabled={isDuplicate}
          >
            + New Widget
          </button>
          <button
            type="button"
            className="btn welcome-import-btn"
            onClick={triggerImport}
            disabled={loading || importLoading}
          >
            Import widget
          </button>
        </div>

        {/* Existing widgets */}
        {loading && <p className="welcome-loading">Loading widgets…</p>}

        {error && <p className="welcome-error">{error}</p>}

        {!loading && widgets.length > 0 && (
          <>
            <div className="welcome-divider">
              <span>or continue editing</span>
            </div>

            <div className="welcome-widget-list">
              {widgets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="welcome-widget-item"
                  onClick={() => onOpenWidget(w.id)}
                >
                  <span className="welcome-widget-name">{w.name || w.id}</span>
                  {w.updatedAt && (
                    <span className="welcome-widget-date">
                      {new Date(w.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {!loading && widgets.length === 0 && hasFetched && (
          <p className="welcome-empty">No saved widgets yet. Create your first one!</p>
        )}
      </div>

      {pendingImport && (
        <ConfirmModal
          message={missingAssetsMessage}
          onConfirm={confirmPendingImport}
          onCancel={cancelPendingImport}
        />
      )}
    </div>
  );
}
