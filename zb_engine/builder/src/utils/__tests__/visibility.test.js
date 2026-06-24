import { describe, expect, it } from 'vitest';

import { resolveVisibilityValue } from '../../utils/visibility.js';

const ctx = {
  features: { showCard: true, hideCard: false },
  weather: { condition: 'rain' },
};

describe('resolveVisibilityValue', () => {
  it('passes through literal booleans', () => {
    expect(resolveVisibilityValue(true, ctx)).toBe(true);
    expect(resolveVisibilityValue(false, ctx)).toBe(false);
  });

  it('resolves bound boolean expressions', () => {
    expect(resolveVisibilityValue({ $: 'features.showCard' }, ctx)).toBe(true);
    expect(resolveVisibilityValue({ if: [{ '==': [{ $: 'weather.condition' }, 'rain'] }, false, true] }, ctx)).toBe(false);
  });

  it('falls back to visible when the resolved value is invalid or missing', () => {
    expect(resolveVisibilityValue({ $: 'features.missing' }, ctx)).toBe(true);
    expect(resolveVisibilityValue({ if: [true, 'false', 'true'] }, ctx)).toBe(true);
    expect(resolveVisibilityValue('false', ctx)).toBe(true);
  });
});