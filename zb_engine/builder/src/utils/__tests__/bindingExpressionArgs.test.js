import { describe, expect, it } from 'vitest';

import {
  createStepArg,
  deserializeStepArg,
  getStepArgInputValue,
  getStepArgType,
  serializeStepArg,
  STEP_ARG_TYPES,
} from '../../utils/bindingExpressionArgs.js';
import {
  buildChainedExpression,
  decomposeExpression,
} from '../../components/BindingExpressionEditor.jsx';

describe('bindingExpressionArgs', () => {
  it('serializes boolean then/else branches as booleans', () => {
    const expr = buildChainedExpression('weather.condition', [
      {
        op: 'if',
        args: [
          createStepArg(STEP_ARG_TYPES.BOOLEAN, true),
          createStepArg(STEP_ARG_TYPES.BOOLEAN, false),
        ],
      },
    ]);

    expect(expr).toEqual({
      if: [
        { $: 'weather.condition' },
        true,
        false,
      ],
    });
  });

  it('round-trips existing boolean branches with explicit boolean arg metadata', () => {
    const parsed = decomposeExpression({
      if: [
        { '==': [{ $: 'weather.code' }, 200] },
        false,
        true,
      ],
    });

    const ifStep = parsed.steps.find((step) => step.op === 'if');

    expect(ifStep).toBeTruthy();
    expect(getStepArgType(ifStep.args[0])).toBe(STEP_ARG_TYPES.BOOLEAN);
    expect(getStepArgType(ifStep.args[1])).toBe(STEP_ARG_TYPES.BOOLEAN);
    expect(getStepArgInputValue(ifStep.args[0])).toBe('false');
    expect(getStepArgInputValue(ifStep.args[1])).toBe('true');
  });

  it('serializes inline if comparisons against a typed value', () => {
    const expr = buildChainedExpression('weather.condition', [
      {
        op: 'if',
        conditionOp: '==',
        conditionArg: createStepArg(STEP_ARG_TYPES.TEXT, 'rain'),
        args: [
          createStepArg(STEP_ARG_TYPES.BOOLEAN, false),
          createStepArg(STEP_ARG_TYPES.BOOLEAN, true),
        ],
      },
    ]);

    expect(expr).toEqual({
      if: [
        { '==': [{ $: 'weather.condition' }, 'rain'] },
        false,
        true,
      ],
    });
  });

  it('round-trips inline if comparisons back into the if step', () => {
    const parsed = decomposeExpression({
      if: [
        { '==': [{ $: 'weather.condition' }, 'rain'] },
        false,
        true,
      ],
    });

    const ifStep = parsed.steps.find((step) => step.op === 'if');

    expect(ifStep).toBeTruthy();
    expect(ifStep.conditionOp).toBe('==');
    expect(getStepArgType(ifStep.conditionArg)).toBe(STEP_ARG_TYPES.TEXT);
    expect(getStepArgInputValue(ifStep.conditionArg)).toBe('rain');
  });

  it('keeps string values like true as text when loaded from an expression', () => {
    const arg = deserializeStepArg('true');

    expect(getStepArgType(arg)).toBe(STEP_ARG_TYPES.TEXT);
    expect(serializeStepArg(arg)).toBe('true');
  });

  it('still auto-detects numbers and bindings for legacy arg strings', () => {
    expect(serializeStepArg('42')).toBe(42);
    expect(serializeStepArg('weather.temperature')).toEqual({ $: 'weather.temperature' });
  });
});