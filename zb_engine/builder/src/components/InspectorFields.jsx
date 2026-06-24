import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

export function Field({ label, children, row = false }) {
  return (
    <div className={`field ${row ? 'field-row-item' : ''}`}>
      {label && <label className="field-label">{label}</label>}
      {children}
    </div>
  );
}

Field.propTypes = {
  label: PropTypes.string,
  children: PropTypes.node,
  row: PropTypes.bool,
};

export function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      className="input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

TextInput.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
};

function clampNumber(n, min, max) {
  let result = n;
  if (typeof min === 'number') result = Math.max(min, result);
  if (typeof max === 'number') result = Math.min(max, result);
  return result;
}

/**
 * Buffered numeric-input behavior for native <input type="number">.
 *
 * The field keeps a local string buffer so it can be visibly empty while the
 * user is editing (clearing it no longer snaps to 0 or the default). Rules:
 *  - While focused, the input shows exactly what's typed (including '' / '-' / '1.').
 *  - Only a finite parsed number is ever pushed to onChange; empty and
 *    intermediate states emit nothing, so the model never receives 0/NaN/null
 *    from an in-progress edit (which would break downstream consumers).
 *  - On blur: an empty/garbage buffer reverts to the prior value; a valid
 *    number is clamped to [min, max] and committed.
 *  - Native spinner arrows still work — they fire onChange like any keystroke.
 */
function useNumberField({ value, onChange, min, max }) {
  const [buffer, setBuffer] = useState('');
  const [focused, setFocused] = useState(false);

  const fromValue = () => (value === null || value === undefined ? '' : String(value));

  // Re-sync the buffer from the model only while NOT actively editing, so
  // external updates (undo/redo, selection change, data binding) are reflected
  // without clobbering whatever the user is currently typing.
  useEffect(() => {
    if (!focused) setBuffer(fromValue());
  }, [value, focused]);

  const handleChange = (e) => {
    const raw = e.target.value;
    setBuffer(raw);
    if (raw.trim() === '') return; // keep prior value while the field is empty
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };

  const handleBlur = (e) => {
    setFocused(false);
    const raw = e.target.value.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) {
      setBuffer(fromValue()); // revert to prior value
      return;
    }
    const clamped = clampNumber(n, min, max);
    if (clamped !== value) onChange(clamped);
    setBuffer(String(clamped));
  };

  return {
    value: buffer,
    onChange: handleChange,
    onFocus: () => setFocused(true),
    onBlur: handleBlur,
  };
}

export function NumberInput({ value, onChange, min, max, step = 1 }) {
  const field = useNumberField({ value, onChange, min, max });
  return (
    <input
      type="number"
      className="input"
      value={field.value}
      onChange={field.onChange}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
      min={min}
      max={max}
      step={step}
    />
  );
}

NumberInput.propTypes = {
  value: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
};

export function Slider({ value, onChange, min = 0, max = 100, step = 1 }) {
  const field = useNumberField({ value, onChange, min, max });
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <input
        type="range"
        value={value ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        style={{ flex: 1 }}
      />
      <input
        type="number"
        className="input"
        style={{ width: '60px' }}
        value={field.value}
        onChange={field.onChange}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

Slider.propTypes = {
  value: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
};

export function Toggle({ label, value, onChange, disabled = false, onDisabledClick, title }) {
  return (
    <label
      className="field-label"
      style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
      title={title}
    >
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => {
          if (disabled) {
            onDisabledClick?.();
            return;
          }
          onChange(e.target.checked);
        }}
      />
      {label}
    </label>
  );
}

Toggle.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  onDisabledClick: PropTypes.func,
  title: PropTypes.string,
};

