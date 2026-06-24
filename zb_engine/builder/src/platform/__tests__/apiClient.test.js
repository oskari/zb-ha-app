/**
 * apiClient.test.js — builder-side API response validation tests.
 *
 * Phase 2 verifies that selected platform API responses are validated with a
 * single shared pattern and malformed data becomes recoverable promise errors.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assetRawUrl,
  getPreviewImageUrl,
  listWidgets,
  newWidgetId,
  listAssets,
  testSource,
  readValidatedJson,
} from '../apiClient.js';
import { z } from 'zod';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('apiClient response validation', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/builder/');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('validates widget-list responses and keeps endpoint URLs relative', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([
      { id: 'widget_abc_123', name: 'Weather', updatedAt: 123 },
    ]));

    const widgets = await listWidgets();

    expect(widgets).toEqual([{ id: 'widget_abc_123', name: 'Weather', updatedAt: 123 }]);
    expect(fetch).toHaveBeenCalledWith('../api/widgets', expect.objectContaining({
      credentials: 'same-origin',
    }));
  });

  it('rejects malformed widget-list responses', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([{ id: '../escape', name: 'Bad' }]));

    await expect(listWidgets()).rejects.toThrow('Invalid widget list response from server.');
  });

  it('validates new-widget-id responses', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ id: 'widget_aabbccdd_eeff00' }));

    await expect(newWidgetId()).resolves.toBe('widget_aabbccdd_eeff00');
  });

  it('rejects malformed new-widget-id responses', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ id: '../bad' }));

    await expect(newWidgetId()).rejects.toThrow('Invalid new widget ID response from server.');
  });

  it('validates asset-list responses', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([
      {
        filename: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png',
        originalName: 'icon.png',
        mimeType: 'image/png',
        size: 42,
        uploadedAt: 123,
      },
    ]));

    const assets = await listAssets();

    expect(assets).toHaveLength(1);
    expect(assets[0].filename).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png');
  });

  it('rejects malformed source-test responses', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: null, errors: 'not-an-array' }));

    await expect(testSource({ id: 's1', method: 'GET', response: { type: 'json' } }))
      .rejects.toThrow('Invalid source test response from server.');
  });

  it('turns non-JSON responses into recoverable validation errors', async () => {
    const response = new Response('not-json', { status: 200 });

    await expect(readValidatedJson(response, z.object({ ok: z.literal(true) }), 'test'))
      .rejects.toThrow('Invalid test response from server: expected JSON.');
  });
});

describe('apiClient HA Ingress path-prefix smoke coverage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps API calls inside a nested HA Ingress builder mount', async () => {
    window.history.pushState({}, '', '/api/hassio_ingress/abc123/builder/');
    fetch.mockResolvedValueOnce(jsonResponse([]));

    await listWidgets();

    const [url] = fetch.mock.calls[0];
    expect(url).toBe('../api/widgets');
    expect(new URL(url, window.location.href).pathname)
      .toBe('/api/hassio_ingress/abc123/api/widgets');
  });

  it('keeps API calls inside a nested HA Ingress root mount', async () => {
    window.history.pushState({}, '', '/api/hassio_ingress/abc123/');
    fetch.mockResolvedValueOnce(jsonResponse([]));

    await listWidgets();

    const [url] = fetch.mock.calls[0];
    expect(url).toBe('./api/widgets');
    expect(new URL(url, window.location.href).pathname)
      .toBe('/api/hassio_ingress/abc123/api/widgets');
  });

  it('keeps preview and asset URLs inside a nested HA Ingress builder mount', () => {
    window.history.pushState({}, '', '/api/hassio_ingress/abc123/builder/');

    const previewUrl = getPreviewImageUrl('fullscreen');
    const rawAssetUrl = assetRawUrl('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png');

    expect(previewUrl.startsWith('../')).toBe(true);
    expect(rawAssetUrl).toBe('../api/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png/raw');
    expect(new URL(previewUrl, window.location.href).pathname)
      .toBe('/api/hassio_ingress/abc123/image_fullscreen.png');
    expect(new URL(rawAssetUrl, window.location.href).pathname)
      .toBe('/api/hassio_ingress/abc123/api/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png/raw');
  });
});
