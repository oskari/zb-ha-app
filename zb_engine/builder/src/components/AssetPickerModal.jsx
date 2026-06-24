/**
 * AssetPickerModal.jsx — User-asset browser & uploader (presentational)
 *
 * Pure presentational component. All side effects (fetch / upload / delete)
 * are owned by `platform/AssetPickerProvider.jsx` and passed in as
 * callbacks. This separation keeps the modal usable by any platform that
 * provides an equivalent backend.
 *
 * ENGINEERING_CONSTRAINTS compliance:
 *   §2 NO BROWSER DIALOGS — uses inline `<input type=file>` (the native
 *   file picker is the OS chooser, not a JS dialog) and `ConfirmModal`
 *   for delete confirmation.
 *   §11 SVG XSS — thumbnails render via `<img src=…/raw>` rather than
 *   `dangerouslySetInnerHTML`. Browsers run SVG-as-image with no script
 *   execution, so a sanitiser-bypass at the server can't reach the DOM.
 */

import { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ConfirmModal from './ConfirmModal.jsx';
import TablerIcon from './TablerIcon.jsx';

const ACCEPT = '.svg,.png,.jpg,.jpeg,.webp';

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AssetPickerModal({
  isOpen,
  onClose,
  onSelect,
  assets,
  onUpload,
  onDelete,
  uploading,
  error,
  rawUrl,
}) {
  const inputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  if (!isOpen) return null;

  function triggerFilePicker() {
    inputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires `change`.
    e.target.value = '';
    if (file) onUpload(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onUpload(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function confirmDelete() {
    if (pendingDelete) {
      onDelete(pendingDelete.filename);
      setPendingDelete(null);
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="asset-picker-modal"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--c-surface)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
            padding: 'var(--sp-5)',
            width: 'min(720px, 92vw)',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-4)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Custom assets</h3>
            <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
              <TablerIcon name="x" size={18} />
            </button>
          </div>

          {/* Drop zone / upload trigger */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={triggerFilePicker}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                triggerFilePicker();
              }
            }}
            style={{
              border: '1px dashed var(--c-border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--sp-5)',
              textAlign: 'center',
              cursor: uploading ? 'wait' : 'pointer',
              opacity: uploading ? 0.6 : 1,
              background: 'var(--c-surface-alt, transparent)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--sp-2)' }}>
              <TablerIcon name="upload" size={24} />
            </div>
            <div style={{ fontSize: 'var(--text-sm)' }}>
              {uploading ? 'Uploading…' : 'Drop an image here, or click to browse'}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', marginTop: 'var(--sp-1)' }}>
              PNG · JPG · WebP · SVG · max 2 MB
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={handleFileChange}
              style={{ display: 'none' }}
              disabled={uploading}
            />
          </div>

          {/* Error banner */}
          {error && (
            <div
              role="alert"
              style={{
                padding: 'var(--sp-2) var(--sp-3)',
                background: 'var(--c-danger-bg, #fee)',
                color: 'var(--c-danger)',
                borderRadius: 'var(--radius)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {error}
            </div>
          )}

          {/* Asset grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 'var(--sp-2)',
              overflowY: 'auto',
              flex: 1,
              minHeight: '180px',
            }}
          >
            {assets.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  color: 'var(--c-text-muted)',
                  fontSize: 'var(--text-sm)',
                  padding: 'var(--sp-5)',
                }}
              >
                No assets uploaded yet.
              </div>
            )}
            {assets.map((asset) => (
              <div
                key={asset.filename}
                style={{
                  border: '1px solid var(--c-border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--sp-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--sp-1)',
                  background: 'var(--c-bg)',
                }}
              >
                <button
                  onClick={() => onSelect(`asset:${asset.filename}`)}
                  style={{
                    aspectRatio: '1 / 1',
                    background: '#fff',
                    border: '1px solid var(--c-border)',
                    borderRadius: 'var(--radius)',
                    padding: 0,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title={`Use ${asset.originalName}`}
                >
                  <img
                    src={rawUrl(asset.filename)}
                    alt=""
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                    }}
                  />
                </button>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={asset.originalName}
                >
                  {asset.originalName}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--c-text-muted)',
                  }}
                >
                  <span>{formatSize(asset.size)}</span>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setPendingDelete(asset)}
                    aria-label={`Delete ${asset.originalName}`}
                    style={{ padding: '2px 6px' }}
                  >
                    <TablerIcon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmModal
          message={`Delete "${pendingDelete.originalName}"? Widgets that reference it will show an empty area until updated.`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

AssetPickerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  assets: PropTypes.array.isRequired,
  onUpload: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  uploading: PropTypes.bool,
  error: PropTypes.string,
  rawUrl: PropTypes.func.isRequired,
};