export function Dropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const [focusIdx, setFocusIdx] = useState(-1);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[focusIdx];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        const curIdx = options.findIndex((o) => o.value === value);
        setFocusIdx(curIdx >= 0 ? curIdx : 0);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (focusIdx >= 0 && focusIdx < options.length) {
        onChange(options[focusIdx].value);
      }
      setOpen(false);
    }
  };

  return (
    <div className="custom-select" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown}>
      <div
        className="custom-select-trigger input"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            const curIdx = options.findIndex((o) => o.value === value);
            setFocusIdx(curIdx >= 0 ? curIdx : 0);
          }
        }}
      >
        <span className="custom-select-label">{selectedLabel}</span>
        <span className="custom-select-arrow">▾</span>
      </div>
      {open && (
        <div className="custom-select-list" ref={listRef}>
          {options.map((opt, i) => (
            <div
              key={opt.value}
              className={
                'custom-select-option' +
                (opt.value === value ? ' active' : '') +
                (i === focusIdx ? ' focused' : '')
              }
              onMouseEnter={() => setFocusIdx(i)}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

Dropdown.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
};

export function ColorInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <input
        type="color"
        value={value ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        style={{ height: '30px', width: '40px', padding: 0, border: 'none' }}
      />
      <input
        type="text"
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1 }}
      />
    </div>
  );
}

ColorInput.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

export function ArrayEditor({ value, onChange }) {
  // value is array of numbers, e.g. [4, 4]
  const [text, setText] = useState('');

  useEffect(() => {
    // Intentional: syncing prop → local state for controlled input
    setText((value ?? []).join(', '));
  }, [value]);

  const handleBlur = () => {
    const parts = text
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n));
    onChange(parts);
    // Optional: re-format text
    setText(parts.join(', '));
  };

  return (
    <input
      type="text"
      className="input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          handleBlur();
          e.target.blur();
        }
      }}
      placeholder="e.g. 4, 4"
    />
  );
}

export function PointsEditor({ value, onChange }) {
  // value is array of [x, y] arrays
  const [text, setText] = useState('');

  useEffect(() => {
    if (!Array.isArray(value)) {
      // Intentional: syncing prop → local state for controlled input
      setText('');
      return;
    }
    // Format as "x,y  x,y"
    const str = value.map((pt) => (Array.isArray(pt) ? pt.join(',') : '0,0')).join('  ');
    setText(str);
  }, [value]);

  const handleBlur = () => {
    // Parse "x,y x,y" or "x,y; x,y"
    const rawPoints = text.split(/\s+|;/).filter((s) => s.trim());
    const points = rawPoints
      .map((s) => {
        const parts = s.split(',').map((n) => parseFloat(n));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return parts;
        }
        return null;
      })
      .filter(Boolean);

    onChange(points);
  };

  return (
    <textarea
      className="input"
      rows={3}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      placeholder="0,0  100,0"
      style={{ fontFamily: 'monospace', fontSize: '0.9em' }}
    />
  );
}

PointsEditor.propTypes = {
  value: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
  onChange: PropTypes.func.isRequired,
};

ArrayEditor.propTypes = {
  value: PropTypes.arrayOf(PropTypes.number),
  onChange: PropTypes.func.isRequired,
};

export function KeyValueEditor({ value, onChange }) {
  const entries = Object.entries(value || {});

  const update = (newEntries) => {
    const obj = {};
    newEntries.forEach(([k, v]) => {
      obj[k] = v;
    });
    onChange(obj);
  };

  const handleChange = (idx, newKey, newVal) => {
    const newEntries = [...entries];
    newEntries[idx] = [newKey, newVal];
    update(newEntries);
  };

  const handleAdd = () => {
    const newEntries = [...entries, ['', '']];
    update(newEntries);
  };

  const handleRemove = (idx) => {
    const newEntries = [...entries];
    newEntries.splice(idx, 1);
    update(newEntries);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {entries.map(([k, v], idx) => (
        <div key={idx} style={{ display: 'flex', gap: '4px' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={k}
            onChange={(e) => handleChange(idx, e.target.value, v)}
            placeholder="Key"
          />
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={v}
            onChange={(e) => handleChange(idx, k, e.target.value)}
            placeholder="Value"
          />
          <button
            className="btn"
            style={{ padding: '0 8px', color: 'var(--c-danger)' }}
            onClick={() => handleRemove(idx)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={handleAdd} style={{ alignSelf: 'flex-start' }}>
        + Add Item
      </button>
    </div>
  );
}

KeyValueEditor.propTypes = {
  value: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};
