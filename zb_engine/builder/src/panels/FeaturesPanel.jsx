import { useState } from 'react';
import PropTypes from 'prop-types';

import {
  Dropdown,
  Field,
  NumberInput,
  Slider,
  TextInput,
  Toggle,
  ColorInput,
} from '../components/InspectorFields.jsx';
import { useDocStore, selectFocusedFeatures } from '../store/docStore.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

function FeatureForm({ featureKey, definition, updateFeature }) {
  if (!definition) return null;

  return (
    <div className="field-stack">
      <Field label="Key (ID)">
        <TextInput
          value={definition.key}
          onChange={(val) => updateFeature(featureKey, { key: val })}
        />
      </Field>

      <Field label="Type">
        <Dropdown
          value={definition.type}
          onChange={(val) => updateFeature(featureKey, { type: val })}
          options={[
            { value: 'string', label: 'String' },
            { value: 'number', label: 'Number' },
            { value: 'boolean', label: 'Boolean' },
            { value: 'select', label: 'Select' },
            { value: 'multi-select', label: 'Multi-Select' },
          ]}
        />
      </Field>

      <Field label="Label">
        <TextInput
          value={definition.label}
          onChange={(val) => updateFeature(featureKey, { label: val })}
          placeholder="Display Name"
        />
      </Field>

      {definition.type === 'string' && (
        <Field label="Control Type">
          <Dropdown
            value={definition.controlType || 'text'}
            onChange={(val) => updateFeature(featureKey, { controlType: val })}
            options={[
              { value: 'text', label: 'Text Input' },
              { value: 'textarea', label: 'Text Area' },
              { value: 'color', label: 'Color Picker' },
            ]}
          />
        </Field>
      )}

      {definition.type === 'number' && (
        <>
          <Field label="Control Type">
            <Dropdown
              value={definition.controlType || 'number'}
              onChange={(val) => updateFeature(featureKey, { controlType: val })}
              options={[
                { value: 'number', label: 'Number Input' },
                { value: 'slider', label: 'Slider' },
              ]}
            />
          </Field>
          <div className="field-row">
            <Field label="Min" row>
              <NumberInput
                value={definition.min}
                onChange={(val) => updateFeature(featureKey, { min: val })}
              />
            </Field>
            <Field label="Max" row>
              <NumberInput
                value={definition.max}
                onChange={(val) => updateFeature(featureKey, { max: val })}
              />
            </Field>
            <Field label="Step" row>
              <NumberInput
                value={definition.step}
                onChange={(val) => updateFeature(featureKey, { step: val })}
              />
            </Field>
          </div>
          <Field label="Number Type">
            <Dropdown
              value={definition.numberType || 'float'}
              onChange={(val) => updateFeature(featureKey, { numberType: val })}
              options={[
                { value: 'float', label: 'Float (decimal)' },
                { value: 'int', label: 'Integer' },
              ]}
            />
          </Field>
        </>
      )}

      {(definition.type === 'select' || definition.type === 'multi-select') && (
        <Field label="Options (comma separated)">
          <TextInput
            value={(definition.options || []).join(', ')}
            onChange={(val) =>
              updateFeature(featureKey, {
                options: val
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Option 1, Option 2"
          />
        </Field>
      )}

      {definition.type === 'multi-select' && (
        <Field label="Delimiter">
          <TextInput
            value={definition.delimiter}
            onChange={(val) => updateFeature(featureKey, { delimiter: val })}
            placeholder=", "
          />
        </Field>
      )}

      <Field label="Default Value">
        {definition.type === 'boolean' ? (
          <Toggle
            label="True"
            value={definition.default}
            onChange={(val) => updateFeature(featureKey, { default: val })}
          />
        ) : definition.type === 'number' ? (
          <NumberInput
            value={definition.default}
            onChange={(val) => updateFeature(featureKey, { default: val })}
          />
        ) : (
          <TextInput
            value={definition.default}
            onChange={(val) => updateFeature(featureKey, { default: val })}
          />
        )}
      </Field>
    </div>
  );
}

function PreviewInputs({ definitions, values, setFeatureValue }) {
  if (!definitions || Object.keys(definitions).length === 0) {
    return <div style={{ opacity: 0.5, fontStyle: 'italic' }}>No features defined.</div>;
  }

  return (
    <div className="field-stack">
      {Object.values(definitions).map((def) => {
        const val = values?.[def.key] ?? def.default;
        const label = def.label || def.key;

        return (
          <Field key={def.key} label={label}>
            {def.type === 'boolean' ? (
              <Toggle label={label} value={val} onChange={(v) => setFeatureValue(def.key, v)} />
            ) : def.type === 'number' ? (
              def.controlType === 'slider' ? (
                <Slider
                  value={val}
                  onChange={(v) => setFeatureValue(def.key, v)}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                />
              ) : (
                <NumberInput
                  value={val}
                  onChange={(v) => setFeatureValue(def.key, v)}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                />
              )
            ) : def.type === 'select' ? (
              <Dropdown
                value={val}
                onChange={(v) => setFeatureValue(def.key, v)}
                options={(def.options || []).map((opt) => ({ value: opt, label: opt }))}
              />
            ) : def.type === 'multi-select' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(def.options || []).map((opt) => {
                  const delimiter = def.delimiter || ', ';
                  const current = val ? String(val).split(delimiter) : [];
                  const isSelected = current.includes(opt);
                  return (
                    <label key={opt} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          let next = [...current];
                          if (e.target.checked) {
                            if (!next.includes(opt)) next.push(opt);
                          } else {
                            next = next.filter((s) => s !== opt);
                          }
                          setFeatureValue(def.key, next.join(delimiter));
                        }}
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : def.controlType === 'textarea' ? (
              <textarea
                className="input"
                rows={3}
                value={val ?? ''}
                onChange={(e) => setFeatureValue(def.key, e.target.value)}
              />
            ) : def.controlType === 'color' ? (
              <ColorInput value={val} onChange={(v) => setFeatureValue(def.key, v)} />
            ) : (
              <TextInput value={val} onChange={(v) => setFeatureValue(def.key, v)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}

export default function FeaturesPanel() {
  const features = useDocStore(selectFocusedFeatures);
  const addFeature = useDocStore((s) => s.addFeature);
  const updateFeature = useDocStore((s) => s.updateFeature);
  const removeFeature = useDocStore((s) => s.removeFeature);
  const setFeatureValue = useDocStore((s) => s.setFeatureValue);

  const [selectedKey, setSelectedKey] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const definitions = features?.definitions || {};
  const values = features?.values || {};
  const selectedDef = definitions[selectedKey];

  const handleAdd = () => {
    addFeature({
      key: 'new_feature',
      type: 'string',
      label: 'New Feature',
      default: '',
    });
  };

  // Deselect if deleted
  if (selectedKey && !selectedDef) {
    setSelectedKey(null);
  }

  // Edit view (matches SourcesPanel structure)
  if (selectedDef) {
    return (
      <div className="panel-body" style={{ padding: '16px' }}>
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
          <button className="btn" onClick={() => setSelectedKey(null)}>
            &larr; Back
          </button>
          <div style={{ flex: 1, fontWeight: 'bold', alignSelf: 'center' }}>Edit Feature</div>
          <button
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>

        {confirmDelete && (
          <ConfirmModal
            message="Delete this feature? This action cannot be undone."
            onConfirm={() => {
              removeFeature(selectedKey);
              setSelectedKey(null);
              setConfirmDelete(false);
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        )}

        <FeatureForm
          featureKey={selectedKey}
          definition={selectedDef}
          updateFeature={updateFeature}
        />
      </div>
    );
  }

  // List view (matches SourcesPanel structure)
  return (
    <div className="panel-body" style={{ padding: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h3>Features</h3>
        <button className="btn btn-primary" onClick={handleAdd}>
          + Add
        </button>
      </div>

      <div className="list-group">
        {Object.values(definitions).map((def) => (
          <div
            key={def.key}
            className="list-item"
            onClick={() => setSelectedKey(def.key)}
            style={{
              padding: '8px',
              border: '1px solid var(--c-border)',
              marginBottom: '8px',
              cursor: 'pointer',
              borderRadius: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 'bold' }}>{def.label || def.key}</div>
              <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{def.type}</div>
            </div>
            <div style={{ fontSize: '1.2em' }}>&rsaquo;</div>
          </div>
        ))}
        {Object.keys(definitions).length === 0 && (
          <div style={{ opacity: 0.5, fontStyle: 'italic' }}>No features defined.</div>
        )}
      </div>

      <div
        style={{ marginTop: '24px', borderTop: '1px solid var(--c-border)', paddingTop: '16px' }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '12px' }}>Preview Inputs</div>
        <PreviewInputs
          definitions={definitions}
          values={values}
          setFeatureValue={setFeatureValue}
        />
      </div>
    </div>
  );
}

FeatureForm.propTypes = {
  featureKey: PropTypes.string.isRequired,
  definition: PropTypes.object.isRequired,
  updateFeature: PropTypes.func.isRequired,
};

PreviewInputs.propTypes = {
  definitions: PropTypes.object.isRequired,
  values: PropTypes.object,
  setFeatureValue: PropTypes.func.isRequired,
};
