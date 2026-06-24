import { useState } from 'react';
import { Field, TextInput } from '../components/InspectorFields.jsx';

export default function HaStateSourceFields({ source, sourceId, updateSource, entityCatalogStore }) {
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
              if (friendlyName && (source.name === 'New Entity State' || !source.name)) {
                patch.name = friendlyName;
              }
              updateSource(sourceId, patch);
            }}
            kind="haState"
          />
        </div>
      )}

      {/* Entity ID — secondary input for advanced/manual override */}
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
              placeholder="sensor.living_room_temperature"
            />
          </div>
        )}
      </div>

      <Field label="Attribute (optional)">
        <TextInput
          value={source.attribute || ''}
          onChange={(val) => updateSource(sourceId, { attribute: val })}
          placeholder="unit_of_measurement"
        />
      </Field>
    </>
  );
}
