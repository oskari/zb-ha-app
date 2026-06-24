export function getSnapLines(element, otherElements, threshold = 5) {
  const lines = [];
  if (!element) return { x: null, y: null, lines };

  // Helper to get edges
  const getEdges = (el) => {
    const x = el.pos?.x ?? 0;
    const y = el.pos?.y ?? 0;
    const w = el.sizeX ?? 0;
    const h = el.sizeY ?? 0;
    return {
      left: x,
      right: x + w,
      top: y,
      bottom: y + h,
      centerX: x + w / 2,
      centerY: y + h / 2,
    };
  };

  const target = getEdges(element);
  let snappedX = null;
  let snappedY = null;

  // Collect all candidate lines from other elements
  const candidates = { x: [], y: [] };

  for (const other of otherElements) {
    if (other.id === element.id) continue;
    const edges = getEdges(other);

    candidates.x.push(edges.left, edges.right, edges.centerX);
    candidates.y.push(edges.top, edges.bottom, edges.centerY);
  }

  // Find closest X
  let minDiffX = threshold + 1;
  let bestXCandidate = null;

  for (const val of candidates.x) {
    // Check left, right, center of target against this val
    const diffs = [
      { diff: Math.abs(target.left - val), snap: val, edge: 'start' },
      { diff: Math.abs(target.right - val), snap: val - (target.right - target.left), edge: 'end' },
      {
        diff: Math.abs(target.centerX - val),
        snap: val - (target.centerX - target.left),
        edge: 'center',
      },
    ];

    for (const d of diffs) {
      if (d.diff < minDiffX) {
        minDiffX = d.diff;
        snappedX = d.snap;
        bestXCandidate = { val, edge: d.edge };
      }
    }
  }

  // Find closest Y
  let minDiffY = threshold + 1;
  let bestYCandidate = null;

  for (const val of candidates.y) {
    const diffs = [
      { diff: Math.abs(target.top - val), snap: val, edge: 'start' },
      {
        diff: Math.abs(target.bottom - val),
        snap: val - (target.bottom - target.top),
        edge: 'end',
      },
      {
        diff: Math.abs(target.centerY - val),
        snap: val - (target.centerY - target.top),
        edge: 'center',
      },
    ];

    for (const d of diffs) {
      if (d.diff < minDiffY) {
        minDiffY = d.diff;
        snappedY = d.snap;
        bestYCandidate = { val, edge: d.edge };
      }
    }
  }

  // If snapped, add guide lines
  if (snappedX !== null && bestXCandidate) {
    lines.push({
      orientation: 'vertical',
      pos: bestXCandidate.val,
      snap: bestXCandidate.edge,
    });
  }

  if (snappedY !== null && bestYCandidate) {
    lines.push({
      orientation: 'horizontal',
      pos: bestYCandidate.val,
      snap: bestYCandidate.edge,
    });
  }

  return { x: snappedX, y: snappedY, lines };
}

/**
 * Snap a proposed bounding box during resize against other elements' edges.
 *
 * Unlike drag snapping, resize only snaps the edges being moved (not the
 * anchored edges). The function detects which edges changed between
 * oldBox and newBox and snaps only those.
 *
 * @param {{ x: number, y: number, width: number, height: number }} oldBox  World-space box before resize
 * @param {{ x: number, y: number, width: number, height: number }} newBox  World-space proposed box
 * @param {Array} otherElements  All elements except the one being resized
 * @param {string} targetId  ID of the element being resized (to exclude)
 * @param {number} threshold  Snap distance in world pixels
 * @returns {{ box: { x, y, width, height }, lines: Array }}
 */
export function getResizeSnapLines(oldBox, newBox, otherElements, targetId, threshold = 5) {
  const lines = [];
  const box = { ...newBox };

  // Determine which edges are moving (tolerance: > 0.5px change)
  const leftMoved = Math.abs(newBox.x - oldBox.x) > 0.5;
  const topMoved = Math.abs(newBox.y - oldBox.y) > 0.5;
  const rightMoved = Math.abs((newBox.x + newBox.width) - (oldBox.x + oldBox.width)) > 0.5;
  const bottomMoved = Math.abs((newBox.y + newBox.height) - (oldBox.y + oldBox.height)) > 0.5;

  if (!leftMoved && !topMoved && !rightMoved && !bottomMoved) {
    return { box, lines };
  }

  // Collect candidate edges from other elements
  const xCandidates = [];
  const yCandidates = [];

  for (const el of otherElements) {
    if (el.id === targetId) continue;
    const ex = el.pos?.x ?? 0;
    const ey = el.pos?.y ?? 0;
    const ew = el.sizeX ?? 0;
    const eh = el.sizeY ?? 0;
    xCandidates.push(ex, ex + ew, ex + ew / 2);
    yCandidates.push(ey, ey + eh, ey + eh / 2);
  }

  // Snap the moving edges
  // Left edge
  if (leftMoved) {
    let best = threshold + 1;
    let snapVal = null;
    for (const c of xCandidates) {
      const d = Math.abs(box.x - c);
      if (d < best) { best = d; snapVal = c; }
    }
    if (snapVal !== null) {
      const delta = snapVal - box.x;
      box.width -= delta;
      box.x = snapVal;
      lines.push({ orientation: 'vertical', pos: snapVal, snap: 'start' });
    }
  }

  // Right edge
  if (rightMoved) {
    const rightEdge = box.x + box.width;
    let best = threshold + 1;
    let snapVal = null;
    for (const c of xCandidates) {
      const d = Math.abs(rightEdge - c);
      if (d < best) { best = d; snapVal = c; }
    }
    if (snapVal !== null) {
      box.width = snapVal - box.x;
      lines.push({ orientation: 'vertical', pos: snapVal, snap: 'end' });
    }
  }

  // Top edge
  if (topMoved) {
    let best = threshold + 1;
    let snapVal = null;
    for (const c of yCandidates) {
      const d = Math.abs(box.y - c);
      if (d < best) { best = d; snapVal = c; }
    }
    if (snapVal !== null) {
      const delta = snapVal - box.y;
      box.height -= delta;
      box.y = snapVal;
      lines.push({ orientation: 'horizontal', pos: snapVal, snap: 'start' });
    }
  }

  // Bottom edge
  if (bottomMoved) {
    const bottomEdge = box.y + box.height;
    let best = threshold + 1;
    let snapVal = null;
    for (const c of yCandidates) {
      const d = Math.abs(bottomEdge - c);
      if (d < best) { best = d; snapVal = c; }
    }
    if (snapVal !== null) {
      box.height = snapVal - box.y;
      lines.push({ orientation: 'horizontal', pos: snapVal, snap: 'end' });
    }
  }

  // Enforce minimum size (1px world space)
  box.width = Math.max(1, box.width);
  box.height = Math.max(1, box.height);

  return { box, lines };
}
