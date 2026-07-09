import PropTypes from 'prop-types';
import { Component, useCallback, useEffect, useRef, useState } from 'react';

import Tabs from '../components/Tabs.jsx';
import TablerIcon from '../components/TablerIcon.jsx';
import BindingExpressionEditor from '../components/BindingExpressionEditor.jsx';
import { useDocStore, selectFocusedElements, selectFocusedMisc } from '../store/docStore.js';
import { useUiStore } from '../store/uiStore.js';
import { isBinding, isExpression } from '@zb/expressions';

const TYPE_ICONS = {
  rect: '▢',
  circle: '○',
  text: 'T',
  line: '╱',
  img: '🖼',
  svg: '◇',
};

function LayerItem({
  element,
  index,
  isSelected,
  isLocked,
  isOffCanvas,
  onSelect,
  onUpdate,
  onRemove,
  onToggleLock,
  onEditVisibility,
  onDragStart,
  onDragOver,
  onDrop,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const isVisibilityBound = isBinding(element.visible) || isExpression(element.visible);

  const handleDoubleClick = useCallback(() => {
    setDraft(element.name ?? '');
    setIsEditing(true);
  }, [element.name]);

  const handleBlur = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== element.name) {
      onUpdate(element.id, { name: trimmed });
    }
    setIsEditing(false);
  }, [draft, element.id, element.name, onUpdate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  }, []);

  return (
    <div
      className={`layer-item ${isSelected ? 'selected' : ''}`}
      onClick={(e) => onSelect(element.id, e)}
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
    >
      <span className="layer-icon">{element.type === 'graph' ? <TablerIcon name="chart-bar-popular" size={14} /> : element.type === 'calendarList' ? <TablerIcon name="calendar" size={14} /> : (TYPE_ICONS[element.type] ?? '?')}</span>
      {isOffCanvas && (
        <span className="layer-offcanvas-badge" title="Element is off-canvas">⚠</span>
      )}

      {isEditing ? (
        <input
          className="layer-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="layer-name" onDoubleClick={handleDoubleClick}>
          {element.name}
        </span>
      )}

      <div className="layer-actions">
        <button
          type="button"
          className={`layer-action ${element.visible === false ? 'off' : ''}`}
          title={isVisibilityBound ? 'Edit bound visibility' : element.visible === false ? 'Show' : 'Hide'}
          onClick={(e) => {
            e.stopPropagation();
            if (isVisibilityBound) {
              onEditVisibility(element.id);
              return;
            }
            onUpdate(element.id, { visible: element.visible === false });
          }}
        >
          {isVisibilityBound ? <TablerIcon name="bolt" size={14} /> : (element.visible === false ? '👁‍🗨' : '👁')}
        </button>
        <button
          type="button"
          className={`layer-action ${isLocked ? 'on' : ''}`}
          title={isLocked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(element.id);
          }}
        >
          {isLocked ? '🔒' : '🔓'}
        </button>
        <button
          type="button"
          className="layer-action delete"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(element.id);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

LayerItem.propTypes = {
  element: PropTypes.shape({
    id: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    name: PropTypes.string,
    visible: PropTypes.any,
  }).isRequired,
  index: PropTypes.number.isRequired,
  isSelected: PropTypes.bool.isRequired,
  isLocked: PropTypes.bool.isRequired,
  isOffCanvas: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onToggleLock: PropTypes.func.isRequired,
  onEditVisibility: PropTypes.func.isRequired,
  onDragStart: PropTypes.func.isRequired,
  onDragOver: PropTypes.func.isRequired,
  onDrop: PropTypes.func.isRequired,
};

import InspectorPanel from './InspectorPanel.jsx';
import { getCalendarListBounds } from '../editor/calendarListBounds.js';

// Error boundary to prevent a single bad layer from crashing the panel
class LayerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <div className="layer-item" style={{ opacity: 0.4 }}>⚠ Error rendering layer</div>;
    }
    return this.props.children;
  }
}

