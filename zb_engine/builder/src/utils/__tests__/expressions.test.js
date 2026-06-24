/**
 * expressions.test.js — Tests for builder expression evaluator
 *
 * Covers: bindings, arithmetic, comparison, logic, math helpers,
 * string ops, divide-by-zero, recursion depth, blocked keys,
 * timestamp, pipe syntax, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  isBinding,
  isExpression,
  getExpressionOp,
  evaluate,
  buildPipeExpression,
  composePipeSyntax,
} from '@zb/expressions';

const ctx = {
  features: { temp: 22, label: 'warm', active: true },
  weather: { current: { temperature: 18.5, humidity: 65 } },
};

// ── isBinding ──────────────────────────────────────────────────

describe('isBinding', () => {
  it('returns true for { "$": "..." }', () => {
    expect(isBinding({ $: 'features.temp' })).toBe(true);
  });

  it('returns false for plain objects', () => {
    expect(isBinding({ key: 'value' })).toBe(false);
  });

  it('returns false for null/undefined/primitives', () => {
    expect(isBinding(null)).toBeFalsy();
    expect(isBinding(undefined)).toBeFalsy();
    expect(isBinding(42)).toBeFalsy();
    expect(isBinding('str')).toBeFalsy();
  });
});

// ── isExpression / getExpressionOp ─────────────────────────────

describe('isExpression', () => {
  it('detects arithmetic expressions', () => {
    expect(isExpression({ '+': [1, 2] })).toBe(true);
  });

  it('detects comparison expressions', () => {
    expect(isExpression({ '>': [10, 5] })).toBe(true);
  });

  it('returns false for bindings', () => {
    expect(isExpression({ $: 'features.temp' })).toBe(false);
  });

  it('returns false for non-array operator values', () => {
    expect(isExpression({ '+': 'not-array' })).toBe(false);
  });
});

describe('getExpressionOp', () => {
  it('returns the operator key', () => {
    expect(getExpressionOp({ '*': [2, 3] })).toBe('*');
  });

  it('returns null for non-expression objects', () => {
    expect(getExpressionOp({ key: 'val' })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getExpressionOp(null)).toBeNull();
  });
});

// ── evaluate: bindings ─────────────────────────────────────────

describe('evaluate — bindings', () => {
  it('resolves a feature binding', () => {
    expect(evaluate({ $: 'features.temp' }, ctx)).toBe(22);
  });

  it('resolves a source binding with dot-path', () => {
    expect(evaluate({ $: 'weather.current.temperature' }, ctx)).toBe(18.5);
  });

  it('returns default for missing source path', () => {
    expect(evaluate({ $: 'weather.missing.path', default: 0 }, ctx)).toBe(0);
  });

  it('returns default for missing feature', () => {
    expect(evaluate({ $: 'features.unknown', default: 'N/A' }, ctx)).toBe('N/A');
  });

  it('returns undefined when no default and missing', () => {
    expect(evaluate({ $: 'features.nonexistent' }, ctx)).toBeNull();
  });
});

// ── evaluate: arithmetic ───────────────────────────────────────

describe('evaluate — arithmetic', () => {
  it('adds numbers', () => {
    expect(evaluate({ '+': [3, 4] }, ctx)).toBe(7);
  });

  it('adds multiple numbers (reduce)', () => {
    expect(evaluate({ '+': [1, 2, 3] }, ctx)).toBe(6);
  });

  it('subtracts numbers', () => {
    expect(evaluate({ '-': [10, 3] }, ctx)).toBe(7);
  });

  it('multiplies numbers', () => {
    expect(evaluate({ '*': [5, 6] }, ctx)).toBe(30);
  });

  it('divides numbers', () => {
    expect(evaluate({ '/': [10, 4] }, ctx)).toBe(2.5);
  });

  it('handles division by zero (returns 0)', () => {
    expect(evaluate({ '/': [10, 0] }, ctx)).toBe(0);
  });

  it('handles mod', () => {
    expect(evaluate({ mod: [10, 3] }, ctx)).toBe(1);
  });

  it('handles mod by zero (returns 0)', () => {
    expect(evaluate({ mod: [10, 0] }, ctx)).toBe(0);
  });
});

// ── evaluate: comparison ───────────────────────────────────────

describe('evaluate — comparison', () => {
  it('==   equal', () => expect(evaluate({ '==': [1, 1] }, ctx)).toBe(true));
  it('!=   not equal', () => expect(evaluate({ '!=': [1, 2] }, ctx)).toBe(true));
  it('>    greater', () => expect(evaluate({ '>': [5, 3] }, ctx)).toBe(true));
  it('<    less', () => expect(evaluate({ '<': [3, 5] }, ctx)).toBe(true));
  it('>=   gte', () => expect(evaluate({ '>=': [5, 5] }, ctx)).toBe(true));
  it('<=   lte', () => expect(evaluate({ '<=': [5, 5] }, ctx)).toBe(true));
});

// ── evaluate: logic ────────────────────────────────────────────

describe('evaluate — logic', () => {
  it('if — truthy branch', () => {
    expect(evaluate({ if: [true, 'yes', 'no'] }, ctx)).toBe('yes');
  });

  it('if — falsy branch', () => {
    expect(evaluate({ if: [false, 'yes', 'no'] }, ctx)).toBe('no');
  });

  it('and — all truthy', () => {
    expect(evaluate({ and: [true, 1, 'x'] }, ctx)).toBe(true);
  });

  it('and — one falsy', () => {
    expect(evaluate({ and: [true, 0] }, ctx)).toBe(false);
  });

  it('or — at least one truthy', () => {
    expect(evaluate({ or: [false, 0, 1] }, ctx)).toBe(true);
  });

  it('not — negates', () => {
    expect(evaluate({ not: [true] }, ctx)).toBe(false);
  });
});

// ── evaluate: math helpers ─────────────────────────────────────

describe('evaluate — math helpers', () => {
  it('round', () => expect(evaluate({ round: [3.7] }, ctx)).toBe(4));
  it('floor', () => expect(evaluate({ floor: [3.7] }, ctx)).toBe(3));
  it('ceil', () => expect(evaluate({ ceil: [3.2] }, ctx)).toBe(4));
  it('abs', () => expect(evaluate({ abs: [-5] }, ctx)).toBe(5));
  it('min', () => expect(evaluate({ min: [3, 1, 2] }, ctx)).toBe(1));
  it('max', () => expect(evaluate({ max: [3, 1, 2] }, ctx)).toBe(3));
});

// ── evaluate: string ops ───────────────────────────────────────

describe('evaluate — string ops', () => {
  it('concat strings', () => {
    expect(evaluate({ concat: ['hello', ' ', 'world'] }, ctx)).toBe('hello world');
  });

  it('concat treats null as empty string', () => {
    expect(evaluate({ concat: ['a', null, 'b'] }, ctx)).toBe('ab');
  });

  it('format rounds to N decimal places', () => {
    expect(evaluate({ format: [3.14159, 2] }, ctx)).toBe('3.14');
  });
});

// ── evaluate: nesting ──────────────────────────────────────────

describe('evaluate — nesting', () => {
  it('nested expression: (3 + 4) * 2', () => {
    const expr = { '*': [{ '+': [3, 4] }, 2] };
    expect(evaluate(expr, ctx)).toBe(14);
  });

  it('binding inside expression', () => {
    const expr = { '+': [{ $: 'features.temp' }, 10] };
    expect(evaluate(expr, ctx)).toBe(32);
  });
});

// ── evaluate: recursion depth ──────────────────────────────────

describe('evaluate — recursion limit', () => {
  it('throws when max depth exceeded (matches server)', () => {
    // Build a deeply nested expression beyond MAX_DEPTH (20).
    let expr = 'deep';
    for (let i = 0; i < 25; i++) {
      expr = { if: [true, expr, 'fallback'] };
    }
    expect(() => evaluate(expr, ctx)).toThrow('recursion depth exceeded');
  });
});

// ── evaluate: literals and edge cases ──────────────────────────

describe('evaluate — literals', () => {
  it('returns literal numbers', () => {
    expect(evaluate(42, ctx)).toBe(42);
  });

  it('returns literal strings', () => {
    expect(evaluate('hello', ctx)).toBe('hello');
  });

  it('returns null as-is', () => {
    expect(evaluate(null, ctx)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(evaluate(undefined, ctx)).toBeUndefined();
  });
});

// ── resolvePath: blocked keys ──────────────────────────────────

describe('evaluate — blocked keys (prototype pollution)', () => {
  it('cannot traverse __proto__', () => {
    const result = evaluate({ $: 'src.__proto__' }, { src: {} });
    expect(result).toBeNull();
  });

  it('cannot traverse constructor', () => {
    const result = evaluate({ $: 'src.constructor' }, { src: {} });
    expect(result).toBeNull();
  });
});

// ── Timestamp operator ─────────────────────────────────────────

describe('evaluate — timestamp', () => {
  const tsCtx = {
    features: {},
    api: { updated: '2026-04-11T15:15:00Z' },
  };

  it('formats as time (UTC)', () => {
    const expr = { timestamp: [{ $: 'api.updated' }, 'time'] };
    expect(evaluate(expr, tsCtx)).toBe('15:15:00');
  });

  it('formats as time with UTC offset', () => {
    const expr = { timestamp: [{ $: 'api.updated' }, 'time', 3] };
    expect(evaluate(expr, tsCtx)).toBe('18:15:00');
  });

  it('formats as date', () => {
    const expr = { timestamp: [{ $: 'api.updated' }, 'date'] };
    expect(evaluate(expr, tsCtx)).toBe('2026-04-11');
  });

  it('converts seconds_from_midnight to HH:MM:SS with offset', () => {
    // source provides 54900 seconds from midnight, +3h offset = 65700s = 18:15:00
    const ctx2 = { features: {}, api: { updated: 54900 } };
    const expr = { timestamp: [{ $: 'api.updated' }, 'seconds_from_midnight', 3] };
    expect(evaluate(expr, ctx2)).toBe('18:15:00');
  });

  it('returns empty string for missing binding', () => {
    const expr = { timestamp: [{ $: 'api.missing' }, 'time'] };
    expect(evaluate(expr, tsCtx)).toBe('');
  });

  it('isExpression recognizes timestamp', () => {
    expect(isExpression({ timestamp: [{ $: 'x' }, 'time'] })).toBe(true);
  });
});

// ── Pipe syntax round-trip (timestamp) ─────────────────────────

describe('timestamp pipe syntax round-trip', () => {
  const tsCtx = {
    features: {},
    api: { updated: '2026-04-11T15:15:00Z' },
  };

  it('composePipeSyntax serializes 2-arg timestamp', () => {
    const expr = { timestamp: [{ $: 'api.updated' }, 'time'] };
    expect(composePipeSyntax(expr)).toBe('api.updated|timestamp:time');
  });

  it('composePipeSyntax serializes 3-arg timestamp', () => {
    const expr = { timestamp: [{ $: 'api.updated' }, 'time', 3] };
    expect(composePipeSyntax(expr)).toBe('api.updated|timestamp:time:3');
  });

  it('buildPipeExpression parses timestamp with offset', () => {
    const expr = buildPipeExpression('api.updated|timestamp:time:3');
    expect(expr).toEqual({ timestamp: [{ $: 'api.updated' }, 'time', 3] });
  });

  it('buildPipeExpression parses timestamp without offset', () => {
    const expr = buildPipeExpression('api.updated|timestamp:time');
    expect(expr).toEqual({ timestamp: [{ $: 'api.updated' }, 'time'] });
  });

  it('full round-trip: compose → build → evaluate (with offset)', () => {
    const original = { timestamp: [{ $: 'api.updated' }, 'time', 3] };
    const pipe = composePipeSyntax(original);
    const rebuilt = buildPipeExpression(pipe);
    expect(evaluate(rebuilt, tsCtx)).toBe('18:15:00');
  });

  it('full round-trip: compose → build → evaluate (no offset)', () => {
    const original = { timestamp: [{ $: 'api.updated' }, 'time'] };
    const pipe = composePipeSyntax(original);
    const rebuilt = buildPipeExpression(pipe);
    expect(evaluate(rebuilt, tsCtx)).toBe('15:15:00');
  });

  it('string template interpolation with timestamp', () => {
    const text = 'Updated: {{api.updated|timestamp:time:3}}';
    expect(evaluate(text, tsCtx)).toBe('Updated: 18:15:00');
  });
});
