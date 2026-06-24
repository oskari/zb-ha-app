import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

function isObjectLike(value) {
  return value !== null && typeof value === 'object';
}

function isExpandable(value) {
  return (
    isObjectLike(value) && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)
  );
}

function summarize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return 'Object';
  if (typeof value === 'string') {
    const preview = value.length > 60 ? `${value.slice(0, 57)}…` : value;
    return JSON.stringify(preview);
  }
  return String(value);
}

function formatPath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  let path = '';
  for (const seg of segments) {
    if (typeof seg === 'number') {
      path += `[${seg}]`;
      continue;
    }
    const key = String(seg);
    if (/^[A-Za-z_$][\w$]*$/.test(key)) {
      path += path ? `.${key}` : key;
    } else {
      path += `[${JSON.stringify(key)}]`;
    }
  }
  return path;
}

function getEntries(value) {
  if (Array.isArray(value)) {
    return value.map((v, idx) => ({ key: idx, label: `[${idx}]`, value: v }));
  }
  return Object.keys(value).map((k) => ({ key: k, label: k, value: value[k] }));
}

function TreeNode({ label, value, pathSegments, depth, expandedSet, toggleExpanded, onLeafPath, selectionMode, highlightPath }) {
  const expandable = isExpandable(value);
  const currentPath = formatPath(pathSegments);
  const isExpanded = expandable && expandedSet.has(currentPath);
  const isLeaf = !isObjectLike(value) || !expandable;
  const canSelect = isLeaf
    ? selectionMode !== 'branch'
    : selectionMode === 'branch' || selectionMode === 'any';
  const isHighlighted = highlightPath && currentPath === highlightPath;

  const handleRowClick = async () => {
    // Leaf or selectable branch: emit the path (currentPath === formatPath(pathSegments), L77).
    if (canSelect) {
      if (currentPath && onLeafPath) onLeafPath(currentPath);
      return;
    }
    // Non-selectable branch: toggle expand instead.
    if (!isLeaf) {
      toggleExpanded(currentPath);
    }
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: 'var(--sp-1) var(--sp-2)',
    borderRadius: 'var(--radius)',
    cursor: canSelect || expandable ? 'pointer' : 'default',
    userSelect: 'none',
    marginLeft: `${depth * 12}px`,
    ...(isHighlighted ? { fontWeight: 'bold', outline: '2px solid var(--c-accent)', outlineOffset: '-1px' } : {}),
  };

  const caretStyle = {
    width: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--c-text-muted)',
    cursor: expandable ? 'pointer' : 'default',
    flex: '0 0 16px',
  };

  return (
    <div>
      <div
        style={rowStyle}
        data-tree-path={currentPath}
        title={canSelect ? 'Click to select path' : expandable ? 'Click to expand' : undefined}
        onClick={handleRowClick}
        onMouseEnter={(e) => {
          if (isHighlighted) return;
          if (!canSelect && !expandable) return;
          e.currentTarget.style.background = 'var(--c-bg)';
        }}
        onMouseLeave={(e) => {
          if (isHighlighted) return;
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          style={caretStyle}
          onClick={(e) => {
            e.stopPropagation();
            if (!expandable) return;
            toggleExpanded(formatPath(pathSegments));
          }}
          aria-hidden
        >
          {expandable ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{label}</span>
        <span style={{ opacity: 0.7, fontSize: '12px' }}>{summarize(value)}</span>
      </div>

      {expandable && isExpanded && (
        <div>
          {getEntries(value).map((entry) => (
            <TreeNode
              key={String(entry.key)}
              label={entry.label}
              value={entry.value}
              pathSegments={[...pathSegments, entry.key]}
              depth={depth + 1}
              expandedSet={expandedSet}
              toggleExpanded={toggleExpanded}
              onLeafPath={onLeafPath}
              selectionMode={selectionMode}
              highlightPath={highlightPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

TreeNode.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.any,
  pathSegments: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number]))
    .isRequired,
  depth: PropTypes.number.isRequired,
  expandedSet: PropTypes.instanceOf(Set).isRequired,
  toggleExpanded: PropTypes.func.isRequired,
  onLeafPath: PropTypes.func.isRequired,
  selectionMode: PropTypes.oneOf(['leaf', 'branch', 'any']),
  highlightPath: PropTypes.string,
};

/**
 * Parse a dot/bracket path string into an array of segments.
 * e.g. 'attributes.temperature' → ['attributes', 'temperature']
 * e.g. 'points[0].v' → ['points', 0, 'v']
 */
function parsePath(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return [];
  const segments = [];
  let i = 0;
  while (i < pathStr.length) {
    if (pathStr[i] === '.') { i++; continue; }
    if (pathStr[i] === '[') {
      const end = pathStr.indexOf(']', i);
      if (end === -1) break;
      const inner = pathStr.slice(i + 1, end);
      const num = parseInt(inner, 10);
      if (!isNaN(num) && String(num) === inner) {
        segments.push(num);
      } else {
        segments.push(inner.replace(/^["']|["']$/g, ''));
      }
      i = end + 1;
    } else {
      let end = i;
      while (end < pathStr.length && pathStr[end] !== '.' && pathStr[end] !== '[') end++;
      if (end > i) segments.push(pathStr.slice(i, end));
      i = end;
    }
  }
  return segments;
}

/**
 * Compute the set of ancestor paths that need to be expanded
 * so that the target path is visible in the tree.
 */
function computeAncestorPaths(pathStr) {
  const segments = parsePath(pathStr);
  const paths = new Set();
  for (let i = 1; i < segments.length; i++) {
    paths.add(formatPath(segments.slice(0, i)));
  }
  return paths;
}

export default function DataTree({ data, onLeafPath, selectionMode = 'leaf', highlightPath = '' }) {
  const containerRef = useRef(null);
  const [expanded, setExpanded] = useState(() => {
    if (!highlightPath) return new Set();
    return computeAncestorPaths(highlightPath);
  });

  const normalizedData = useMemo(() => {
    if (data === null || data === undefined) return null;
    return data;
  }, [data]);

  const toggleExpanded = (pathKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  };

  // Recursively collect all expandable paths (with depth limit for large trees)
  const collectAllPaths = (value, segments, depth, maxDepth, out) => {
    if (depth >= maxDepth || !isExpandable(value)) return;
    const path = formatPath(segments);
    if (path) out.add(path);
    const entries = getEntries(value);
    for (const entry of entries) {
      collectAllPaths(entry.value, [...segments, entry.key], depth + 1, maxDepth, out);
    }
  };

  const handleExpandAll = () => {
    if (!isObjectLike(normalizedData)) return;
    const paths = new Set();
    const entries = getEntries(normalizedData);
    for (const entry of entries) {
      collectAllPaths(entry.value, [entry.key], 0, 3, paths);
    }
    setExpanded(paths);
  };

  const handleCollapseAll = () => {
    setExpanded(new Set());
  };

  // Auto-expand ancestors when highlightPath changes (e.g. data loads after mount)
  useEffect(() => {
    if (!highlightPath) return;
    const ancestors = computeAncestorPaths(highlightPath);
    if (ancestors.size === 0) return;
    setExpanded((prev) => {
      const merged = new Set(prev);
      for (const p of ancestors) merged.add(p);
      return merged;
    });
  }, [highlightPath]);

  // Scroll highlighted node into view after expansion
  useEffect(() => {
    if (!highlightPath || !containerRef.current) return;
    const timer = setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-tree-path="${CSS.escape(highlightPath)}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(timer);
  }, [highlightPath, expanded]);

  if (!isObjectLike(normalizedData)) {
    return <div style={{ opacity: 0.7, fontSize: '12px' }}>No object data to explore.</div>;
  }

  return (
    <div
      ref={containerRef}
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        background: 'var(--c-surface)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginBottom: 'var(--sp-1)' }}>
        <button
          type="button"
          title="Expand all"
          onClick={handleExpandAll}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            color: 'var(--c-text-muted)',
            padding: '2px 4px',
          }}
        >
          ⊞
        </button>
        <button
          type="button"
          title="Collapse all"
          onClick={handleCollapseAll}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            color: 'var(--c-text-muted)',
            padding: '2px 4px',
          }}
        >
          ⊟
        </button>
      </div>
      {getEntries(normalizedData).map((entry) => (
        <TreeNode
          key={String(entry.key)}
          label={entry.label}
          value={entry.value}
          pathSegments={[entry.key]}
          depth={0}
          expandedSet={expanded}
          toggleExpanded={toggleExpanded}
          onLeafPath={onLeafPath}
          selectionMode={selectionMode}
          highlightPath={highlightPath}
        />
      ))}
    </div>
  );
}

DataTree.propTypes = {
  data: PropTypes.any,
  onLeafPath: PropTypes.func,
  selectionMode: PropTypes.oneOf(['leaf', 'branch', 'any']),
  highlightPath: PropTypes.string,
};

DataTree.defaultProps = {
  onLeafPath: () => {},
};
