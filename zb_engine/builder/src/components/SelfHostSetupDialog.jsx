/**
 * SelfHostSetupDialog.jsx — guided Self-Host `/config` push (Postman-style)
 *
 * Reproduces the self-host config form pre-filled with sensible
 * defaults. The user enters the ESP32's LAN IP and presses Send; the config is
 * POSTed to the device THROUGH the add-on backend proxy (`deviceConfigPusher`)
 * — the browser never talks to the device directly. There is no device-port
 * field: the setup server is fixed at :80 server-side.
 *
 * Platform-agnostic (core): the pusher is injected via `uiStore.deviceConfigPusher`
 * (Constraint U10 — core never imports platform/). When it is absent (standalone /
 * non-HA build) Send is disabled with an explanatory note. All feedback is
 * in-component state — no browser dialogs (Constraint U2). The device IP and
 * config are transient dialog state only; they are never written to docStore or
 * any widget payload (Constraint U8).
 */

import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useUiStore } from '../store/uiStore.js';

// Default config pre-fill. The device IP is a SEPARATE field, not part of this JSON. We
// deliberately suggest `sidebar: true` (the device clock/battery/temp column —
// a useful default) even though the device's own default is false; with the
// sidebar on the drawable image area is 720×480, not 800×480.
// `url` starts blank and is auto-filled from the resolved HA host endpoint
// (`http://<ha-ip>:<image-port>/image.bin`) so, by default, the device polls
// this add-on directly — see the auto-fill effect in the component.
const DEFAULT_CONFIG = Object.freeze({
  url: '',
  sleepSec: 900,
  sidebar: true,
  fullRefreshFrequency: 10,
  imperialUnitsEnabled: false,
  tlsInsecure: false,
});

/** The add-on's own per-device image endpoint the device should poll. The bare
 *  `/image.bin` path serves the default device (imageApp.ts: `/default/image.bin
 *  === /image.bin`); `port` is the host port config.yaml maps `8000/tcp` to. */
function deviceImageUrl(ip, port) {
  return ip ? `http://${ip}:${port || 8000}/image.bin` : '';
}

/**
 * Fast-fail client gate: a non-empty, well-formed dotted-quad IPv4 with no
 * leading-zero octets — mirrors the server's ipv4ToInt form check. It does NOT
 * check the private-LAN range: a form-valid public IP leaves Send enabled so the
 * server's assertReachableDeviceIp is the authority that rejects it (a friendly
 * 400 shown via err.message). Leading zeros are rejected here too because the
 * server treats them as an octal ambiguity (010 → 8) and rejects them.
 */
function isFormValidIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip).trim());
  if (!m) return false;
  const parts = m.slice(1);
  if (parts.some((p) => p.length > 1 && p[0] === '0')) return false;
  return parts.every((p) => Number(p) <= 255);
}