function LayersList() {
  const elements = useDocStore(selectFocusedElements);
  const misc = useDocStore(selectFocusedMisc);
  const updateElement = useDocStore((s) => s.updateElement);
  const removeElement = useDocStore((s) => s.removeElement);
  const reorderElements = useDocStore((s) => s.reorderElements);
  const selectedElementId = useUiStore((s) => s.selectedElementId);
  const selectedElementIds = useUiStore((s) => s.selectedElementIds);
  const setSelectedElementId = useUiStore((s) => s.setSelectedElementId);
  const toggleInSelection = useUiStore((s) => s.toggleInSelection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const lockedElementIds = useUiStore((s) => s.lockedElementIds);
  const toggleElementLock = useUiStore((s) => s.toggleElementLock);
  const [editingVisibilityId, setEditingVisibilityId] = useState(null);

  const handleLayerSelect = useCallback(
    (id, e) => {
      if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        toggleInSelection(id);
      } else {
        setSelectedElementId(id);
      }
    },
    [setSelectedElementId, toggleInSelection],
  );

  const handleRemove = useCallback(
    (id) => {
      removeElement(id);
      if (selectedElementId === id) setSelectedElementId(null);
    },
    [removeElement, selectedElementId, setSelectedElementId],
  );

  const editingVisibilityElement = elements.find((element) => element.id === editingVisibilityId) || null;

  // Reverse order: top of list = last drawn (on top visually)
  const reversed = [...(elements ?? [])].reverse();

  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const dragIndexStr = e.dataTransfer.getData('text/plain');
    const dragIndex = parseInt(dragIndexStr, 10);

    if (isNaN(dragIndex) || dragIndex === dropIndex) return;

    // Convert list indices (reversed) to element indices
    // list index 0 -> element index length-1
    // list index i -> element index length-1-i
    const length = elements.length;
    const fromElementIndex = length - 1 - dragIndex;
    const toElementIndex = length - 1 - dropIndex;

    reorderElements(fromElementIndex, toElementIndex);
  };

  if (reversed.length === 0) {
    return <div className="placeholder">No elements yet</div>;
  }

  const artboardW = misc?.size?.width ?? 0;
  const artboardH = misc?.size?.height ?? 0;

  return (
    <div className="layers-list">
      {reversed.map((element, i) => {
        if (!element?.id || !element?.type) return null;
        const ox = element.pos?.x ?? 0;
        const oy = element.pos?.y ?? 0;

        let minX, minY, maxX, maxY;

        if (element.type === 'line' && Array.isArray(element.points) && element.points.length > 0) {
          // Line bounding box: points are relative to pos
          minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
          for (const pt of element.points) {
            if (!Array.isArray(pt)) continue;
            const px = ox + (pt[0] ?? 0);
            const py = oy + (pt[1] ?? 0);
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
          if (!isFinite(minX)) { minX = ox; minY = oy; maxX = ox; maxY = oy; }
        } else if (element.type === 'calendarList') {
          const { width, height } = getCalendarListBounds(element);
          minX = ox;
          minY = oy;
          maxX = ox + width;
          maxY = oy + height;
        } else {
          // Rect, circle, text, img, svg, graph — use sizeX/sizeY
          minX = ox;
          minY = oy;
          maxX = ox + (element.sizeX ?? 0);
          maxY = oy + (element.sizeY ?? 0);
        }

        const offCanvas = artboardW > 0 && artboardH > 0 &&
          (maxX < 0 || minX > artboardW || maxY < 0 || minY > artboardH);
        return (
          <LayerErrorBoundary key={element.id}>
            <LayerItem
              element={element}
              index={i}
              isSelected={selectedElementIds.includes(element.id)}
              isLocked={!!lockedElementIds[element.id]}
              isOffCanvas={offCanvas}
              onSelect={handleLayerSelect}
              onUpdate={updateElement}
              onRemove={handleRemove}
              onToggleLock={toggleElementLock}
              onEditVisibility={setEditingVisibilityId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          </LayerErrorBoundary>
        );
      })}

      {editingVisibilityElement && (
        <BindingExpressionEditor
          value={editingVisibilityElement.visible}
          onSave={(expr) => {
            updateElement(editingVisibilityElement.id, { visible: expr ?? true });
            setEditingVisibilityId(null);
          }}
          onCancel={() => setEditingVisibilityId(null)}
        />
      )}
    </div>
  );
}

export default function RightPanel() {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  const selectedElementId = useUiStore((s) => s.selectedElementId);

  // Auto-switch tabs when selection changes:
  // - Element selected → Inspector
  // - Nothing selected → Layers
  const prevSelectedRef = useRef(selectedElementId);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedElementId;
    if (selectedElementId && !prev) {
      setRightPanelTab('Inspector');
    } else if (!selectedElementId && prev) {
      setRightPanelTab('Layers');
    }
  }, [selectedElementId, setRightPanelTab]);

  const tabs = ['Layers', 'Inspector'];

  function renderBody() {
    if (rightPanelTab === 'Layers') {
      return <LayersList />;
    }
    if (rightPanelTab === 'Inspector') {
      return <InspectorPanel />;
    }
    return null;
  }

  return (
    <aside className="panel panel-right">
      <div className="panel-header">
        <Tabs tabs={tabs} activeTab={rightPanelTab} onTabChange={setRightPanelTab} />
      </div>
      <div className="panel-right-body">
        {renderBody()}
      </div>
    </aside>
  );
}
