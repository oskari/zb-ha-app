import { isBinding } from '@zb/expressions';

export const STEP_ARG_TYPES = Object.freeze({
  AUTO: 'auto',
  BOOLEAN: 'boolean',
  NUMBER: 'number',
  TEXT: 'text',
  BINDING: 'binding',
});

function parseLegacyArg(arg) {
  if (arg === '' || arg === undefined || arg === null) return '';
  if (arg === true || arg === false) return arg;

  if (typeof arg === 'string') {
    if (arg === 'true') return true;
    if (arg === 'false') return false;

    const num = Number(arg);
    if (!Number.isNaN(num) && String(num) === String(arg)) return num;
    if (arg.includes('.')) return { $: arg };
    return arg;
  }

  return arg;
}

export function createStepArg(type = STEP_ARG_TYPES.TEXT, value = '') {
  return { type, value };
}

export function isTypedStepArg(arg) {
  return !!arg
    && typeof arg === 'object'
    && !Array.isArray(arg)
    && typeof arg.type === 'string'
    && 'value' in arg;
}

export function serializeStepArg(arg) {
  if (!isTypedStepArg(arg)) return parseLegacyArg(arg);

  switch (arg.type) {
    case STEP_ARG_TYPES.AUTO:
      return parseLegacyArg(arg.value);
    case STEP_ARG_TYPES.BOOLEAN:
      return arg.value === true || arg.value === 'true';
    case STEP_ARG_TYPES.NUMBER: {
      if (arg.value === '' || arg.value === undefined || arg.value === null) return '';
      const num = Number(arg.value);
      return Number.isNaN(num) ? '' : num;
    }
    case STEP_ARG_TYPES.BINDING:
      return arg.value ? { $: arg.value } : '';
    case STEP_ARG_TYPES.TEXT:
    default:
      return arg.value ?? '';
  }
}

export function deserializeStepArg(arg) {
  if (isTypedStepArg(arg)) return arg;
  if (arg === true || arg === false) return createStepArg(STEP_ARG_TYPES.BOOLEAN, arg);
  if (typeof arg === 'number') return createStepArg(STEP_ARG_TYPES.NUMBER, String(arg));
  if (isBinding(arg)) return createStepArg(STEP_ARG_TYPES.BINDING, arg.$);
  return createStepArg(STEP_ARG_TYPES.TEXT, String(arg ?? ''));
}

export function getStepArgType(arg) {
  return isTypedStepArg(arg) ? arg.type : STEP_ARG_TYPES.AUTO;
}

export function getStepArgInputValue(arg) {
  if (!isTypedStepArg(arg)) return String(arg ?? '');
  if (arg.type === STEP_ARG_TYPES.BOOLEAN) {
    return arg.value === true || arg.value === 'true' ? 'true' : 'false';
  }
  return String(arg.value ?? '');
}