/**
 * DeviceEndpointSettings.jsx — ESP32 device endpoint info (Settings tab)
 *
 * Shows the Home Assistant host's LAN IP and the ready-to-use image URLs an
 * ESP32 e-ink device should poll. Device firmware usually cannot resolve the
 * "homeassistant.local" mDNS name, so it needs the numeric
 * "http://<ip>:8000/image.bin" form — this surfaces and copies that for you.
 *
 * Core / platform-agnostic: the host-IP lookup is injected via
 * `uiStore.hostInfoProvider` (mirrors sourceTestHandler / previewRenderer), so
 * this component never imports the HA platform layer. When no provider is
 * registered (standalone / non-HA build) it falls back to a manual-entry hint
 * with the `<HA_IP>` URL template.
 */

import { useEffect, useState } from 'react';
import { useUiStore } from '../store/uiStore.js';

// Default ESP32 image host port (config.yaml `ports: 8000/tcp`). Used as a
// fallback when the Supervisor-reported host-port mapping is unavailable; the
// live mapped port (when known) is provided by the host-info provider.
const IMAGE_PORT = 8000;
const IMAGE_PATHS = [
  { file: 'image.bin', label: '1-bit binary (ESP32)' },
  { file: 'image.png', label: 'PNG preview' },
];
const IP_PLACEHOLDER = '<HA_IP>';

function buildUrl(ip, port, file) {
  return `http://${ip || IP_PLACEHOLDER}:${port || IMAGE_PORT}/${file}`;
}

/**
 * Copy text to the clipboard. Falls back to a hidden-textarea + execCommand
 * because Home Assistant is commonly served over plain http on the LAN, where
 * the async Clipboard API is unavailable (it requires a secure context).
 */
function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  fallbackCopy(text);
  return Promise.resolve();
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    /* ignore — the field is still selectable for manual copy */
  }
}

export default function DeviceEndpointSettings() {
  const hostInfoProvider = useUiStore((s) => s.hostInfoProvider);

  const [status, setStatus] = useState('idle'); // idle | loading | ok | error
  const [candidates, setCandidates] = useState([]);
  const [selectedIp, setSelectedIp] = useState(null);
  const [port, setPort] = useState(null);
  const [copiedFile, setCopiedFile] = useState(null);

  useEffect(() => {
    // No provider → standalone / non-HA build. Render the manual-entry hint.
    if (!hostInfoProvider) {
      setStatus('idle');
      return undefined;
    }

    let cancelled = false;
    setStatus('loading');
    Promise.resolve(hostInfoProvider())
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.candidates) ? res.candidates : [];
        setCandidates(list);
        setSelectedIp(res?.ip ?? list[0]?.ip ?? null);
        setPort(res?.port ?? null);
        setStatus('ok');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [hostInfoProvider]);

  const handleCopy = (file, url) => {
    copyText(url);
    setCopiedFile(file);
    setTimeout(() => setCopiedFile((current) => (current === file ? null : current)), 1500);
  };

  // ── Status line above the URLs ──
  let statusNode = null;
  if (status === 'loading') {
    statusNode = <p className="settings-hint">Detecting Home Assistant IP…</p>;
  } else if (status === 'ok' && selectedIp) {
    statusNode = (
      <p className="settings-hint">
        Point your ESP32 firmware at the URL below. Devices that cannot resolve{' '}
        <code>homeassistant.local</code> need this numeric IP.
      </p>
    );
  } else if (status === 'idle') {
    statusNode = (
      <p className="settings-hint">
        Running outside Home Assistant — replace <code>{IP_PLACEHOLDER}</code> with your HA
        host&apos;s LAN IP address.
      </p>
    );
  } else {
    // 'error', or 'ok' but no LAN interface was found.
    statusNode = (
      <p className="settings-hint">
        Couldn&apos;t detect the IP automatically. Replace <code>{IP_PLACEHOLDER}</code> with your
        Home Assistant host&apos;s LAN IP address.
      </p>
    );
  }

  return (
    <div
      className="field-stack"
      style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--c-border)' }}
    >
      <span className="field-label">Home Assistant IP</span>
      {statusNode}

      {/* Interface picker — only when the host exposes more than one LAN IP
          (e.g. Ethernet + Wi-Fi, or a VLAN). Lets the user choose the right one. */}
      {candidates.length > 1 && (
        <label className="field">
          <span className="field-label">Host interface</span>
          <select
            className="select"
            value={selectedIp ?? ''}
            onChange={(e) => setSelectedIp(e.target.value)}
          >
            {candidates.map((c) => (
              <option key={`${c.interface}-${c.ip}`} value={c.ip}>
                {c.interface} — {c.ip}
                {c.primary ? ' (primary)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {IMAGE_PATHS.map(({ file, label }) => {
        const url = buildUrl(selectedIp, port, file);
        return (
          <label className="field" key={file}>
            <span className="field-label">{label}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                className="input input-readonly"
                value={url}
                readOnly
                onFocus={(e) => e.target.select()}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => handleCopy(file, url)}
                title="Copy URL"
              >
                {copiedFile === file ? 'Copied' : 'Copy'}
              </button>
            </div>
          </label>
        );
      })}
    </div>
  );
}
