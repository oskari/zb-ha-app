import { useState } from 'react';
import { Field, TextInput, NumberInput, Dropdown } from '../components/InspectorFields.jsx';

export default function HaCalendarSourceFields({ source, sourceId, updateSource, entityCatalogStore }) {
  const [EntityBrowser, setEntityBrowser] = useState(null);

  if (entityCatalogStore && !EntityBrowser) {
    import('./EntityBrowser.jsx').then((mod) => {
      setEntityBrowser(() => mod.default);
    });
  }

  const [showEntityId, setShowEntityId] = useState(false);

  return (
    <>
      {EntityBrowser && entityCatalogStore && (
        <div style={{ marginBottom: '12px' }}>
          <EntityBrowser
            entityStore={entityCatalogStore}
            selectedEntityId={source.entity_id || ''}
            onSelect={(entityId) => {
              const entity = entityCatalogStore.getState().getEntityById(entityId);
              const friendlyName = entity?.attributes?.friendly_name;
              const patch = { entity_id: entityId };
              if (friendlyName && (source.name === 'New Calendar' || !source.name)) {
                patch.name = friendlyName;
              }
              updateSource(sourceId, patch);
            }}
            kind="haCalendar"
          />
        </div>
      )}

      <div style={{ marginBottom: '8px' }}>
        <button
          className="btn"
          style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', opacity: 0.7 }}
          onClick={() => setShowEntityId((v) => !v)}
        >
          {showEntityId ? '▾ Entity ID' : '▸ Entity ID (advanced)'}
        </button>
        {showEntityId && (
          <div style={{ marginTop: '4px' }}>
            <TextInput
              value={source.entity_id || ''}
              onChange={(val) => updateSource(sourceId, { entity_id: val })}
              placeholder="calendar.family"
            />
          </div>
        )}
      </div>

      <Field label="Days Ahead">
        <NumberInput
          value={source.daysAhead ?? 14}
          onChange={(val) => updateSource(sourceId, { daysAhead: val })}
          min={1}
          max={60}
          step={1}
        />
      </Field>

      <Field label="Max Events">
        <NumberInput
          value={source.maxEvents ?? 5}
          onChange={(val) => updateSource(sourceId, { maxEvents: val })}
          min={1}
          max={20}
          step={1}
        />
      </Field>

      <Field label="Include Ongoing Events">
        <Dropdown
          value={source.includeOngoing === false ? 'false' : 'true'}
          onChange={(val) => updateSource(sourceId, { includeOngoing: val === 'true' })}
          options={[
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]}
        />
      </Field>

      <Field label="Locale">
        <Dropdown
          value={source.locale || 'fi'}
          onChange={(val) => updateSource(sourceId, { locale: val })}
          options={[
            { value: 'fi', label: 'Finnish' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Field>

      <Field label="Show Days Until">
        <Dropdown
          value={source.showDaysUntil === true ? 'true' : 'false'}
          onChange={(val) => updateSource(sourceId, { showDaysUntil: val === 'true' })}
          options={[
            { value: 'false', label: 'No' },
            { value: 'true', label: 'Yes (huomenna / in N days)' },
          ]}
        />
      </Field>

      <Field label="Event Filter">
        <Dropdown
          value={source.eventFilter || 'all'}
          onChange={(val) => updateSource(sourceId, { eventFilter: val })}
          options={[
            { value: 'all', label: 'All events' },
            { value: 'timed', label: 'Timed only' },
            { value: 'all_day', label: 'All-day only' },
          ]}
        />
      </Field>
    </>
  );
}
