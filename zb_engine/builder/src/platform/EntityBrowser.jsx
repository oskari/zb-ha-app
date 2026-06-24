/**
 * EntityBrowser.jsx — HA entity picker for source creation (platform-specific)
 *
 * Renders a searchable, domain-filterable entity list that lets users
 * pick an HA entity when creating haState or haHistory sources.
 *
 * ENGINEERING_CONSTRAINTS: This component lives in platform/ — core panels receive it
 * via the entityCatalogStore injection in uiStore. The core never imports
 * this file directly.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

// ── Mini Sparkline (canvas-based, editor-only, never exported) ─

/**
 * Tiny sparkline preview drawn on a <canvas>. Purely visual aid in the
 * entity picker — helps the user confirm they picked the right sensor.
 */
function MiniSparkline({ points, width = 220, height = 40 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points || points.length < 2) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Extract numeric values, skip nulls
    const numeric = points
      .map((p, i) => ({ i, v: p.v }))
      .filter((p) => p.v !== null && p.v !== undefined);

    if (numeric.length < 2) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    const values = numeric.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'var(--c-accent, #3b82f6)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const padding = 2;
    const drawW = width - padding * 2;
    const drawH = height - padding * 2;

    for (let i = 0; i < numeric.length; i++) {
      const x = padding + (i / (numeric.length - 1)) * drawW;
      const y = padding + drawH - ((numeric[i].v - min) / range) * drawH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }, [points, width, height]);

  if (!points || points.length < 2) {
    return (
      <div style={{ fontSize: 'var(--text-xs)', opacity: 0.5, padding: '8px 0' }}>
        Not enough data points for preview.
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: 'var(--radius)',
        background: 'var(--c-bg)',
        display: 'block',
      }}
    />
  );
}

// ── Entity List Item ───────────────────────────────────────────

function EntityRow({ entity, isSelected, onClick }) {
  const name = entity.attributes?.friendly_name || entity.entity_id;
  const unit = entity.attributes?.unit_of_measurement || '';
  const stateStr = entity.state ?? '';

  return (
    <div
      onClick={onClick}
      className={`entity-row${isSelected ? ' entity-row--selected' : ''}`}
    >
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{name}</div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          opacity: isSelected ? 0.85 : 0.6,
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)' }}>{entity.entity_id}</span>
        <span>
          {stateStr}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
    </div>
  );
}

// ── Main EntityBrowser Component ───────────────────────────────

/**
 * Entity picker/browser for HA source creation.
 *
 * @param {object}   props
 * @param {object}   props.entityStore     The useEntityStore Zustand store hook
 * @param {string}   props.selectedEntityId  Currently selected entity_id (controlled)
 * @param {function} props.onSelect        Callback when user picks an entity: (entity_id) => void
 * @param {string}   [props.kind]          "haState" or "haHistory" — affects what preview is shown
 * @param {number}   [props.hoursBack]     For haHistory: the lookback window (used for sparkline)
 */
