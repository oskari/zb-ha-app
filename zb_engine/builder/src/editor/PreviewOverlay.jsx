/**
 * PreviewOverlay – Konva Group rendered on the infinite canvas showing the
 * latest rendered preview image.  Draggable and resizable via corner handles.
 *
 * Props:
 *   artboardWidth  – design-surface width  (world px)
 *   artboardHeight – design-surface height (world px)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Group, Rect, Image as KonvaImage, Text } from 'react-konva';
import { useUiStore } from '../store/uiStore';
import { useDocStore } from '../store/docStore';
import { isFullscreenId } from '../store/companionId';

// ── Constants (tweak-friendly, in one place) ──

const EDGE_SNAP_THRESHOLD = 20; // px — how close before snapping to artboard edge
const DEFAULT_GAP = 30; // px — gap between artboard and preview when first placed
const RESIZE_HANDLE_SIZE = 10;
const PLACEHOLDER_BG = '#e8e8e8';
const BORDER_COLOR = '#333';
const LABEL_FONT_SIZE = 16;
const MIN_OVERLAY_WIDTH = 60; // px — smallest the preview can shrink to

// ── Component ──

export default function PreviewOverlay({ artboardWidth, artboardHeight }) {
  // Store bindings
  const previewOverlay = useUiStore((s) => s.previewOverlay);
  const updatePreviewOverlay = useUiStore((s) => s.updatePreviewOverlay);
  const lastRenderAt = useUiStore((s) => s.lastRenderAt);
  const previewImageUrlGetter = useUiStore((s) => s.previewImageUrlGetter);

  // Local state for the loaded HTMLImageElement
  const [image, setImage] = useState(null);
  const [loadError, setLoadError] = useState(false);

  // Derive effective dimensions (auto-size to artboard when 0)
  const overlayW = previewOverlay.width || artboardWidth;
  const overlayH = previewOverlay.height || artboardHeight;

  // Initial positioning — place below artboard on first enable
  const hasPositioned = useRef(false);
  useEffect(() => {
    if (!previewOverlay.enabled) {
      hasPositioned.current = false;
      return;
    }
    if (hasPositioned.current) return;
    hasPositioned.current = true;

    // Only auto-position when the stored position looks like the default (0, 160)
    if (previewOverlay.x === 0 && previewOverlay.y === 160) {
      updatePreviewOverlay({
        x: 0,
        y: artboardHeight + DEFAULT_GAP,
        width: artboardWidth,
        height: artboardHeight,
      });
    }
  }, [previewOverlay.enabled, artboardWidth, artboardHeight, previewOverlay.x, previewOverlay.y, updatePreviewOverlay]);

  // ── Re-fit overlay when the artboard's aspect ratio changes ──
  // Triggers on:
  //   • Slot switch (primary ↔ fullscreen companion) — different physical sizes.
  //   • Grid-size change on the focused doc.
  //   • Re-enabling the overlay after the focused doc was switched while it
  //     was hidden (component remounts; a ref-based prev tracker would be
  //     re-initialized to the post-switch dims and miss the change).
  //
  // The corner-resize handler keeps the overlay locked to the artboard's
  // aspect ratio, so an aspect-ratio mismatch between the stored overlay
  // and the current artboard is a reliable "artboard changed" signal that
  // also preserves the user's manual resize when the artboard is unchanged.
  useEffect(() => {
    if (!previewOverlay.enabled) return;
    if (!artboardWidth || !artboardHeight) return;

    const overlayW = previewOverlay.width;
    const overlayH = previewOverlay.height;

    // No stored dims yet → nothing to compare against; the initial-position
    // effect above will seed them.
    if (!overlayW || !overlayH) return;

    const overlayAspect = overlayW / overlayH;
    const artboardAspect = artboardWidth / artboardHeight;

    // Tolerance covers floating-point drift from previous corner resizes.
    if (Math.abs(overlayAspect - artboardAspect) < 0.001) return;

    updatePreviewOverlay({
      x: 0,
      y: artboardHeight + DEFAULT_GAP,
      width: artboardWidth,
      height: artboardHeight,
    });
  }, [
    previewOverlay.enabled,
    previewOverlay.width,
    previewOverlay.height,
    artboardWidth,
    artboardHeight,
    updatePreviewOverlay,
  ]);

  // ── Image loading / reloading ──
  // Slot is derived from the focused doc id so the overlay shows the
  // companion's preview when the user is editing the fullscreen tab.
  const focusedDocId = useDocStore((s) => s.focusedDocId);
  const slot = isFullscreenId(focusedDocId) ? 'fullscreen' : 'primary';

  useEffect(() => {
    if (!previewOverlay.enabled) return;
    if (!previewImageUrlGetter) return;

    const url = previewImageUrlGetter(slot);
    if (!url) {
      setImage(null);
      setLoadError(false);
      return;
    }

    // Deployed-cache URLs need a cache-buster. Blob/data URLs already point
    // to immutable in-memory preview bytes and must not be modified.
    const bustUrl = url.startsWith('blob:') || url.startsWith('data:')
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}t=${lastRenderAt ?? 0}`;

    const img = new window.Image();
    img.onload = () => {
      setImage(img);
      setLoadError(false);
    };
    img.onerror = () => {
      setImage(null);
      setLoadError(true);
    };
    img.src = bustUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [previewOverlay.enabled, lastRenderAt, previewImageUrlGetter, slot]);

  // ── Drag handler with edge-snapping ──
  const handleDragEnd = useCallback(
    (e) => {
      let x = e.target.x();
      let y = e.target.y();

      // Snap to artboard edges (parallel-edge priority)
      // Left edge of overlay ↔ left edge of artboard
      if (Math.abs(x) < EDGE_SNAP_THRESHOLD) x = 0;
      // Right edge of overlay ↔ right edge of artboard
      if (Math.abs(x + overlayW - artboardWidth) < EDGE_SNAP_THRESHOLD) x = artboardWidth - overlayW;
      // Left edge of overlay ↔ right edge of artboard (outside right)
      if (Math.abs(x - artboardWidth) < EDGE_SNAP_THRESHOLD) x = artboardWidth + DEFAULT_GAP;
      // Right edge of overlay ↔ left edge of artboard (outside left)
      if (Math.abs(x + overlayW) < EDGE_SNAP_THRESHOLD) x = -(overlayW + DEFAULT_GAP);

      // Top edge of overlay ↔ top edge of artboard
      if (Math.abs(y) < EDGE_SNAP_THRESHOLD) y = 0;
      // Bottom edge of overlay ↔ bottom edge of artboard
      if (Math.abs(y + overlayH - artboardHeight) < EDGE_SNAP_THRESHOLD) y = artboardHeight - overlayH;
      // Top edge of overlay ↔ bottom edge of artboard (outside bottom)
      if (Math.abs(y - artboardHeight) < EDGE_SNAP_THRESHOLD) y = artboardHeight + DEFAULT_GAP;
      // Bottom edge of overlay ↔ top edge of artboard (outside top)
      if (Math.abs(y + overlayH) < EDGE_SNAP_THRESHOLD) y = -(overlayH + DEFAULT_GAP);

      e.target.x(x);
      e.target.y(y);
      updatePreviewOverlay({ x, y });
    },
    [overlayW, overlayH, artboardWidth, artboardHeight, updatePreviewOverlay],
  );

  // ── Corner resize handles (aspect-ratio locked to artboard proportions) ──
  // The preview replicates the physical device, so width:height is always
  // artboardWidth:artboardHeight.  Dragging any corner scales uniformly.
  const aspectRatio = artboardWidth / artboardHeight; // e.g. 800/480 ≈ 1.667

  const handleCornerDrag = useCallback(
    (corner, e) => {
      const ox = previewOverlay.x;
      const oy = previewOverlay.y;
      const cx = e.target.x();
      const cy = e.target.y();

      // Use whichever axis the user dragged more to determine the new width,
      // then derive height from the locked aspect ratio.
      let newW, newH, newX, newY;

      if (corner === 'se') {
        // Anchor = top-left (ox, oy stays fixed)
        newW = Math.max(MIN_OVERLAY_WIDTH, Math.max(cx, cy * aspectRatio));
        newH = newW / aspectRatio;
        newX = ox;
        newY = oy;
      } else if (corner === 'sw') {
        // Anchor = top-right
        const rawW = Math.max(MIN_OVERLAY_WIDTH, Math.max(overlayW - cx, cy * aspectRatio));
        newW = rawW;
        newH = newW / aspectRatio;
        newX = ox + (overlayW - newW);
        newY = oy;
      } else if (corner === 'ne') {
        // Anchor = bottom-left
        const rawW = Math.max(MIN_OVERLAY_WIDTH, Math.max(cx, (overlayH - cy) * aspectRatio));
        newW = rawW;
        newH = newW / aspectRatio;
        newX = ox;
        newY = oy + (overlayH - newH);
      } else {
        // 'nw' — Anchor = bottom-right
        const rawW = Math.max(MIN_OVERLAY_WIDTH, Math.max(overlayW - cx, (overlayH - cy) * aspectRatio));
        newW = rawW;
        newH = newW / aspectRatio;
        newX = ox + (overlayW - newW);
        newY = oy + (overlayH - newH);
      }

      updatePreviewOverlay({ x: newX, y: newY, width: newW, height: newH });
    },
    [overlayW, overlayH, previewOverlay.x, previewOverlay.y, aspectRatio, updatePreviewOverlay],
  );

  // Position for each corner handle (relative to the Group)
  const corners = [
    { id: 'nw', x: 0, y: 0 },
    { id: 'ne', x: overlayW, y: 0 },
    { id: 'sw', x: 0, y: overlayH },
    { id: 'se', x: overlayW, y: overlayH },
  ];

  const cursorForCorner = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' };

  if (!previewOverlay.enabled) return null;

  return (
    <Group
      x={previewOverlay.x}
      y={previewOverlay.y}
      draggable
      onDragEnd={handleDragEnd}
    >
      {/* Background / placeholder */}
      <Rect
        width={overlayW}
        height={overlayH}
        fill={PLACEHOLDER_BG}
        stroke={BORDER_COLOR}
        strokeWidth={1}
        shadowColor="rgba(0,0,0,0.18)"
        shadowBlur={8}
        shadowOffsetY={2}
      />

      {/* Label */}
      <Text
        x={4}
        y={-LABEL_FONT_SIZE - 4}
        text="Preview"
        fontSize={LABEL_FONT_SIZE}
        fill="#888"
        listening={false}
      />

      {/* Rendered image (scaled to fit) */}
      {image && (
        <KonvaImage
          image={image}
          x={0}
          y={0}
          width={overlayW}
          height={overlayH}
          listening={false}
        />
      )}

      {/* Error fallback text */}
      {loadError && !image && (
        <Text
          x={overlayW / 2 - 40}
          y={overlayH / 2 - 8}
          text="Load failed"
          fontSize={13}
          fill="#999"
          listening={false}
        />
      )}

      {/* No-render placeholder */}
      {!image && !loadError && (
        <Text
          x={overlayW / 2 - 48}
          y={overlayH / 2 - 8}
          text="No preview yet"
          fontSize={13}
          fill="#999"
          listening={false}
        />
      )}

      {/* Corner resize handles */}
      {corners.map((c) => (
        <Rect
          key={c.id}
          x={c.x - RESIZE_HANDLE_SIZE / 2}
          y={c.y - RESIZE_HANDLE_SIZE / 2}
          width={RESIZE_HANDLE_SIZE}
          height={RESIZE_HANDLE_SIZE}
          fill="#fff"
          stroke={BORDER_COLOR}
          strokeWidth={1}
          draggable
          onDragMove={(e) => {
            // Prevent the drag from moving the parent Group
            e.cancelBubble = true;
            handleCornerDrag(c.id, e);
          }}
          onDragEnd={(e) => {
            e.cancelBubble = true;
            // Reset local position — the Group's position was updated via store
            e.target.x(c.x - RESIZE_HANDLE_SIZE / 2);
            e.target.y(c.y - RESIZE_HANDLE_SIZE / 2);
          }}
          onMouseEnter={(e) => {
            e.target.getStage().container().style.cursor = cursorForCorner[c.id];
          }}
          onMouseLeave={(e) => {
            e.target.getStage().container().style.cursor = 'default';
          }}
        />
      ))}
    </Group>
  );
}
