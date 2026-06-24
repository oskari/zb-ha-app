/**
 * GridSizeSelector.jsx — Initial grid size selection overlay
 *
 * Shown when the editor opens with a new document (before the user has
 * confirmed a grid size). Presents a visual grid of preset sizes with the
 * default (3×2) pre-selected. The user picks a size and clicks "Start Editing"
 * to dismiss the overlay.
 *
 * New widgets always start at the 720×480 "With Side Panel" screen (forced in
 * App.handleNewWidget). The widget size and the fullscreen companion's Display
 * Mode can both be changed later from the Settings tab.
 *
 * This component is platform-agnostic (core).
 */

import { useMemo } from 'react';
import { gridSizeToSize, normalizeGridSize } from '../models/document.js';
import { useDocStore, selectFocusedMisc } from '../store/docStore.js';
import { DISPLAY_PRESETS } from '../store/displayConfigStore.js';

/** Preset grid sizes offered to the user. */
const GRID_OPTIONS = ['1x1', '1x2', '2x1', '2x2', '3x2'];

/** Largest dimension (px) of a preview box; the other dimension scales down to
 *  preserve the widget's real aspect ratio. */
const PREVIEW_MAX_PX = 56;

/**
 * Scale a widget's pixel size into a preview box that fits within
 * PREVIEW_MAX_PX on its longest side while keeping the true aspect ratio, so
 * each grid size is shown to scale (1×1 is a square, 2×1 is wide, 1×2 is tall).
 */
function previewBoxSize({ width, height }) {
  const aspect = width / height;
  if (aspect >= 1) {
    return { w: PREVIEW_MAX_PX, h: Math.round(PREVIEW_MAX_PX / aspect) };
  }
  return { w: Math.round(PREVIEW_MAX_PX * aspect), h: PREVIEW_MAX_PX };
}

/** Small visual preview showing the grid cell arrangement, sized to the
 *  widget's real aspect ratio. */
function GridPreview({ cols, rows, px, selected }) {
  const { w, h } = previewBoxSize(px);
  return (
    <div className="grid-selector-preview-box">
      <div
        className="grid-selector-preview"
        style={{
          width: `${w}px`,
          height: `${h}px`,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: cols * rows }, (_, i) => (
          <div
            key={i}
            className={`grid-selector-preview-cell${selected ? ' selected' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function GridSizeSelector({ onConfirm }) {
  const gridSize = useDocStore((s) => selectFocusedMisc(s).gridSize);
  const updateMisc = useDocStore((s) => s.updateMisc);

  // New widgets always start at the 720×480 "With Side Panel" screen. The size
  // can be changed later from the Settings tab.
  const screenSize = DISPLAY_PRESETS.panel;

  const currentGrid = normalizeGridSize(gridSize);

  const options = useMemo(
    () =>
      GRID_OPTIONS.map((opt) => {
        const match = opt.match(/^(\d+)x(\d+)$/);
        const cols = Number(match[1]);
        const rows = Number(match[2]);
        const px = gridSizeToSize(opt, screenSize);
        return { key: opt, cols, rows, px };
      }),
    [screenSize],
  );

  const handleSelect = (key) => {
    updateMisc({ gridSize: key });
  };

  const handleConfirm = () => {
    if (typeof onConfirm === 'function') onConfirm();
  };

  const handleDoubleClick = (key) => {
    updateMisc({ gridSize: key });
    handleConfirm();
  };

  return (
    <div className="grid-selector-overlay">
      <div className="grid-selector-card">
        <h2 className="grid-selector-title">Select Canvas Size</h2>
        <p className="grid-selector-subtitle">
          Choose a grid layout for your widget.
          <br />
          The widget can be resized later in <em>Settings</em>.
        </p>

        <div className="grid-selector-options">
          {options.map(({ key, cols, rows, px }) => {
            const isSelected = key === currentGrid;
            const isDefault = key === '3x2';
            return (
              <button
                key={key}
                type="button"
                className={`grid-selector-option${isSelected ? ' selected' : ''}`}
                onClick={() => handleSelect(key)}
                onDoubleClick={() => handleDoubleClick(key)}
                title={`${key} — ${px.width}×${px.height} px`}
              >
                <GridPreview cols={cols} rows={rows} px={px} selected={isSelected} />
                <span className="grid-selector-label">{key}</span>
                <span className="grid-selector-size">
                  {px.width}×{px.height}
                </span>
                {isDefault && <span className="grid-selector-badge">default</span>}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="btn btn-primary grid-selector-confirm"
          onClick={handleConfirm}
        >
          Start Editing
        </button>
      </div>
    </div>
  );
}