export default function EntityBrowser({
  entityStore,
  selectedEntityId,
  onSelect,
  kind = 'haState',
  hoursBack = 24,
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [localDomain, setLocalDomain] = useState(null);
  const listRef = useRef(null);

  // Read entity catalog state from the injected store
  const entitiesLoading = entityStore((s) => s.entitiesLoading);
  const entitiesLoaded = entityStore((s) => s.entitiesLoaded);
  const entitiesError = entityStore((s) => s.entitiesError);
  const entities = entityStore((s) => s.entities);
  const domains = entityStore((s) => s.domains);
  const historyCache = entityStore((s) => s.historyCache);
  const historyLoading = entityStore((s) => s.historyLoading);

  // Filtered entity list (local filtering for responsiveness)
  const filteredEntities = useMemo(() => {
    let list = entities;

    if (localDomain) {
      list = list.filter((e) => {
        const dot = e.entity_id.indexOf('.');
        return dot > 0 && e.entity_id.slice(0, dot) === localDomain;
      });
    }

    if (localSearch) {
      const q = localSearch.toLowerCase();
      list = list.filter((e) => {
        const id = (e.entity_id || '').toLowerCase();
        const name = (e.attributes?.friendly_name || '').toLowerCase();
        const state = String(e.state || '').toLowerCase();
        return id.includes(q) || name.includes(q) || state.includes(q);
      });
    }

    return list;
  }, [entities, localSearch, localDomain]);

  // Domain list for the filter dropdown
  const domainList = useMemo(() => Object.keys(domains).sort(), [domains]);

  // Auto-load history when an entity is selected for haHistory kind
  useEffect(() => {
    if (kind === 'haHistory' && selectedEntityId) {
      entityStore.getState().loadEntityHistory(selectedEntityId, hoursBack);
    }
  }, [kind, selectedEntityId, hoursBack, entityStore]);

  const handleRetry = useCallback(() => {
    entityStore.getState().loadEntities();
  }, [entityStore]);

  // ── Loading state ──
  if (entitiesLoading && !entitiesLoaded) {
    return (
      <div style={{ padding: '12px 0', opacity: 0.6, fontSize: 'var(--text-sm)' }}>
        Loading HA entities…
      </div>
    );
  }

  // ── Error state ──
  if (entitiesError && !entitiesLoaded) {
    return (
      <div style={{ padding: '12px 0' }}>
        <div style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)', marginBottom: '8px' }}>
          {entitiesError}
        </div>
        <button className="btn" onClick={handleRetry}>
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ──
  if (entitiesLoaded && entities.length === 0) {
    return (
      <div style={{ padding: '12px 0', opacity: 0.6, fontSize: 'var(--text-sm)' }}>
        No entities found. Make sure you have integrations configured in Home Assistant.
      </div>
    );
  }

  // ── History preview for the selected entity ──
  const historyCacheKey = selectedEntityId ? `${selectedEntityId}:${hoursBack}` : null;
  const historyEntry = historyCacheKey ? historyCache[historyCacheKey] : null;
  const isHistoryLoading = historyCacheKey ? historyLoading[historyCacheKey] : false;

  return (
    <div>
      {/* Search + domain filter row */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <input
          type="text"
          className="input"
          placeholder="Search entities…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          className="input"
          value={localDomain || ''}
          onChange={(e) => setLocalDomain(e.target.value || null)}
          style={{ width: '110px', flexShrink: 0 }}
        >
          <option value="">All domains</option>
          {domainList.map((d) => (
            <option key={d} value={d}>
              {d} ({domains[d]?.length || 0})
            </option>
          ))}
        </select>
      </div>

      {/* Scrollable entity list */}
      <div
        ref={listRef}
        style={{
          maxHeight: '200px',
          overflowY: 'auto',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--radius)',
          marginBottom: '8px',
        }}
      >
        {filteredEntities.length === 0 && (
          <div
            style={{
              padding: '12px',
              opacity: 0.5,
              fontStyle: 'italic',
              fontSize: 'var(--text-sm)',
            }}
          >
            No matching entities.
          </div>
        )}
        {filteredEntities.map((entity) => (
          <EntityRow
            key={entity.entity_id}
            entity={entity}
            isSelected={entity.entity_id === selectedEntityId}
            onClick={() => onSelect(entity.entity_id)}
          />
        ))}
      </div>

      {/* Entity count & loading indicator */}
      <div style={{ fontSize: 'var(--text-xs)', opacity: 0.5, marginBottom: '8px' }}>
        {filteredEntities.length} of {entities.length} entities
        {entitiesLoading ? ' · Refreshing…' : ''}
      </div>

      {/* History preview (haHistory kind only) */}
      {kind === 'haHistory' && selectedEntityId && (
        <div
          style={{
            marginTop: '8px',
            padding: '8px',
            background: 'var(--c-bg)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--c-border)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              marginBottom: '4px',
              opacity: 0.7,
            }}
          >
            History Preview
          </div>

          {isHistoryLoading && (
            <div style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>Loading history…</div>
          )}

          {historyEntry?.error && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-danger)' }}>
              {historyEntry.error}
            </div>
          )}

          {historyEntry?.data && (
            <>
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  opacity: 0.7,
                  marginBottom: '4px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {historyEntry.data.count} points · min: {historyEntry.data.min ?? '–'} · max:{' '}
                {historyEntry.data.max ?? '–'} · avg: {historyEntry.data.avg ?? '–'}
              </div>
              <MiniSparkline points={historyEntry.data.points} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
