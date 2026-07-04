import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, toolsToSchemas } from '../src/core/prompt_builder.js';
import type { MemoryEntry, Skill, Tool } from '../src/types/index.js';

const dummyTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: {
    type: 'object',
    properties: { x: { type: 'string' } },
    required: ['x'],
  },
  handler: async () => 'ok',
};

describe('prompt_builder', () => {
  it('builds a system prompt with identity and tools', () => {
    const prompt = buildSystemPrompt({
      memories: [],
      profile: [],
      skills: [],
      tools: [dummyTool],
    });
    expect(prompt).toContain('HAG');
    expect(prompt).toContain('test_tool');
  });

  it('includes memory and profile entries', () => {
    const memories: MemoryEntry[] = [{ id: 1, content: 'Memory A', category: 'memory', created_at: '2024-01-01' }];
    const profile: MemoryEntry[] = [{ id: 2, content: 'Profile B', category: 'user', created_at: '2024-01-01' }];
    const prompt = buildSystemPrompt({ memories, profile, skills: [], tools: [] });
    expect(prompt).toContain('Memory A');
    expect(prompt).toContain('Profile B');
  });

  it('includes skills', () => {
    const skills: Skill[] = [{ name: 'test-skill', description: 'desc', content: 'skill body' }];
    const prompt = buildSystemPrompt({ memories: [], profile: [], skills, tools: [] });
    expect(prompt).toContain('test-skill');
    expect(prompt).toContain('skill body');
  });

  it('converts tools to schemas', () => {
    const schemas = toolsToSchemas([dummyTool]);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe('test_tool');
  });
});
