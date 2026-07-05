// ============================================================
// vibeAgentGo — Schema validation tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { validateArgs } from '../src/utils/schema_validate.js';
import type { ToolSchema } from '../src/types/index.js';

describe('validateArgs', () => {
  it('accepts valid required args', () => {
    const schema: ToolSchema['function']['parameters'] = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };
    expect(validateArgs(schema, { path: 'a.txt' })).toEqual([]);
  });

  it('reports missing required args', () => {
    const schema: ToolSchema['function']['parameters'] = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };
    const errors = validateArgs(schema, {});
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('path');
  });

  it('reports type mismatch', () => {
    const schema: ToolSchema['function']['parameters'] = {
      type: 'object',
      properties: { timeout: { type: 'number' } },
    };
    const errors = validateArgs(schema, { timeout: 'fast' });
    expect(errors[0].message).toContain('Expected type number');
  });

  it('enforces enum values', () => {
    const schema: ToolSchema['function']['parameters'] = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'done'] } },
    };
    const errors = validateArgs(schema, { status: 'blocked' });
    expect(errors[0].message).toContain('one of');
  });

  it('validates nested arrays and objects', () => {
    const schema: ToolSchema['function']['parameters'] = {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      },
    };
    const errors = validateArgs(schema, { tasks: [{ title: 'A' }, {}] });
    expect(errors.some((e) => e.path === 'tasks[1].title')).toBe(true);
  });
});
