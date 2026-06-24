import { useState } from 'react';
import {
  useDocStore,
  selectFocusedMisc,
  selectFocusedHistory,
  PENDING_DOC_ID,
} from '../store/docStore.js';
import { useUiStore } from '../store/uiStore.js';
import { fullscreenIdFor, isFullscreenId, primaryIdOf } from '../store/companionId.js';
import IconPickerModal from '../components/IconPickerModal.jsx';
import { toSvgString, parseIconRef } from '../utils/iconRegistry.js';
import TablerIcon from '../components/TablerIcon.jsx';
import CanvasDataStatus from './CanvasDataStatus.jsx';

const TOOLS = [
  { type: 'rect',   icon: 'square-dashed', title: 'Rectangle' },
  { type: 'circle', icon: 'circle',        title: 'Circle' },
  { type: 'line',   icon: 'line',          title: 'Line' },
  { type: 'text',   icon: 'abc',           title: 'Text' },
  { type: 'icon',   icon: 'apps',          title: 'Icon' },
  { type: 'img',    icon: 'polaroid',      title: 'Image' },
  { type: 'svg',    icon: 'svg',           title: 'SVG' },
  { type: 'graph',  icon: 'chart-sankey',  title: 'Graph' },
];

const GRID_STEPS = [1, 2, 5, 10, 20, 50];

