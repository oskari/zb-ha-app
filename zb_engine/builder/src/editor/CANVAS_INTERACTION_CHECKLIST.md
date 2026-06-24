# Canvas Interaction Checklist

Use this checklist after Phase 4 CanvasArea extractions or any future behavior-changing editor refactor. It is manual smoke coverage for pointer/keyboard behavior that is hard to prove with current unit tests.

## Viewport

- Pan with mouse wheel/trackpad scroll.
- Pan with middle mouse drag.
- Pan with Space + left mouse drag.
- Zoom with Ctrl + wheel and verify zoom centers on the cursor.
- Recenter via the toolbox and after switching widgets/slots.

## Selection and editing

- Select one element by clicking it.
- Multi-select with modifier click.
- Drag selected elements and verify positions persist in `docStore`.
- Resize via Transformer handles for rect/circle/image/svg/graph elements.
- Confirm text elements move/rotate but retain auto-sized bounds.
- Delete selection with the Delete key.
- Undo and redo edits with keyboard shortcuts and toolbox buttons.

## Snapping and guides

- Toggle grid snapping and drag/resize near grid lines.
- Toggle element snapping and verify guide lines appear/disappear correctly.
- Confirm snapping does not affect locked elements.

## Tools

- Create each element type from the toolbox.
- Use the line tool: first click starts preview, pointer move updates preview, second click commits the line.
- Press Escape while using the line tool and verify it cancels without a payload change.
- Marquee-select from empty canvas space.

## Data-driven preview

- Add a source, verify initial source test populates preview data.
- Change a source data-affecting field and verify stale cached data is cleared/refetched.
- Bind a text element to source/feature data and verify the canvas text auto-sizes to the resolved value.

## Preview overlay and slots

- Render preview and toggle the on-canvas preview overlay.
- Drag/resize the preview overlay.
- Switch between primary and fullscreen slots and verify selection/history/viewport remain coherent.
- Remove the fullscreen companion and verify the canvas returns to the primary slot.
