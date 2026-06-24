/**
 * GraphInspectorPanel.jsx — Inspector panel for graph element configuration
 *
 * Rendered when a graph element is selected. Allows configuration of:
 *   - Chart type (line / bar)
 *   - Data source binding
 *   - Data paths (array, value, time)
 *   - Axis and grid settings
 *   - Chart-specific styling
 */

import PropTypes from 'prop-types';
import { useState } from 'react';
import {
  Dropdown,
  Field,
  NumberInput,
  Slider,
  TextInput,
  Toggle,
} from '../components/InspectorFields.jsx';
import { FONT_SIZES, getWeightsForFamilySize } from '../utils/fontCatalog.js';
import ValueEditor from '../components/ValueEditor.jsx';
import DataTree from '../components/DataTree.jsx';
import { useDocStore, selectFocusedSources } from '../store/docStore.js';
import { useUiStore } from '../store/uiStore.js';

/**
 * Navigate into `data` using a dot-separated path string and return the value.
 * Returns undefined if the path doesn't resolve.
 */
function resolvePath(data, path) {
  // `path` may be a binding/expression OBJECT when a path field (e.g. Data Path)
  // has been bound via the ⚡ editor. A non-string path has no meaning here, so
  // bail out — calling `.split` on it would throw and (with no error boundary)
  // blank the whole builder.
  if (!data || typeof path !== 'string' || !path) return undefined;
  const segments = path.split('.');
  let current = data;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    // Array index
    const idx = Number(seg);
    if (Array.isArray(current) && Number.isInteger(idx)) {
      current = current[idx];
    } else {
      current = current[seg];
    }
  }
  return current;
}

/**
 * Given an array, inspect the first element and return suggestions for
 * valuePath and timePath based on the keys found.
 */
function suggestPaths(dataArray) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) return null;
  const first = dataArray[0];
  if (!first || typeof first !== 'object') return null;

  const keys = Object.keys(first);
  let valuePath = '';
  let timePath = '';

  // Heuristic: look for common value/time key patterns
  for (const k of keys) {
    const lower = k.toLowerCase();
    if (!valuePath && (lower === 'v' || lower === 'value' || lower === 'y' || lower === 'val')) {
      valuePath = k;
    }
    if (!timePath && (lower === 't' || lower === 'time' || lower === 'x' || lower === 'ts' || lower === 'timestamp' || lower === 'date')) {
      timePath = k;
    }
  }

  // Fallback: if only 2 keys, use first as time and second as value
  if (!valuePath && !timePath && keys.length === 2) {
    timePath = keys[0];
    valuePath = keys[1];
  }

  return valuePath || timePath ? { valuePath, timePath } : null;
}

