/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  EXPORT_VERSION,
  WIDGET_SCHEMA_VERSION,
  SECRET_SENTINEL,
  SENSITIVE_HEADER_NAME_RE,
  buildExportEnvelope,
  countSourcesNeedingCredentials,
  credentialsNotice,
  collectAssetRefs,
  collectAssetRefsFromImport,
  exportFilename,
  findMissingAssets,
  parseWidgetImportFile,
  sanitizeFilename,
} from '../widgetTransfer.js';
import { CURRENT_SCHEMA_VERSION } from '../../../../src/core/widgetMigrations.ts';
import {
  SECRET_SENTINEL as SERVER_SECRET_SENTINEL,
  SENSITIVE_HEADER_NAME_RE as SERVER_SENSITIVE_HEADER_NAME_RE,
} from '../../../../src/core/sourceSecrets.ts';

const runtimePayload = {
  misc: { name: 'Kitchen', gridSize: '1x1', size: { width: 240, height: 240 } },
  features: {},
  sources: [],
  elements: [
    { type: 'img', src: 'asset:abc.png' },
    {
      type: 'group',
      children: [{ type: 'svg', src: 'asset:icon.svg' }],
    },
  ],
};

describe('widgetTransfer', () => {
  it('WIDGET_SCHEMA_VERSION mirrors the server CURRENT_SCHEMA_VERSION', () => {
    expect(WIDGET_SCHEMA_VERSION).toBe(CURRENT_SCHEMA_VERSION);
  });

  describe('sanitizeFilename', () => {
    it('removes unsafe characters and collapses spaces', () => {
      expect(sanitizeFilename('Kitchen / Display!')).toBe('Kitchen-Display');
    });

    it('falls back to widget for empty input', () => {
      expect(sanitizeFilename('   ')).toBe('widget');
    });
  });

  describe('exportFilename', () => {
    it('prefixes the sanitized widget name', () => {
      expect(exportFilename('My Widget')).toBe('zerrybit-widget-My-Widget.json');
    });
  });

  describe('buildExportEnvelope', () => {
    it('wraps a save payload in export version 1', () => {
      const envelope = buildExportEnvelope(
        { runtimeJson: runtimePayload, fullscreenJson: null },
        'Kitchen',
      );

      expect(envelope.exportVersion).toBe(EXPORT_VERSION);
      expect(envelope.schemaVersion).toBe(WIDGET_SCHEMA_VERSION);
      expect(envelope.name).toBe('Kitchen');
      expect(envelope.doc).toEqual(runtimePayload);
      expect(envelope.fullscreen).toBeNull();
      expect(typeof envelope.exportedAt).toBe('number');
    });

    it('throws when save payload is missing', () => {
      expect(() => buildExportEnvelope(null, 'Kitchen')).toThrow(/No widget document/);
    });
  });

  describe('parseWidgetImportFile', () => {
    it('parses export envelope v1', () => {
      const envelope = {
        exportVersion: EXPORT_VERSION,
        name: 'Imported',
        doc: runtimePayload,
        fullscreen: null,
      };

      expect(parseWidgetImportFile(JSON.stringify(envelope))).toEqual({
        name: 'Imported',
        doc: runtimePayload,
        fullscreen: null,
        credentialSourceCount: 0,
      });
    });

    it('parses a bare runtime payload', () => {
      expect(parseWidgetImportFile(JSON.stringify(runtimePayload))).toEqual({
        name: 'Kitchen',
        doc: runtimePayload,
        fullscreen: null,
        credentialSourceCount: 0,
      });
    });

    it('accepts export envelopes from before schemaVersion existed', () => {
      const envelope = { exportVersion: EXPORT_VERSION, name: 'Old', doc: runtimePayload };
      expect(parseWidgetImportFile(JSON.stringify(envelope)).doc).toEqual(runtimePayload);
    });

    it('accepts export envelopes at an older or current schemaVersion', () => {
      for (const schemaVersion of [0, WIDGET_SCHEMA_VERSION]) {
        const envelope = { exportVersion: EXPORT_VERSION, schemaVersion, name: 'X', doc: runtimePayload };
        expect(parseWidgetImportFile(JSON.stringify(envelope)).name).toBe('X');
      }
    });

    it('refuses files from a newer schemaVersion', () => {
      const envelope = {
        exportVersion: EXPORT_VERSION,
        schemaVersion: WIDGET_SCHEMA_VERSION + 1,
        doc: runtimePayload,
      };
      expect(() => parseWidgetImportFile(JSON.stringify(envelope))).toThrow(/schema version/);
    });

    it('refuses unknown export versions', () => {
      const envelope = { exportVersion: EXPORT_VERSION + 1, doc: runtimePayload };
      expect(() => parseWidgetImportFile(JSON.stringify(envelope))).toThrow(/export version/);
    });

    it('parses a stored widget envelope and drops server-managed fields', () => {
      const stored = {
        id: 'w_abc',
        name: 'Stored',
        updatedAt: 123,
        schemaVersion: 1,
        pairingId: 123456789,
        doc: runtimePayload,
        fullscreen: runtimePayload,
      };
      expect(parseWidgetImportFile(JSON.stringify(stored))).toEqual({
        name: 'Stored',
        doc: runtimePayload,
        fullscreen: runtimePayload,
        credentialSourceCount: 0,
      });
    });

    it('parses a pre-versioning stored envelope', () => {
      const stored = { id: 'w_old', name: '', doc: runtimePayload };
      expect(parseWidgetImportFile(JSON.stringify(stored)).name).toBe('Kitchen');
    });

    it('refuses a stored envelope from a newer schemaVersion', () => {
      const stored = { id: 'w', schemaVersion: WIDGET_SCHEMA_VERSION + 1, doc: runtimePayload };
      expect(() => parseWidgetImportFile(JSON.stringify(stored))).toThrow(/schema version/);
    });

    it('rejects invalid JSON', () => {
      expect(() => parseWidgetImportFile('{')).toThrow(/Invalid JSON/);
    });

    it('rejects unrecognized formats', () => {
      expect(() => parseWidgetImportFile('{"foo":1}')).toThrow(/Unrecognized widget file/);
    });

    it('rejects payloads missing required arrays', () => {
      expect(() => parseWidgetImportFile(JSON.stringify({ misc: {} }))).toThrow(/Unrecognized/);
    });
  });

  describe('collectAssetRefs', () => {
    it('collects asset tokens from nested groups', () => {
      expect(collectAssetRefs(runtimePayload)).toEqual(['abc.png', 'icon.svg']);
    });
  });

  describe('collectAssetRefsFromImport', () => {
    it('includes fullscreen slot references', () => {
      const parsed = {
        doc: { elements: [{ type: 'img', src: 'asset:primary.png' }] },
        fullscreen: { elements: [{ type: 'img', src: 'asset:full.png' }] },
      };

      expect(collectAssetRefsFromImport(parsed)).toEqual(['full.png', 'primary.png']);
    });
  });

  describe('findMissingAssets', () => {
    it('returns filenames not present on the server', () => {
      expect(findMissingAssets(['a.png', 'b.png'], ['a.png'])).toEqual(['b.png']);
    });
  });
});

