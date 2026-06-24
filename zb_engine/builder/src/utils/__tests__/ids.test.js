/**
 * ids.test.js — createId() must always produce a valid source/context key.
 *
 * Source IDs become expression-context roots and are validated server-side by
 * `sourceSchema` (src/schema/sourceSchema.ts) with this exact regex. A bare
 * crypto.randomUUID() can start with a digit (or contain hyphens), which the
 * schema rejects with HTTP 400 — silently breaking source fetching on the
 * canvas. This locks the generator to the schema's contract.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createId } from '../ids.js';

// Mirror of the authoritative regex in src/schema/sourceSchema.ts.
const SOURCE_ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

describe('createId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces IDs that satisfy the server source-ID schema', () => {
    for (let i = 0; i < 200; i++) {
      const id = createId();
      expect(id).toMatch(SOURCE_ID_REGEX);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });

  it('produces a valid ID even when the UUID would start with a digit', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '3f4a9c1e-2b6d-4f8a-9c0e-1a2b3c4d5e6f',
    );
    const id = createId();
    expect(id).toMatch(SOURCE_ID_REGEX);
    // No hyphens survive — safe to use inside {{id.path}} bindings.
    expect(id).not.toContain('-');
  });

  it('produces a valid ID via the non-crypto fallback', () => {
    const original = globalThis.crypto.randomUUID;
    // Simulate an insecure context where randomUUID is unavailable.
    globalThis.crypto.randomUUID = undefined;
    try {
      const id = createId();
      expect(id).toMatch(SOURCE_ID_REGEX);
    } finally {
      globalThis.crypto.randomUUID = original;
    }
  });

  it('returns unique values across calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(createId());
    expect(ids.size).toBe(100);
  });
});
