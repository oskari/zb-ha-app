import { describe, it, expect } from 'vitest';
import { resolveAssetSrc, ASSET_TOKEN_PREFIX } from '../assetSrc.js';

// Stand-in for the platform's `assetRawUrl` — encodes the filename exactly like
// the real one so the injection guard is exercised.
const rawUrlFor = (filename) => `../api/assets/${encodeURIComponent(filename)}/raw`;

describe('resolveAssetSrc', () => {
  it('maps an asset: token to the raw-bytes URL via the resolver', () => {
    expect(resolveAssetSrc('asset:abc123.svg', rawUrlFor)).toBe(
      '../api/assets/abc123.svg/raw',
    );
  });

  it('encodes the filename through the resolver (no raw path injection)', () => {
    // A crafted token cannot emit un-encoded path separators; the server also
    // rejects traversal, but the client must not hand it a live `../` path.
    expect(resolveAssetSrc('asset:../../secret', rawUrlFor)).toBe(
      '../api/assets/..%2F..%2Fsecret/raw',
    );
  });

  it('passes http(s) and inline srcs through unchanged', () => {
    expect(resolveAssetSrc('https://host/x.svg', rawUrlFor)).toBe('https://host/x.svg');
    expect(resolveAssetSrc('<svg/>', rawUrlFor)).toBe('<svg/>');
    expect(resolveAssetSrc('', rawUrlFor)).toBe('');
  });

  it('leaves the token unresolved when no resolver is available (non-asset builds)', () => {
    expect(resolveAssetSrc('asset:abc123.svg', null)).toBe('asset:abc123.svg');
    expect(resolveAssetSrc('asset:abc123.svg', undefined)).toBe('asset:abc123.svg');
  });

  it('passes non-string srcs (bindings / null / undefined) through untouched by reference', () => {
    const binding = { $: 'features.icon' };
    expect(resolveAssetSrc(binding, rawUrlFor)).toBe(binding);
    expect(resolveAssetSrc(undefined, rawUrlFor)).toBe(undefined);
    expect(resolveAssetSrc(null, rawUrlFor)).toBe(null);
  });

  it('does not resolve a degenerate empty-filename token', () => {
    expect(resolveAssetSrc('asset:', rawUrlFor)).toBe('asset:');
  });

  it('exposes the token prefix constant', () => {
    expect(ASSET_TOKEN_PREFIX).toBe('asset:');
  });
});
