/**
 * SettingsPanel.jsx — Display & canvas settings
 *
 * Two independent size controls:
 *   • Widget Size  — the primary widget's screen (full / side panel)
 *   • Display Mode — the fullscreen companion's screen (full / side panel /
 *                    custom)
 * They are decoupled: changing one re-derives only that view's canvas size for
 * the current grid; the other is never touched.
 *
 * This component is platform-agnostic (core).
 */

import { useState, useEffect } from 'react';
import { useDisplayConfigStore, DISPLAY_PRESETS } from '../store/displayConfigStore.js';
import { useDocStore } from '../store/docStore.js';
import DeviceEndpointSettings from './DeviceEndpointSettings.jsx';
import SetupModeScreen from '../components/SetupModeScreen.jsx';

export default function SettingsPanel() {
  const [showSetup, setShowSetup] = useState(false);
  const [engineVersion, setEngineVersion] = useState(null);
  const displayMode = useDisplayConfigStore((s) => s.displayMode);
  const setDisplayMode = useDisplayConfigStore((s) => s.setDisplayMode);
  const widgetMode = useDisplayConfigStore((s) => s.widgetMode);
  const setWidgetMode = useDisplayConfigStore((s) => s.setWidgetMode);
  const customWidth = useDisplayConfigStore((s) => s.customWidth);
  const customHeight = useDisplayConfigStore((s) => s.customHeight);
  const setCustomSize = useDisplayConfigStore((s) => s.setCustomSize);
  const refreshCompanionSizes = useDocStore((s) => s.refreshCompanionSizes);
  const refreshPrimarySizes = useDocStore((s) => s.refreshPrimarySizes);

  // Widget Size sizes ONLY the primary widget(s). Re-derive every open primary
  // doc (focused or not) for the new screen and mark it dirty so auto-save
  // persists it. The fullscreen companion is intentionally left untouched.
  const handleWidgetModeChange = (mode) => {
    setWidgetMode(mode);
    queueMicrotask(() => { refreshPrimarySizes(); });
  };

  // Display Mode sizes ONLY the fullscreen companion. Re-derive every open
  // companion (focused or not) for the new screen and mark it dirty so
  // auto-save persists it. The primary widget is intentionally left untouched.
  // Microtask so the display store state is committed before we read it back.
  const handleModeChange = (mode) => {
    setDisplayMode(mode);
    queueMicrotask(() => { refreshCompanionSizes(); });
  };

  const handleCustomWidthChange = (e) => {
    const val = Number(e.target.value);
    if (!Number.isFinite(val)) return;
    setCustomSize(val, customHeight);
    queueMicrotask(() => { refreshCompanionSizes(); });
  };

  const handleCustomHeightChange = (e) => {
    const val = Number(e.target.value);
    if (!Number.isFinite(val)) return;
    setCustomSize(customWidth, val);
    queueMicrotask(() => { refreshCompanionSizes(); });
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.version) return;
        const parts = [data.version];
        if (data.build?.commit) parts.push(data.build.commit);
        setEngineVersion(parts.join(' · '));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="panel-body">
      <div className="field-stack">
        {/* ── Widget Size (primary) ── */}
        <label className="field">
          <span className="field-label">Widget Size</span>
          <select
            className="select"
            value={widgetMode}
            onChange={(e) => handleWidgetModeChange(e.target.value)}
          >
            <option value="panel">
              With Side Panel ({DISPLAY_PRESETS.panel.width}×{DISPLAY_PRESETS.panel.height})
            </option>
            <option value="full">
              Full Screen ({DISPLAY_PRESETS.full.width}×{DISPLAY_PRESETS.full.height})
            </option>
          </select>
        </label>

        {/* ── Display Mode (fullscreen companion) ── */}
        <label className="field">
          <span className="field-label">Fullscreen Companion</span>
          <select
            className="select"
            value={displayMode}
            onChange={(e) => handleModeChange(e.target.value)}
          >
            <option value="panel">
              With Side Panel ({DISPLAY_PRESETS.panel.width}×{DISPLAY_PRESETS.panel.height})
            </option>
            <option value="full">
              Full Screen ({DISPLAY_PRESETS.full.width}×{DISPLAY_PRESETS.full.height})
            </option>
            <option value="custom">Custom Size</option>
          </select>
        </label>

        <p className="settings-hint">
          <strong>Widget Size</strong> and <strong>Fullscreen Companion</strong> are independent —
          changing one never resizes the other.
          <br />
          <strong>With Side Panel</strong> — standard HA deployment; 80&nbsp;px is reserved for the
          sidebar, leaving 720×480 (default).
          <br />
          <strong>Full Screen</strong> — uses the entire 800×480 display
          (e.g.&nbsp;localhost testing without the HA sidebar).
        </p>

        {/* ── Custom Size (advanced) ── */}
        {displayMode === 'custom' && (
          <>
            <label className="field">
              <span className="field-label">Width (px)</span>
              <input
                className="input"
                type="number"
                min="1"
                max="4096"
                value={customWidth}
                onChange={handleCustomWidthChange}
              />
            </label>
            <label className="field">
              <span className="field-label">Height (px)</span>
              <input
                className="input"
                type="number"
                min="1"
                max="4096"
                value={customHeight}
                onChange={handleCustomHeightChange}
              />
            </label>
          </>
        )}

        {/* ── ESP32 device endpoint (auto-detected host IP) ── */}
        <DeviceEndpointSettings />

        {/* ── Device setup (re-open the two-tile "How do you want to set up?" flow) ── */}
        <div
          className="field-stack"
          style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--c-border)' }}
        >
          <span className="field-label">Device setup</span>
          <p className="settings-hint">
            Re-open the setup guide to connect a device or send a self-host config to an ESP32 on
            your network.
          </p>
          <button type="button" className="btn" onClick={() => setShowSetup(true)}>
            Set up a device / send config…
          </button>
        </div>

        {engineVersion && (
          <p
            className="settings-hint"
            style={{ marginTop: '24px', marginBottom: 0, opacity: 0.7 }}
          >
            Engine {engineVersion}
          </p>
        )}
      </div>

      {/* Embedded two-tile setup modal. We're already in the editor, so nothing
          navigates the canvas: the App-guide OK returns to the two tiles, and
          the ✕ / backdrop / Self-host Close (onContinue) dismiss the modal. */}
      {showSetup && (
        <SetupModeScreen embedded onContinue={() => setShowSetup(false)} />
      )}
    </div>
  );
}
