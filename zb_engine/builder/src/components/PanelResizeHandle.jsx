/**
 * PanelResizeHandle.jsx — Drag handle for resizing side panels
 *
 * Renders a thin vertical strip between a panel and the canvas area.
 * Dragging horizontally resizes the adjacent panel between its minimum
 * width and half the viewport. Width is clamped per-frame via the
 * onResize callback (which should call uiStore.setLeft/RightPanelWidth).
 */

import { useCallback } from 'react';

/**
 * @param {object}   props
 * @param {'left'|'right'} props.side  — Which panel this handle controls
 * @param {number}   props.currentWidth — Current panel width in px
 * @param {function} props.onResize    — Called with the new width (number)
 */
export default function PanelResizeHandle({ side, currentWidth, onResize }) {
  const handlePointerDown = useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentWidth;
      const maxWidth = Math.floor(window.innerWidth / 2);

      const handlePointerMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        // Left panel: dragging right = wider; Right panel: dragging left = wider
        const newWidth = side === 'left'
          ? startWidth + delta
          : startWidth - delta;
        const clamped = Math.max(side === 'left' ? 280 : 300, Math.min(maxWidth, newWidth));
        onResize(clamped);
      };

      const handlePointerUp = () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [side, currentWidth, onResize],
  );

  return (
    <div
      className="panel-resize-handle"
      onPointerDown={handlePointerDown}
    />
  );
}