export default function GraphInspectorPanel({ element, updateElement }) {
  const sources = useDocStore(selectFocusedSources);
  const updateSource = useDocStore((s) => s.updateSource);
  const sourceResponsesById = useUiStore((s) => s.sourceResponsesById);
  const isLine = element.chartType === 'line';
  const isBar = element.chartType === 'bar';

  // Browse mode toggles for data path fields
  const [browsingDataPath, setBrowsingDataPath] = useState(false);
  const [browsingValuePath, setBrowsingValuePath] = useState(false);
  const [browsingTimePath, setBrowsingTimePath] = useState(false);

  // Resolve the source linked to this graph element
  const linkedSource = sources.find((s) => s.id === element.sourceId);
  const sourceData = element.sourceId ? sourceResponsesById?.[element.sourceId]?.data ?? null : null;

  // Resolve the first item of the data array so users can browse its keys
  // for valuePath / timePath selection.
  const resolvedArray = sourceData && element.dataPath
    ? resolvePath(sourceData, element.dataPath)
    : null;
  const firstItem = Array.isArray(resolvedArray) && resolvedArray.length > 0
    && resolvedArray[0] && typeof resolvedArray[0] === 'object'
    ? resolvedArray[0]
    : null;

  // Build source options from configured sources
  const sourceOptions = [
    { value: '', label: '(none)' },
    ...sources.map((s) => ({
      value: s.id,
      label: s.name || s.id,
    })),
  ];

  return (
    <>
      {/* ── Chart Type ────────────────────────────────────────── */}
      <div className="field-group">
        <div className="field-group-header">Chart</div>
        <Field label="Type">
          <ValueEditor
            value={element.chartType}
            onChange={(val) => updateElement(element.id, { chartType: val })}
            renderInput={(val, onChange) => (
              <Dropdown
                value={val}
                onChange={onChange}
                options={[
                  { value: 'line', label: 'Line' },
                  { value: 'bar', label: 'Bar' },
                ]}
              />
            )}
          />
        </Field>
      </div>

      {/* ── Data Source ────────────────────────────────────────── */}
      <div className="field-group">
        <div className="field-group-header">Data</div>
        <Field label="Source">
          <Dropdown
            value={element.sourceId ?? ''}
            onChange={(val) => updateElement(element.id, { sourceId: val })}
            options={sourceOptions}
          />
        </Field>
        <Field label="Data Path">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <ValueEditor
                value={element.dataPath}
                onChange={(val) => updateElement(element.id, { dataPath: val })}
                renderInput={(val, onChange) => (
                  <TextInput value={val} onChange={onChange} placeholder="e.g. points" />
                )}
              />
            </div>
            {sourceData && (
              <button
                type="button"
                className="btn btn-sm"
                title="Browse source data"
                onClick={() => setBrowsingDataPath(!browsingDataPath)}
                style={{ padding: '4px 8px', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                {browsingDataPath ? '✕' : '📂'}
              </button>
            )}
          </div>
          {browsingDataPath && sourceData && (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <DataTree
                data={sourceData}
                selectionMode="any"
                onLeafPath={(path) => {
                  updateElement(element.id, { dataPath: path });
                  setBrowsingDataPath(false);
                  // Auto-suggest value/time paths from the selected array
                  const resolved = resolvePath(sourceData, path);
                  if (Array.isArray(resolved)) {
                    const suggestions = suggestPaths(resolved);
                    if (suggestions) {
                      const patch = {};
                      if (suggestions.valuePath) patch.valuePath = suggestions.valuePath;
                      if (suggestions.timePath) patch.timePath = suggestions.timePath;
                      if (Object.keys(patch).length > 0) {
                        updateElement(element.id, patch);
                      }
                    }
                  }
                }}
              />
            </div>
          )}
        </Field>
        <Field label="Value Path">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <ValueEditor
                value={element.valuePath}
                onChange={(val) => updateElement(element.id, { valuePath: val })}
                renderInput={(val, onChange) => (
                  <TextInput value={val} onChange={onChange} placeholder="e.g. v" />
                )}
              />
            </div>
            {firstItem && (
              <button
                type="button"
                className="btn btn-sm"
                title="Browse array item keys"
                onClick={() => { setBrowsingValuePath(!browsingValuePath); setBrowsingTimePath(false); }}
                style={{ padding: '4px 8px', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                {browsingValuePath ? '✕' : '📂'}
              </button>
            )}
          </div>
          {browsingValuePath && firstItem && (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <DataTree
                data={firstItem}
                selectionMode="any"
                highlightPath={element.timePath || undefined}
                onLeafPath={(path) => {
                  updateElement(element.id, { valuePath: path });
                  setBrowsingValuePath(false);
                }}
              />
            </div>
          )}
        </Field>
        <Field label="Time Path">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <ValueEditor
                value={element.timePath}
                onChange={(val) => updateElement(element.id, { timePath: val })}
                renderInput={(val, onChange) => (
                  <TextInput value={val} onChange={onChange} placeholder="e.g. t" />
                )}
              />
            </div>
            {firstItem && (
              <button
                type="button"
                className="btn btn-sm"
                title="Browse array item keys"
                onClick={() => { setBrowsingTimePath(!browsingTimePath); setBrowsingValuePath(false); }}
                style={{ padding: '4px 8px', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                {browsingTimePath ? '✕' : '📂'}
              </button>
            )}
          </div>
          {browsingTimePath && firstItem && (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <DataTree
                data={firstItem}
                selectionMode="any"
                highlightPath={element.valuePath || undefined}
                onLeafPath={(path) => {
                  updateElement(element.id, { timePath: path });
                  setBrowsingTimePath(false);
                }}
              />
            </div>
          )}
        </Field>
        <Field label="Resolution">
          <ValueEditor
            value={element.resolution}
            onChange={(val) => updateElement(element.id, { resolution: val })}
            renderInput={(val, onChange) => (
              <NumberInput value={val} onChange={onChange} min={10} max={200} />
            )}
          />
        </Field>
        <div className="field-row">
          <Field label="Range Start %" row>
            <ValueEditor
              value={element.dataRangeStart}
              onChange={(val) => updateElement(element.id, { dataRangeStart: val })}
              renderInput={(val, onChange) => (
                <NumberInput value={val} onChange={onChange} min={0} max={100} />
              )}
            />
          </Field>
          <Field label="Range End %" row>
            <ValueEditor
              value={element.dataRangeEnd}
              onChange={(val) => updateElement(element.id, { dataRangeEnd: val })}
              renderInput={(val, onChange) => (
                <NumberInput value={val} onChange={onChange} min={0} max={100} />
              )}
            />
          </Field>
        </div>
        {linkedSource?.kind === 'haHistory' && (
          <Field label="Hours Back">
            <NumberInput
              value={linkedSource.hoursBack ?? 24}
              onChange={(val) => updateSource(linkedSource.id, { hoursBack: val })}
              min={1}
              max={168}
            />
          </Field>
        )}
      </div>

      {/* ── Y-Axis Range ──────────────────────────────────────── */}
      <div className="field-group">
        <div className="field-group-header">Y-Axis</div>
        <div className="field-row">
          <Field label="Min" row>
            <ValueEditor
              value={element.yMin}
              onChange={(val) => updateElement(element.id, { yMin: val })}
              renderInput={(val, onChange) => (
                <TextInput
                  value={val !== null && val !== undefined ? String(val) : ''}
                  onChange={(v) => onChange(v === '' ? null : Number(v))}
                  placeholder="auto"
                />
              )}
            />
          </Field>
          <Field label="Max" row>
            <ValueEditor
              value={element.yMax}
              onChange={(val) => updateElement(element.id, { yMax: val })}
              renderInput={(val, onChange) => (
                <TextInput
                  value={val !== null && val !== undefined ? String(val) : ''}
                  onChange={(v) => onChange(v === '' ? null : Number(v))}
                  placeholder="auto"
                />
              )}
            />
          </Field>
        </div>
      </div>

      {/* ── Axes & Grid ───────────────────────────────────────── */}
      <div className="field-group">
        <div className="field-group-header">Axes &amp; Grid</div>
        <div className="field-row">
          <Field>
            <ValueEditor
              value={element.showAxes}
              onChange={(val) => updateElement(element.id, { showAxes: val })}
              renderInput={(val, onChange) => (
                <Toggle label="Axes" value={val} onChange={onChange} />
              )}
            />
          </Field>
          <Field>
            <ValueEditor
              value={element.showGrid}
              onChange={(val) => updateElement(element.id, { showGrid: val })}
              renderInput={(val, onChange) => (
                <Toggle label="Grid" value={val} onChange={onChange} />
              )}
            />
          </Field>
          <Field>
            <ValueEditor
              value={element.showLabels}
              onChange={(val) => updateElement(element.id, { showLabels: val })}
              renderInput={(val, onChange) => (
                <Toggle label="Labels" value={val} onChange={onChange} />
              )}
            />
          </Field>
        </div>
        {element.showAxes && (
          <Field label="Axis Intensity">
            <ValueEditor
              value={element.axisDither}
              onChange={(val) => updateElement(element.id, { axisDither: val })}
              renderInput={(val, onChange) => (
                <Slider value={val} onChange={onChange} min={0} max={100} />
              )}
            />
          </Field>
        )}
        {element.showGrid && (
          <>
            <Field label="Grid Divisions">
              <ValueEditor
                value={element.gridLines}
                onChange={(val) => updateElement(element.id, { gridLines: val })}
                renderInput={(val, onChange) => (
                  <NumberInput value={val} onChange={onChange} min={1} max={20} />
                )}
              />
            </Field>
            <Field label="Grid Intensity">
              <ValueEditor
                value={element.gridDither}
                onChange={(val) => updateElement(element.id, { gridDither: val })}
                renderInput={(val, onChange) => (
                  <Slider value={val} onChange={onChange} min={0} max={100} />
                )}
              />
            </Field>
            <div className="field-row">
              <Field label="Dash On" row>
                <ValueEditor
                  value={(element.gridDash ?? [2, 3])[0]}
                  onChange={(val) => {
                    const prev = element.gridDash ?? [2, 3];
                    updateElement(element.id, { gridDash: [val, prev[1]] });
                  }}
                  renderInput={(val, onChange) => (
                    <NumberInput value={val} onChange={onChange} min={0} max={20} />
                  )}
                />
              </Field>
              <Field label="Dash Off" row>
                <ValueEditor
                  value={(element.gridDash ?? [2, 3])[1]}
                  onChange={(val) => {
                    const prev = element.gridDash ?? [2, 3];
                    updateElement(element.id, { gridDash: [prev[0], val] });
                  }}
                  renderInput={(val, onChange) => (
                    <NumberInput value={val} onChange={onChange} min={0} max={20} />
                  )}
                />
              </Field>
            </div>
          </>
        )}
        {element.showLabels && (
          <>
            <Field label="Label Size">
              <ValueEditor
                value={element.labelFontSize}
                onChange={(val) => updateElement(element.id, { labelFontSize: val })}
                renderInput={(val, onChange) => (
                  <Dropdown
                    value={String(val)}
                    onChange={(v) => onChange(Number(v))}
                    options={FONT_SIZES.map((s) => ({ value: String(s), label: `${s}px` }))}
                  />
                )}
              />
            </Field>
            <Field label="Label Weight">
              <Dropdown
                value={String(element.labelFontWeight ?? 400)}
                onChange={(v) => updateElement(element.id, { labelFontWeight: Number(v) })}
                options={getWeightsForFamilySize('Sora', element.labelFontSize ?? 10).map((w) => ({
                  value: String(w.value),
                  label: w.name,
                }))}
              />
            </Field>
            <Field label="Label Intensity">
              <ValueEditor
                value={element.labelDither}
                onChange={(val) => updateElement(element.id, { labelDither: val })}
                renderInput={(val, onChange) => (
                  <Slider value={val} onChange={onChange} min={0} max={100} />
                )}
              />
            </Field>
            <Field>
              <ValueEditor
                value={element.showXEndLabel}
                onChange={(val) => updateElement(element.id, { showXEndLabel: val })}
                renderInput={(val, onChange) => (
                  <Toggle label="X-Axis End Label" value={val} onChange={onChange} />
                )}
              />
            </Field>
            <Field label="X Label Interval (h)">
              <ValueEditor
                value={element.xLabelInterval}
                onChange={(val) => updateElement(element.id, { xLabelInterval: val })}
                renderInput={(val, onChange) => (
                  <NumberInput value={val} onChange={onChange} min={0} max={24} />
                )}
              />
            </Field>
            <Field label="X Label Angle">
              <ValueEditor
                value={element.xLabelRotation}
                onChange={(val) => updateElement(element.id, { xLabelRotation: val })}
                renderInput={(val, onChange) => (
                  <Dropdown
                    value={String(val)}
                    onChange={(v) => onChange(Number(v))}
                    options={[
                      { value: '0', label: 'Horizontal' },
                      { value: '-45', label: 'Diagonal' },
                      { value: '-90', label: 'Vertical' },
                    ]}
                  />
                )}
              />
            </Field>
            <Field>
              <ValueEditor
                value={element.showDateLabels}
                onChange={(val) => updateElement(element.id, { showDateLabels: val })}
                renderInput={(val, onChange) => (
                  <Toggle label="Date on X-Axis" value={val} onChange={onChange} />
                )}
              />
            </Field>
          </>
        )}
      </div>

      {/* ── Title ─────────────────────────────────────────────── */}
      <div className="field-group">
        <div className="field-group-header">
          <ValueEditor
            value={element.showTitle}
            onChange={(val) => updateElement(element.id, { showTitle: val })}
            renderInput={(val, onChange) => (
              <Toggle label="Title" value={val} onChange={onChange} />
            )}
          />
        </div>
        {element.showTitle && (
          <>
            <Field label="Text">
              <ValueEditor
                value={element.titleText}
                onChange={(val) => updateElement(element.id, { titleText: val })}
                renderInput={(val, onChange) => (
                  <TextInput value={val} onChange={onChange} placeholder="Chart title" />
                )}
              />
            </Field>
            <div className="field-row">
              <Field label="Size" row>
                <ValueEditor
                  value={element.titleFontSize}
                  onChange={(val) => updateElement(element.id, { titleFontSize: val })}
                  renderInput={(val, onChange) => (
                    <Dropdown
                      value={String(val)}
                      onChange={(v) => onChange(Number(v))}
                      options={FONT_SIZES.map((s) => ({ value: String(s), label: `${s}px` }))}
                    />
                  )}
                />
              </Field>
              <Field label="Weight" row>
                <Dropdown
                  value={String(element.titleFontWeight ?? 600)}
                  onChange={(v) => updateElement(element.id, { titleFontWeight: Number(v) })}
                  options={getWeightsForFamilySize('Sora', element.titleFontSize ?? 10).map((w) => ({
                    value: String(w.value),
                    label: w.name,
                  }))}
                />
              </Field>
            </div>
            <Field label="Intensity">
              <ValueEditor
                value={element.titleDither}
                onChange={(val) => updateElement(element.id, { titleDither: val })}
                renderInput={(val, onChange) => (
                  <Slider value={val} onChange={onChange} min={0} max={100} />
                )}
              />
            </Field>
          </>
        )}
      </div>

      {/* ── Line Chart Styling ────────────────────────────────── */}
      {isLine && (
        <div className="field-group">
          <div className="field-group-header">Line Style</div>
          <div className="field-row">
            <Field label="Width" row>
              <ValueEditor
                value={element.lineStrokeWidth}
                onChange={(val) => updateElement(element.id, { lineStrokeWidth: val })}
                renderInput={(val, onChange) => (
                  <NumberInput value={val} onChange={onChange} min={1} max={10} />
                )}
              />
            </Field>
            <Field label="Radius" row>
              <ValueEditor
                value={element.lineStrokeRadius}
                onChange={(val) => updateElement(element.id, { lineStrokeRadius: val })}
                renderInput={(val, onChange) => (
                  <NumberInput value={val} onChange={onChange} min={0} max={20} />
                )}
              />
            </Field>
          </div>
          <Field label="Intensity">
            <ValueEditor
              value={element.lineStrokeDither}
              onChange={(val) => updateElement(element.id, { lineStrokeDither: val })}
              renderInput={(val, onChange) => (
                <Slider value={val} onChange={onChange} min={0} max={100} />
              )}
            />
          </Field>
        </div>
      )}

      {/* ── Bar Chart Styling ─────────────────────────────────── */}
      {isBar && (
        <div className="field-group">
          <div className="field-group-header">Bar Style</div>
          <Field label="Fill Intensity">
            <ValueEditor
              value={element.barFillDither}
              onChange={(val) => updateElement(element.id, { barFillDither: val })}
              renderInput={(val, onChange) => (
                <Slider value={val} onChange={onChange} min={0} max={100} />
              )}
            />
          </Field>
          <Field label="Gap (px)">
            <ValueEditor
              value={element.barGap}
              onChange={(val) => updateElement(element.id, { barGap: val })}
              renderInput={(val, onChange) => (
                <NumberInput value={val} onChange={onChange} min={0} max={20} />
              )}
            />
          </Field>
          <div className="field-group-header">
            <ValueEditor
              value={element.barStrokeEnabled}
              onChange={(val) => updateElement(element.id, { barStrokeEnabled: val })}
              renderInput={(val, onChange) => (
                <Toggle label="Bar Stroke" value={val} onChange={onChange} />
              )}
            />
          </div>
          {element.barStrokeEnabled && (
            <Field label="Stroke Intensity">
              <ValueEditor
                value={element.barStrokeDither}
                onChange={(val) => updateElement(element.id, { barStrokeDither: val })}
                renderInput={(val, onChange) => (
                  <Slider value={val} onChange={onChange} min={0} max={100} />
                )}
              />
            </Field>
          )}
        </div>
      )}
    </>
  );
}

GraphInspectorPanel.propTypes = {
  element: PropTypes.object.isRequired,
  updateElement: PropTypes.func.isRequired,
};
