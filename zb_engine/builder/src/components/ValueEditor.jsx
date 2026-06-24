import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import BindingExpressionEditor from './BindingExpressionEditor.jsx';
import TablerIcon from './TablerIcon.jsx';
import { evaluate, isBinding, isExpression } from '@zb/expressions';
import { buildPreviewContext } from '../utils/expressionContext.js';
import { useDocStore, selectFocusedFeatures, selectFocusedSources } from '../store/docStore.js';
import { useUiStore } from '../store/uiStore.js';

const EMPTY_OBJ = {};
const EMPTY_ARR = [];

function formatBindingLabel(value) {
  if (isBinding(value)) {
    // Shorten the path for display
    const path = value.$;
    const parts = path.split('.');
    if (parts.length > 2) {
      return `${parts[0]}.…${parts[parts.length - 1]}`;
    }
    return path;
  }
  if (isExpression(value)) {
    return 'expr';
  }
  return null;
}

export default function ValueEditor({
  value,
  onChange,
  renderInput,
  clearValue = '',
  boundHelpText = null,
  bindButtonTitle = 'Bind to data or expression',
  disableLiteralEditWhenBound = false,
}) {
  const [showEditor, setShowEditor] = useState(false);

  const isBound = isBinding(value) || isExpression(value);
  const bindingLabel = formatBindingLabel(value);

  // Context for evaluation - use stable references
  const featureValues = useDocStore((s) => selectFocusedFeatures(s)?.values) || EMPTY_OBJ;
  const sourceResponsesById = useUiStore((s) => s.sourceResponsesById) || EMPTY_OBJ;
  const sources = useDocStore(selectFocusedSources) || EMPTY_ARR;

  // Build context object
  const context = useMemo(
    () => buildPreviewContext({
      sources,
      sourceResponsesById,
      features: featureValues,
    }),
    [featureValues, sourceResponsesById, sources],
  );

  // Compute preview for bound values
  const previewValue = useMemo(() => {
    if (!isBound) return null;
    try {
      return evaluate(value, context);
    } catch {
      return null;
    }
  }, [value, context, isBound]);

  // Get display value for the input
  const displayValue = useMemo(() => {
    if (isBound) {
      // Show the evaluated value or the default
      if (previewValue !== null && previewValue !== undefined) {
        return previewValue;
      }
      if (isBinding(value) && value.default !== undefined) {
        return value.default;
      }
      return '';
    }
    return value;
  }, [value, isBound, previewValue]);

  const handleInputChange = (newVal) => {
    onChange(newVal);
  };

  const handleSaveBinding = (expr) => {
    if (expr === null) {
      onChange(clearValue);
    } else {
      onChange(expr);
    }
    setShowEditor(false);
  };

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', width: '100%' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renderInput(displayValue, handleInputChange, {
            isBound,
            inputDisabled: isBound && disableLiteralEditWhenBound,
            inputTitle: isBound && disableLiteralEditWhenBound
              ? 'This value is bound. Use the binding editor to change it.'
              : undefined,
            onBoundInputAttempt: () => setShowEditor(true),
          })}
        </div>

        {/* Single bind button */}
        <button
          className="btn"
          onClick={() => setShowEditor(true)}
          title={isBound ? `Bound: ${bindingLabel}` : bindButtonTitle}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            minWidth: 'auto',
            background: isBound ? 'var(--c-accent)' : 'transparent',
            color: isBound ? '#fff' : 'var(--c-text-muted)',
            border: isBound ? 'none' : '1px solid var(--c-border)',
          }}
        >
          {isBound ? <TablerIcon name="bolt" size={14} /> : <TablerIcon name="chart-bar-popular" size={14} />}
        </button>
      </div>

      {/* Binding indicator */}
      {isBound && (
        <div
          style={{
            fontSize: '10px',
            color: 'var(--c-text-muted)',
            marginTop: '2px',
            paddingLeft: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-mono)',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <span style={{ opacity: 0.6, flexShrink: 0, display: 'inline-flex' }}><TablerIcon name="bolt" size={12} /></span>
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}>{bindingLabel}</span>
          {previewValue !== null && previewValue !== undefined && (
            <>
              <span style={{ opacity: 0.4, flexShrink: 0 }}>=</span>
              <span style={{
                fontWeight: 'bold',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}>{String(previewValue)}</span>
            </>
          )}
        </div>
      )}

      {isBound && boundHelpText && (
        <div style={{ fontSize: '10px', color: 'var(--c-text-muted)', marginTop: '2px', paddingLeft: '4px' }}>
          {boundHelpText}
        </div>
      )}

      {showEditor && (
        <BindingExpressionEditor
          value={isBound ? value : null}
          onSave={handleSaveBinding}
          onCancel={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}

ValueEditor.propTypes = {
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  renderInput: PropTypes.func.isRequired,
  clearValue: PropTypes.any,
  boundHelpText: PropTypes.string,
  bindButtonTitle: PropTypes.string,
  disableLiteralEditWhenBound: PropTypes.bool,
};