export default function SelfHostSetupDialog({ onClose, onContinue }) {
  const pushDeviceConfig = useUiStore((s) => s.deviceConfigPusher);
  // The add-on's own LAN endpoint, resolved once on app init. The image URL is
  // pre-filled with it so, by default, the device fetches from this add-on.
  const hostIp = useUiStore((s) => s.hostIp);
  const hostPort = useUiStore((s) => s.hostPort);

  const [deviceIp, setDeviceIp] = useState('');
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_CONFIG,
    url: deviceImageUrl(hostIp, hostPort),
  }));
  const [urlEdited, setUrlEdited] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | sending | ok | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Per-field "required" errors. Populated ONLY on a Send attempt with an empty
  // required field, and cleared as soon as the user edits that field — so the
  // red text is a response to pressing Send, not a persistent empty-field nag.
  const [fieldErrors, setFieldErrors] = useState({});

  const clearFieldError = (key) =>
    setFieldErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const setCfg = (patch) => setConfig((c) => ({ ...c, ...patch }));
  // Numeric fields drop to `undefined` when cleared; an empty value is flagged
  // on Send (see handleSend). Editing clears any standing error for the field.
  const setNum = (key, raw) => {
    setCfg({ [key]: raw === '' ? undefined : Number(raw) });
    clearFieldError(key);
  };

  // Auto-fill the image URL with the add-on's own endpoint once the host IP
  // resolves (fetched on app init). Never runs after the user edits the field.
  useEffect(() => {
    if (urlEdited) return;
    const u = deviceImageUrl(hostIp, hostPort);
    if (u) setConfig((c) => ({ ...c, url: u }));
  }, [hostIp, hostPort, urlEdited]);

  const ipFormValid = isFormValidIpv4(deviceIp);
  const ipShowHint = deviceIp.trim().length > 0 && !ipFormValid;
  const isHttps = /^https:\/\//i.test(config.url || '');
  const backendAvailable = typeof pushDeviceConfig === 'function';
  // Send stays clickable whenever the backend exists (so pressing it can surface
  // the required-field errors below); the actual gate lives in handleSend.
  const sendDisabled = !backendAvailable || status === 'sending';

  // Preview of the body that WILL be sent (undefined keys are omitted). This is
  // informational only — the server re-serializes the canonical body it forwards.
  const previewJson = JSON.stringify(config, null, 2);

  async function handleSend() {
    if (sendDisabled) return; // backend-missing / double-send guard

    // Required-field check — surface an error under each empty/NaN field.
    const MSG = 'Please enter a value';
    const errs = {};
    if (deviceIp.trim() === '') errs.deviceIp = MSG;
    if (String(config.url ?? '').trim() === '') errs.url = MSG;
    if (config.sleepSec == null || Number.isNaN(config.sleepSec)) errs.sleepSec = MSG;
    if (config.fullRefreshFrequency == null || Number.isNaN(config.fullRefreshFrequency))
      errs.fullRefreshFrequency = MSG;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    // Non-empty but malformed IP: block the doomed request; the inline format
    // hint under the field already explains what's wrong.
    if (!ipFormValid) return;

    setFieldErrors({});
    setStatus('sending');
    setErrorMsg('');
    setResult(null);
    try {
      const res = await pushDeviceConfig({ deviceIp: deviceIp.trim(), config });
      setResult(res);
      setStatus('ok');
    } catch (err) {
      // apiFetch throws typed Errors carrying the proxy's message (400 bad
      // IP/config, 502 device unreachable) — surface it verbatim.
      setErrorMsg(err?.message || 'Failed to send the config.');
      setStatus('error');
    }
  }

  // ok:true + a device status >= 400 means the proxy worked but the DEVICE
  // rejected the config — show that distinctly from a proxy/network failure.
  const deviceRejected = status === 'ok' && result && result.status >= 400;
  const deviceOk = status === 'ok' && result && result.status < 400;

  // Success flips the dialog into "done" mode: the Send button becomes
  // "Continue" (→ builder), the header ✕ mirrors it, "Close" (→ chooser)
  // disappears, and every field locks read-only. A device-rejected 4xx or a
  // proxy/network error is NOT success, so the form stays editable and Send
  // stays available for a retry.
  const locked = deviceOk;
  // Continue hands the sidebar choice up so the new-widget flow can size the
  // canvas (720×480 with sidebar, 800×480 without). Fields are locked once this
  // is reachable, so config.sidebar matches exactly what was sent to the device.
  const handleContinue = () => onContinue(config.sidebar);

  return (
    // No backdrop click-to-close: the dialog is dismissed only via the ✕ or the
    // Close button, so a stray click outside the card can't discard the form.
    <div className="modal-overlay">
      <div
        className="selfhost-modal"
        style={{
          background: 'var(--c-surface)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          width: 'min(560px, 92vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--sp-4) var(--sp-5)',
            borderBottom: '1px solid var(--c-border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Self-host setup</h2>
          {/* Before success ✕ returns to the tile chooser; after success it does
              exactly what Continue does — go to the builder. */}
          <button
            type="button"
            className="btn"
            onClick={locked ? handleContinue : onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          className="field-stack"
          style={{ padding: 'var(--sp-5)', overflowY: 'auto', gap: 'var(--sp-3)' }}
        >
          <p className="settings-hint" style={{ marginBottom: 0 }}>
            Enter your device&apos;s LAN IP and press <strong>Send</strong>. The add-on posts this
            config to the device for you — put the device on its <em>Self-Host Setup</em> screen
            first.
          </p>

          {/* Device IP */}
          <label className="field">
            <span className="field-label">Device IP</span>
            <input
              className={'input' + (locked ? ' input-readonly' : '')}
              type="text"
              inputMode="decimal"
              placeholder="192.168.1.42"
              value={deviceIp}
              readOnly={locked}
              onChange={(e) => {
                setDeviceIp(e.target.value);
                clearFieldError('deviceIp');
              }}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            {(fieldErrors.deviceIp || ipShowHint) && (
              <span className="field-error">
                {fieldErrors.deviceIp || 'Enter a dotted-quad IPv4 (e.g. 192.168.1.42) — no leading zeros.'}
              </span>
            )}
          </label>

          {/* Image URL */}
          <label className="field">
            <span className="field-label">Image URL</span>
            <input
              className={'input' + (locked ? ' input-readonly' : '')}
              type="text"
              placeholder="http://<home-assistant-ip>:8000/image.bin"
              value={config.url}
              readOnly={locked}
              onChange={(e) => {
                setCfg({ url: e.target.value });
                setUrlEdited(true);
                clearFieldError('url');
              }}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            {/* Conditional (not a reserved slot) so the help text below stays
                close to the input; an error just pushes it down when present. */}
            {fieldErrors.url && <span className="field-error">{fieldErrors.url}</span>}
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>
              Where the device fetches its image each wake. The default value is your HA&apos;s IP.
            </span>
          </label>

          <div className="field-row">
            {/* Sleep interval */}
            <label className="field">
              <span className="field-label">Sleep interval (s)</span>
              <input
                className={'input' + (locked ? ' input-readonly' : '')}
                type="number"
                min="5"
                max="86400"
                value={config.sleepSec ?? ''}
                readOnly={locked}
                onChange={(e) => setNum('sleepSec', e.target.value)}
              />
              {fieldErrors.sleepSec && <span className="field-error">{fieldErrors.sleepSec}</span>}
            </label>

            {/* Full-refresh frequency */}
            <label className="field">
              <span className="field-label">Full-refresh every</span>
              <input
                className={'input' + (locked ? ' input-readonly' : '')}
                type="number"
                min="1"
                max="10"
                value={config.fullRefreshFrequency ?? ''}
                readOnly={locked}
                onChange={(e) => setNum('fullRefreshFrequency', e.target.value)}
              />
              {fieldErrors.fullRefreshFrequency && (
                <span className="field-error">{fieldErrors.fullRefreshFrequency}</span>
              )}
            </label>
          </div>

          {/* Toggles — grouped, left-aligned, evenly spaced (checkbox then label). */}
          <div className="selfhost-checks">
            <label className="selfhost-check">
              <input
                type="checkbox"
                checked={!!config.sidebar}
                disabled={locked}
                onChange={(e) => setCfg({ sidebar: e.target.checked })}
              />
              <span>Sidebar column (720×480 drawable area)</span>
            </label>

            <label className="selfhost-check">
              <input
                type="checkbox"
                checked={!!config.imperialUnitsEnabled}
                disabled={locked}
                onChange={(e) => setCfg({ imperialUnitsEnabled: e.target.checked })}
              />
              <span>Imperial units</span>
            </label>

            {isHttps && (
              <label className="selfhost-check">
                <input
                  type="checkbox"
                  checked={!!config.tlsInsecure}
                  disabled={locked}
                  onChange={(e) => setCfg({ tlsInsecure: e.target.checked })}
                />
                <span>Skip TLS verification</span>
              </label>
            )}
          </div>

          {/* Config preview */}
          <label className="field">
            <span className="field-label">Config preview</span>
            <textarea
              className="textarea input-readonly"
              value={previewJson}
              readOnly
              rows={7}
              onFocus={(e) => e.target.select()}
            />
          </label>

          {/* Feedback */}
          {!backendAvailable && (
            <p className="settings-hint" style={{ marginBottom: 0 }}>
              Device push is only available inside the Home Assistant add-on.
            </p>
          )}
          {deviceOk && (
            <div
              style={{
                padding: 'var(--sp-2) var(--sp-3)',
                background: 'var(--c-bg-subtle)',
                color: 'var(--c-text)',
                borderRadius: 'var(--radius)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {result.configured ? 'Device configured ✓' : 'Sent ✓'} (device replied HTTP{' '}
              {result.status}).
            </div>
          )}
          {deviceRejected && (
            <div
              role="alert"
              style={{
                padding: 'var(--sp-2) var(--sp-3)',
                background: 'var(--c-bg-warning-subtle)',
                color: 'var(--c-warning-text)',
                borderRadius: 'var(--radius)',
                fontSize: 'var(--text-sm)',
              }}
            >
              The device rejected the config (HTTP {result.status}). Check the values and try again.
            </div>
          )}
          {status === 'error' && errorMsg && (
            <div
              role="alert"
              style={{
                padding: 'var(--sp-2) var(--sp-3)',
                background: 'var(--c-danger-bg)',
                color: 'var(--c-danger)',
                borderRadius: 'var(--radius)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            justifyContent: 'flex-end',
            padding: 'var(--sp-3) var(--sp-5)',
            borderTop: '1px solid var(--c-border)',
          }}
        >
          {/* Before success: Close returns to the chooser. After success it
              disappears — the only ways out are Continue and the ✕ (both → builder). */}
          {!locked && (
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          )}
          {locked ? (
            <button type="button" className="btn btn-primary" onClick={handleContinue}>
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={sendDisabled}
            >
              {status === 'sending' ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

SelfHostSetupDialog.propTypes = {
  // Before success — dismiss the dialog back to the tile chooser (✕ / Close).
  onClose: PropTypes.func.isRequired,
  // After a successful send — go to the builder (Continue / ✕). Receives the
  // sidebar boolean so the new-widget flow can size the canvas.
  onContinue: PropTypes.func.isRequired,
};
