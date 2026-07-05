// ============================================================
// vibeAgentGo — Lightweight runtime JSON-Schema validation for tool arguments
// ============================================================

import type { ToolSchema } from '../types/index.js';

export type ValidationError = { path: string; message: string };

export function validateArgs(schema: ToolSchema['function']['parameters'], args: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (schema.type !== 'object' || typeof args !== 'object' || args === null) {
    errors.push({ path: '', message: 'Arguments must be an object' });
    return errors;
  }
  const obj = args as Record<string, unknown>;
  const required = new Set(schema.required || []);
  for (const key of required) {
    if (!(key in obj) || obj[key] === undefined) {
      errors.push({ path: key, message: `Missing required parameter: ${key}` });
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    const prop = schema.properties[key];
    if (!prop) {
      errors.push({ path: key, message: `Unexpected parameter: ${key}` });
      continue;
    }
    validateValue(prop, value, key, errors);
  }
  return errors;
}

function validateValue(schema: unknown, value: unknown, path: string, errors: ValidationError[]): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as {
    type?: string | string[];
    enum?: unknown[];
    items?: unknown;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (s.enum && !s.enum.some((v) => v === value)) {
    errors.push({ path, message: `Value must be one of: ${s.enum.join(', ')}` });
  }
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const valid = types.some((t) => {
      if (t === 'string') return typeof value === 'string';
      if (t === 'number') return typeof value === 'number';
      if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
      if (t === 'boolean') return typeof value === 'boolean';
      if (t === 'array') return Array.isArray(value);
      if (t === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
      if (t === 'null') return value === null;
      return true;
    });
    if (!valid) {
      errors.push({ path, message: `Expected type ${types.join(' | ')}, got ${typeof value}` });
      return;
    }
  }
  if (s.type === 'array' && Array.isArray(value)) {
    const itemSchema = s.items;
    if (itemSchema) {
      value.forEach((item, idx) => validateValue(itemSchema, item, `${path}[${idx}]`, errors));
    }
  }
  if (s.type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const subSchema: ToolSchema['function']['parameters'] = {
      type: 'object',
      properties: (s.properties || {}) as Record<string, unknown>,
      required: s.required,
    };
    errors.push(...validateArgs(subSchema, obj).map((e) => ({ path: `${path}.${e.path}`, message: e.message })));
  }
}
