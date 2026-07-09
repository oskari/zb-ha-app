/**
 * CalendarListInspectorPanel.jsx — Inspector for calendarList elements
 */

import PropTypes from 'prop-types';
import {
  Dropdown,
  Field,
  NumberInput,
  Slider,
  TextInput,
  Toggle,
} from '../components/InspectorFields.jsx';
import { useDocStore, selectFocusedSources } from '../store/docStore.js';

export default function CalendarListInspectorPanel({ element, updateElement }) {
  const sources = useDocStore((s) => selectFocusedSources(s));
  const calendarSources = sources.filter((s) => s.kind === 'haCalendar');

  const sourceOptions = [
    { value: '', label: '(select source)' },
    ...calendarSources.map((s) => ({
      value: s.id,
      label: s.name ? `${s.name} (${s.id})` : s.id,
    })),
  ];

  return (
    <div className="field-stack">
      <Field label="Calendar Source">
        <Dropdown
          value={element.sourceId || ''}
          onChange={(val) => updateElement(element.id, { sourceId: val })}
          options={sourceOptions}
        />
      </Field>

      <Field label="Max Lines">
        <NumberInput
          value={element.maxLines ?? 5}
          onChange={(val) => {
            const lineHeight = element.lineHeight ?? 36;
            updateElement(element.id, {
              maxLines: val,
              sizeY: lineHeight * val,
            });
          }}
          min={1}
          max={20}
          step={1}
        />
      </Field>

      <Field label="Line Height">
        <NumberInput
          value={element.lineHeight ?? 36}
          onChange={(val) => {
            const maxLines = element.maxLines ?? 5;
            updateElement(element.id, {
              lineHeight: val,
              sizeY: val * maxLines,
            });
          }}
          min={8}
          max={120}
          step={1}
        />
      </Field>

      <Field label="Font Size">
        <NumberInput
          value={element.fontSize ?? 16}
          onChange={(val) => updateElement(element.id, { fontSize: val })}
          min={6}
          max={72}
          step={1}
        />
      </Field>

      <Field label="Font Weight">
        <NumberInput
          value={element.fontWeight ?? 400}
          onChange={(val) => updateElement(element.id, { fontWeight: val })}
          min={100}
          max={900}
          step={100}
        />
      </Field>

      <Field label="Empty Text">
        <TextInput
          value={element.emptyText ?? 'Ei tulevia tapahtumia'}
          onChange={(val) => updateElement(element.id, { emptyText: val })}
        />
      </Field>

      <Field label="Text Fill" row>
        <Toggle
          label="Enable Fill"
          value={element.enableFill !== false}
          onChange={(val) => updateElement(element.id, { enableFill: val })}
        />
      </Field>

      {element.enableFill !== false && (
        <Field label="Fill Dither (0-100)">
          <Slider
            value={element.fill ?? 100}
            onChange={(val) => updateElement(element.id, { fill: val })}
            min={0}
            max={100}
          />
        </Field>
      )}
    </div>
  );
}

CalendarListInspectorPanel.propTypes = {
  element: PropTypes.object.isRequired,
  updateElement: PropTypes.func.isRequired,
};
