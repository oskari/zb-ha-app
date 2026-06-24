import { evaluate, isBinding, isExpression } from '@zb/expressions';

function isDynamicValue(value) {
  return isBinding(value) || isExpression(value);
}

export function resolveVisibilityValue(value, ctx, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;
  if (!isDynamicValue(value)) return fallback;

  try {
    const resolved = evaluate(value, ctx);
    return typeof resolved === 'boolean' ? resolved : fallback;
  } catch {
    return fallback;
  }
}