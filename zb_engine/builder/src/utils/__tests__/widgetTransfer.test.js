/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  EXPORT_VERSION,
  buildExportEnvelope,
  collectAssetRefs,
  collectAssetRefsFromImport,
  exportFilename,
  findMissingAssets,
  parseWidgetImportFile,
  sanitizeFilename,
} from '../widgetTransfer.js';

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
