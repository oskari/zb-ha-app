/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  EXPORT_VERSION,
  WIDGET_SCHEMA_VERSION,
  buildExportEnvelope,
  collectAssetRefs,
  collectAssetRefsFromImport,
  exportFilename,
  findMissingAssets,
  parseWidgetImportFile,
  sanitizeFilename,
} from '../widgetTransfer.js';
import { CURRENT_SCHEMA_VERSION } from '../../../../src/core/widgetMigrations.ts';

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
      });
    });

    it('parses a bare runtime payload', () => {
      expect(parseWidgetImportFile(JSON.stringify(runtimePayload))).toEqual({
        name: 'Kitchen',
        doc: runtimePayload,
        fullscreen: null,
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
