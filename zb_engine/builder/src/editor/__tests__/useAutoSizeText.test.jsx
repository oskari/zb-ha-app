/**
 * useAutoSizeText.test.jsx — Canvas text auto-size hook coverage.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const bitmapFontMocks = vi.hoisted(() => ({
  fontsReady: vi.fn(() => true),
  measureTextBounds: vi.fn(),
}));

vi.mock('../../utils/bitmapFont.js', () => bitmapFontMocks);

import { resolveDisplayText, useAutoSizeText } from '../useAutoSizeText.js';

describe('useAutoSizeText', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('resolves template text with the live binding context', () => {
    const text = resolveDisplayText('Temp: {{weather.temp}}°C', '', {
      weather: { temp: 22 },
    });

    expect(text).toBe('Temp: 22°C');
  });

  it('shows a concise field label, not the raw template, when a binding cannot resolve', () => {
    // No data in context (e.g. secret-protected source the builder cannot
    // fetch): must NOT dump the full {{sourceId.long.path}} on the canvas.
    const text = resolveDisplayText(
      '{{id_abc123_def456.data.stop.stoptimesWithoutPatterns[0].realtimeDeparture}}',
      '',
      {},
    );

    expect(text).toBe('realtimeDeparture');
    expect(text).not.toContain('{{');
  });

  it('prefers the author fallback text for an unresolved binding', () => {
    const text = resolveDisplayText('{{sensor.state}}', '(no data)', {});
    expect(text).toBe('(no data)');
  });

  it('keeps surrounding static text when a token is unresolved', () => {
    const text = resolveDisplayText('Next: {{transit.data.stop.departure}}', '', {});
    expect(text).toBe('Next: departure');
  });

  it('does not throw on a degenerate context, falling back to a label', () => {
    // A missing/degenerate context must not crash the canvas render — the
    // token resolves to its field label instead of throwing or leaking {{…}}.
    const text = resolveDisplayText('{{weather.temp}}', '', null);
    expect(typeof text).toBe('string');
    expect(text).not.toContain('{{');
  });

  it('updates text bounds when measured display size changes', async () => {
    bitmapFontMocks.measureTextBounds.mockReturnValue({ width: 64, height: 18 });
    const updateElementDerived = vi.fn();
    const elements = [
      {
        id: 'text_1',
        type: 'text',
        text: 'Hello',
        fontSize: 12,
        fontWeight: 400,
        fontFamily: 'Sora',
        lineHeight: 1.2,
        sizeX: 10,
        sizeY: 10,
      },
    ];

    renderHook(() => useAutoSizeText({
      elements,
      bitmapFontsLoaded: true,
      bindingCtx: {},
      updateElementDerived,
    }));

    await waitFor(() => {
      expect(updateElementDerived).toHaveBeenCalledWith('text_1', { sizeX: 64, sizeY: 18 });
    });
  });

  it('does not measure while bitmap fonts are not ready', () => {
    bitmapFontMocks.fontsReady.mockReturnValue(false);
    const updateElementDerived = vi.fn();

    renderHook(() => useAutoSizeText({
      elements: [{ id: 'text_1', type: 'text', text: 'Hello' }],
      bitmapFontsLoaded: true,
      bindingCtx: {},
      updateElementDerived,
    }));

    expect(bitmapFontMocks.measureTextBounds).not.toHaveBeenCalled();
    expect(updateElementDerived).not.toHaveBeenCalled();
  });
});