describe('source secret sentinels', () => {
  const securedPayload = () => ({
    misc: { name: 'Secure', gridSize: '1x1', size: { width: 240, height: 240 } },
    features: {},
    elements: [],
    sources: [
      { id: 'bearer_src', kind: 'http', auth: { type: 'bearer', bearer: SECRET_SENTINEL } },
      {
        id: 'key_src',
        kind: 'http',
        auth: { type: 'apiKey', apiKey: { in: 'header', name: 'X-Key', value: SECRET_SENTINEL } },
      },
      {
        id: 'basic_src',
        kind: 'http',
        auth: { type: 'basic', basic: { username: 'me', password: SECRET_SENTINEL } },
        headers: { 'X-Api-Token': SECRET_SENTINEL, Accept: 'application/json' },
      },
      { id: 'open_src', kind: 'http', auth: { type: 'none' } },
    ],
  });

  it('mirrors the server sentinel and header pattern', () => {
    expect(SECRET_SENTINEL).toBe(SERVER_SECRET_SENTINEL);
    expect(SENSITIVE_HEADER_NAME_RE.source).toBe(SERVER_SENSITIVE_HEADER_NAME_RE.source);
  });

  it('blanks sentinels on export without mutating the editor payload', () => {
    const payload = securedPayload();
    const envelope = buildExportEnvelope(
      { runtimeJson: payload, fullscreenJson: securedPayload() },
      'Secure',
    );
    const json = JSON.stringify(envelope);
    expect(json).not.toContain(SECRET_SENTINEL);
    const [bearer, key, basic] = envelope.doc.sources;
    expect(bearer.auth.bearer).toBe('');
    expect(key.auth.apiKey).toEqual({ in: 'header', name: 'X-Key', value: '' });
    expect(basic.auth.basic).toEqual({ username: 'me', password: '' });
    expect(basic.headers).toEqual({ 'X-Api-Token': '', Accept: 'application/json' });
    expect(payload.sources[0].auth.bearer).toBe(SECRET_SENTINEL);
  });

  it('strips sentinels from imported files and counts sources needing credentials', () => {
    const legacyExport = {
      exportVersion: EXPORT_VERSION,
      name: 'Secure',
      doc: securedPayload(),
      fullscreen: null,
    };
    const parsed = parseWidgetImportFile(JSON.stringify(legacyExport));
    expect(JSON.stringify(parsed.doc)).not.toContain(SECRET_SENTINEL);
    expect(parsed.credentialSourceCount).toBe(3);
  });

  it('counts blanked credentials in files exported after the fix', () => {
    const envelope = buildExportEnvelope({ runtimeJson: securedPayload(), fullscreenJson: null }, 'S');
    const parsed = parseWidgetImportFile(JSON.stringify(envelope));
    expect(parsed.credentialSourceCount).toBe(3);
  });

  it('reports zero for payloads without credentials', () => {
    const parsed = parseWidgetImportFile(JSON.stringify(runtimePayload));
    expect(parsed.credentialSourceCount).toBe(0);
    expect(credentialsNotice(0)).toBeNull();
  });

  it('builds a notice naming the number of sources', () => {
    expect(credentialsNotice(1).message).toMatch(/^1 data source needs its credentials/);
    expect(credentialsNotice(3).message).toMatch(/^3 data sources need their credentials/);
    expect(countSourcesNeedingCredentials(securedPayload())).toBe(3);
  });
});