export default function CanvasToolbox({ viewportWidth, viewportHeight, artboardWidth, artboardHeight, sources }) {
  const addElement = useDocStore((s) => s.addElement);
  const size = useDocStore((s) => selectFocusedMisc(s).size);
  const undo = useDocStore((s) => s.undo);
  const redo = useDocStore((s) => s.redo);
  const hasPast = useDocStore((s) => selectFocusedHistory(s).past.length > 0);
  const hasFuture = useDocStore((s) => selectFocusedHistory(s).future.length > 0);
  const snapping = useUiStore((s) => s.snapping);
  const updateSnapping = useUiStore((s) => s.updateSnapping);
  const zoom = useUiStore((s) => s.viewport.zoom);
  const setZoom = useUiStore((s) => s.setZoom);
  const showGrid = useUiStore((s) => s.showGrid);
  const setShowGrid = useUiStore((s) => s.setShowGrid);
  const toolMode = useUiStore((s) => s.toolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const recenter = useUiStore((s) => s.recenter);
  const togglePreviewOverlay = useUiStore((s) => s.togglePreviewOverlay);
  const previewOverlayEnabled = useUiStore((s) => s.previewOverlay.enabled);

  // ── Slot tab state ─────────────────────────────────
  // Derive primary/companion ids from the focused doc so the user can
  // switch between the primary widget and its fullscreen companion on
  // the same canvas (single viewport, single stage).
  const focusedDocId = useDocStore((s) => s.focusedDocId);
  const primaryId =
    focusedDocId && focusedDocId !== PENDING_DOC_ID ? primaryIdOf(focusedDocId) : null;
  const companionId = primaryId ? fullscreenIdFor(primaryId) : null;
  const hasCompanionDoc = useDocStore((s) =>
    companionId ? Boolean(s.docs[companionId]) : false,
  );
  const isCompanionFocused = focusedDocId != null && isFullscreenId(focusedDocId);
  const switchFocus = useDocStore((s) => s.switchFocus);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const ensureFullscreenCompanionHandler = useUiStore(
    (s) => s.ensureFullscreenCompanionHandler,
  );
  const deleteFullscreenCompanionHandler = useUiStore(
    (s) => s.deleteFullscreenCompanionHandler,
  );
  const slotTabsAvailable = primaryId != null;

  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const handleAdd = (type) => {
    const w = size?.width ?? 240;
    const h = size?.height ?? 240;
    // Center the new element (approximate centering)
    addElement(type, { pos: { x: w / 2 - 50, y: h / 2 - 50 } });
  };

  const handleIconSelect = (ref) => {
    const parsed = parseIconRef(ref);
    if (!parsed) return;
    const svgStr = toSvgString(parsed.providerId, parsed.iconName);
    if (!svgStr) return;
    const w = size?.width ?? 240;
    const h = size?.height ?? 240;
    addElement('svg', {
      pos: { x: w / 2 - 24, y: h / 2 - 24 },
      sizeX: 48,
      sizeY: 48,
      svg: svgStr,
      src: '',
      name: `Icon: ${ref}`,
      bwMode: 'threshold',
      bwLevel: 50,
    });
  };

  const handleToolClick = (type) => {
    if (type === 'icon') {
      setIconPickerOpen(true);
      return;
    }
    if (type === 'line') {
      setToolMode(toolMode === 'line' ? 'select' : 'line');
    } else {
      handleAdd(type);
      setToolMode('select');
    }
  };

  const handleDragStart = (e, type) => {
    e.dataTransfer.setData('application/widget-type', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // ── Slot tab handlers ───────────────────────────────────────────

  const handleSelectPrimary = () => {
    if (!primaryId) return;
    clearSelection();
    switchFocus(primaryId);
  };

  const handleSelectFullscreen = () => {
    if (!primaryId) return;
    if (!hasCompanionDoc) {
      ensureFullscreenCompanionHandler?.(primaryId);
    }
    clearSelection();
    switchFocus(fullscreenIdFor(primaryId));
  };

  const handleDeleteFullscreen = (e) => {
    e.stopPropagation();
    if (!primaryId) return;
    // Switch focus back to the primary BEFORE deleting so the inspector
    // is not pointing at a doc we are about to remove. (Per ENGINEERING_CONSTRAINTS
    // rule #2, no browser dialogs — the companion is recreatable via the
    // "+ Fullscreen" tab so a confirmation prompt is unnecessary.)
    if (isCompanionFocused) {
      clearSelection();
      switchFocus(primaryId);
    }
    deleteFullscreenCompanionHandler?.(primaryId);
  };

  return (
    <div className="canvas-toolbox">
      <div className="toolbox-group">
        {TOOLS.map((tool) => (
          <button
            key={tool.type}
            className={`toolbox-btn ${tool.type === 'line' && toolMode === 'line' ? 'active' : ''}`}
            title={tool.title}
            draggable={tool.type !== 'icon'}
            onDragStart={(e) => handleDragStart(e, tool.type)}
            onClick={() => handleToolClick(tool.type)}
          >
            <TablerIcon name={tool.icon} />
          </button>
        ))}
      </div>

      <div className="toolbox-divider" />

      <div className="toolbox-group">
        <button
          className={`toolbox-btn ${snapping.snapEnabled ? 'active' : ''}`}
          title="Toggle Magnet (Grid Snapping)"
          onClick={() => updateSnapping({ snapEnabled: !snapping.snapEnabled })}
        >
          <TablerIcon name="magnet" />
        </button>

        <select
          className="toolbox-select"
          title="Grid Step"
          value={snapping.gridStep}
          onChange={(e) => updateSnapping({ gridStep: Number(e.target.value) })}
        >
          {GRID_STEPS.map((step) => (
            <option key={step} value={step}>
              {step}px
            </option>
          ))}
        </select>

        <button
          className={`toolbox-btn ${snapping.snapToElements ? 'active' : ''}`}
          title="Snap to Elements"
          onClick={() => updateSnapping({ snapToElements: !snapping.snapToElements })}
        >
          <TablerIcon name="target-arrow" />
        </button>

        <button
          className={`toolbox-btn ${showGrid ? 'active' : ''}`}
          title="Show Grid Overlay"
          onClick={() => setShowGrid(!showGrid)}
        >
          #
        </button>
      </div>

      <div className="toolbox-divider" />

      <div className="toolbox-group">
        <button className="toolbox-btn" title="Zoom Out" onClick={() => setZoom(zoom - 0.1)}>
          <TablerIcon name="minus" />
        </button>
        <span
          className="toolbox-label"
          style={{ fontSize: '0.8em', minWidth: '3em', textAlign: 'center', userSelect: 'none' }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button className="toolbox-btn" title="Zoom In" onClick={() => setZoom(zoom + 0.1)}>
          <TablerIcon name="plus" />
        </button>
        <button className="toolbox-btn" title="Reset Zoom" onClick={() => setZoom(1)}>
          1:1
        </button>
        <button
          className="toolbox-btn"
          title="Recenter artboard"
          onClick={() => recenter(viewportWidth, viewportHeight, artboardWidth, artboardHeight)}
        >
          ⊞
        </button>
      </div>

      <div className="toolbox-divider" />

      <div className="toolbox-group">
        <button
          className={`toolbox-btn ${previewOverlayEnabled ? 'active' : ''}`}
          title="Toggle Preview Overlay"
          onClick={togglePreviewOverlay}
        >
          <TablerIcon name="eye" />
        </button>
      </div>

      {/* Data freshness pill + "Refresh data" button. Self-hides when the
          focused widget has no fetchable sources. */}
      <CanvasDataStatus sources={sources} />

      {/* Slot tabs — only shown when a real widget is open. */}
      {slotTabsAvailable && (
        <>
          <div className="toolbox-divider" />
          <div className="toolbox-group toolbox-slot-tabs" role="tablist" aria-label="Render slot">
            <button
              type="button"
              role="tab"
              aria-selected={!isCompanionFocused}
              className={`toolbox-btn ${!isCompanionFocused ? 'active' : ''}`}
              title="Edit primary widget"
              onClick={handleSelectPrimary}
            >
              <TablerIcon name="arrows-minimize" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isCompanionFocused}
              className={`toolbox-btn ${isCompanionFocused ? 'active' : ''}`}
              title={hasCompanionDoc ? 'Edit fullscreen companion' : 'Add a fullscreen companion (3×2)'}
              disabled={!hasCompanionDoc && !ensureFullscreenCompanionHandler}
              onClick={handleSelectFullscreen}
            >
              <TablerIcon name={hasCompanionDoc ? 'arrows-maximize' : 'plus'} />
            </button>
            {hasCompanionDoc && (
              <button
                type="button"
                className="toolbox-btn"
                title="Delete fullscreen companion"
                onClick={handleDeleteFullscreen}
              >
                <TablerIcon name="trash" />
              </button>
            )}
          </div>
        </>
      )}

      <div className="toolbox-divider" />

      {/* Undo / Redo */}
      <div className="toolbox-group">
        <button
          className="toolbox-btn"
          title="Undo (Ctrl+Z)"
          disabled={!hasPast}
          onClick={undo}
        >
          ↩
        </button>
        <button
          className="toolbox-btn"
          title="Redo (Ctrl+Y)"
          disabled={!hasFuture}
          onClick={redo}
        >
          ↪
        </button>
      </div>

      <IconPickerModal
        isOpen={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        onSelect={handleIconSelect}
      />
    </div>
  );
}
