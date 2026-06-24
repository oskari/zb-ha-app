/**
 * IconPickerModal.jsx — Multi-provider icon picker dialog
 *
 * Displays a tabbed grid of icons from all registered providers (MDI, Tabler, etc.)
 * with a search bar. Users switch between icon sets via tabs, search by name,
 * and click an icon to select it.
 *
 * Uses virtual windowing for performance with thousands of icons.
 *
 * This is a core (platform-agnostic) component — no server calls or HA dependencies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getProviders,
  loadAllCatalogs,
  isAllReady,
  formatIconRef,
} from '../utils/iconRegistry.js';

// ── Constants ──────────────────────────────────────────────────

/** Number of icons per row in the grid */
const COLS = 8;

/** Size of each icon cell in pixels */
const CELL_SIZE = 48;

/** Gap between cells */
const GAP = 4;

/** Height of each row (cell + gap) */
const ROW_HEIGHT = CELL_SIZE + GAP;

/** Number of extra rows to render above/below the viewport */
const OVERSCAN = 4;

/** Maximum search results to retrieve from a catalog */
const MAX_RESULTS = 7500;

// ── Icon Cells ─────────────────────────────────────────────────

/** Cell for 'path' renderMode (MDI — single filled path). */
function PathIconCell({ name, data, providerId, onSelect }) {
  return (
    <button
      className="icon-picker-cell"
      title={`${providerId}:${name}`}
      onClick={() => onSelect(providerId, name)}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={28} height={28}>
        <path d={data} fill="currentColor" />
      </svg>
    </button>
  );
}

/** Cell for 'raw' renderMode (Tabler — inner SVG content with strokes). */
function RawIconCell({ name, data, providerId, isFilled, onSelect }) {
  return (
    <button
      className="icon-picker-cell"
      title={`${providerId}:${name}`}
      onClick={() => onSelect(providerId, name)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={28}
        height={28}
        fill={isFilled ? 'currentColor' : 'none'}
        stroke={isFilled ? 'none' : 'currentColor'}
        strokeWidth={isFilled ? undefined : 2}
        strokeLinecap={isFilled ? undefined : 'round'}
        strokeLinejoin={isFilled ? undefined : 'round'}
        dangerouslySetInnerHTML={{ __html: data }}
      />
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────

export default function IconPickerModal({ isOpen, onClose, onSelect }) {
  const providers = getProviders();
  const [activeTab, setActiveTab] = useState(providers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(isAllReady());
  const [scrollTop, setScrollTop] = useState(0);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);

  const activeProvider = providers.find((p) => p.id === activeTab) ?? providers[0];

  // Load all icon catalogs on mount
  useEffect(() => {
    if (!ready) {
      loadAllCatalogs().then(() => setReady(true));
    }
  }, [ready]);

  // Focus the search input when modal opens
  useEffect(() => {
    if (isOpen && ready && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, ready]);

  // Reset scroll and query on open
  useEffect(() => {
    if (isOpen) {
      setScrollTop(0);
      setQuery('');
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [isOpen]);

  // Reset scroll when switching tabs
  const handleTabChange = useCallback((id) => {
    setActiveTab(id);
    setScrollTop(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, []);

  // Search results (memoized on query + active tab)
  const results = useMemo(() => {
    if (!ready || !activeProvider) return [];
    return activeProvider.search(query, MAX_RESULTS);
  }, [query, ready, activeProvider]);

  // Virtual scrolling calculations
  const totalRows = Math.ceil(results.length / COLS);
  const totalHeight = totalRows * ROW_HEIGHT;

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  const handleSelect = useCallback(
    (providerId, name) => {
      const ref = formatIconRef(providerId, name);
      onSelect(ref);
      onClose();
    },
    [onSelect, onClose],
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Compute visible row range with overscan
  const containerHeight = 400;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

  // Build visible rows
  const renderMode = activeProvider?.renderMode ?? 'path';
  const visibleRows = [];

  for (let row = startRow; row < endRow; row++) {
    const startIdx = row * COLS;
    const rowIcons = results.slice(startIdx, startIdx + COLS);
    visibleRows.push(
      <div
        key={row}
        className="icon-picker-row"
        style={{
          position: 'absolute',
          top: row * ROW_HEIGHT,
          left: 0,
          right: 0,
          display: 'flex',
          gap: `${GAP}px`,
          height: `${CELL_SIZE}px`,
        }}
      >
        {rowIcons.map((icon) =>
          renderMode === 'path' ? (
            <PathIconCell
              key={icon.name}
              name={icon.name}
              data={icon.data}
              providerId={activeTab}
              onSelect={handleSelect}
            />
          ) : (
            <RawIconCell
              key={icon.name}
              name={icon.name}
              data={icon.data}
              providerId={activeTab}
              isFilled={icon.name.endsWith('-filled')}
              onSelect={handleSelect}
            />
          ),
        )}
      </div>,
    );
  }

  const totalCount = activeProvider?.getCount() ?? 0;

  return (
    <div className="icon-picker-backdrop" onClick={onClose}>
      <div className="icon-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Select Icon</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Provider tabs */}
        {providers.length > 1 && (
          <div className="icon-picker-tabs">
            {providers.map((p) => (
              <button
                key={p.id}
                className={`icon-picker-tab ${activeTab === p.id ? 'active' : ''}`}
                onClick={() => handleTabChange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="icon-picker-search">
          <input
            ref={inputRef}
            type="text"
            className="input"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="icon-picker-count">
            {ready ? `${results.length} of ${totalCount} icons` : 'Loading…'}
          </span>
        </div>

        <div
          ref={scrollContainerRef}
          className="icon-picker-grid"
          style={{ height: containerHeight, overflowY: 'auto', position: 'relative' }}
          onScroll={handleScroll}
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleRows}
          </div>
        </div>
      </div>
    </div>
  );
}
