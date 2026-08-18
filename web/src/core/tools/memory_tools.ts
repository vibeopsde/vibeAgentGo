// ============================================================
// vibeAgentGo — Memory tools
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import { getMemoryStore, asString, asNumber } from './shared.js';

export const memory_save: Tool = {
  name: 'memory_save',
  description:
    'Save a durable fact to persistent memory in the browser (IndexedDB). Survives across sessions. Use for user preferences, environment details, or important facts. Category "user" for facts about the user, "memory" for general notes.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact to remember (declarative)' },
      category: {
        type: 'string',
        enum: ['memory', 'user'],
        description: 'Type: "user" = about the user, "memory" = general. Default: memory',
      },
    },
    required: ['content'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const content = asString(args.content);
    const category = asString(args.category, 'memory');
    const id = await mem.saveMemory(content, category);
    return `Saved to ${category} memory (id: ${id})`;
  },
};

export const memory_search: Tool = {
  name: 'memory_search',
  description:
    'Search persistent memory entries in the browser (IndexedDB). Returns matching memory entries by content or category. Use this to recall relevant facts before answering or when the user refers to something from the past.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term or phrase to look for in memory contents' },
      category: { type: 'string', enum: ['memory', 'user'], description: 'Optional filter by category' },
      limit: { type: 'number', description: 'Maximum number of results to return. Default: 10' },
    },
    required: ['query'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const limit = asNumber(args.limit, 10);
    const category = asString(args.category);
    // Use the IndexedDB category index when filtering, fallback to full scan for unfiltered search.
    const all = category ? await mem.searchByCategory(category, limit * 4) : await mem.searchAllMemory(limit * 4);
    const query = asString(args.query).toLowerCase();
    const matches = all.filter((m) => m.content.toLowerCase().includes(query)).slice(0, limit);
    if (matches.length === 0) return `No memory entries found for "${query}".`;
    return matches.map((m) => `§ [#${m.id}] ${m.category}: ${m.content}`).join('\n\n');
  },
};

export const memory_delete: Tool = {
  name: 'memory_delete',
  description:
    'Delete a persistent memory entry by its ID. Use memory_search first to find the ID. Returns ok or fail.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'The ID of the memory entry to delete' },
    },
    required: ['id'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const id = asNumber(args.id);
    if (!id) return 'Invalid or missing id.';
    const deleted = await mem.deleteMemory(id);
    return deleted ? `Deleted memory entry #${id}` : `Failed to delete memory entry #${id} (not found or error)`;
  },
};

export const memory_update: Tool = {
  name: 'memory_update',
  description:
    'Update an existing memory entry by its ID. Use memory_search first to find the ID. Can update content and optionally category. Returns ok or fail.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'The ID of the memory entry to update' },
      content: { type: 'string', description: 'The new content for the memory entry' },
      category: {
        type: 'string',
        enum: ['memory', 'user'],
        description:
          'Optional new category: "user" = about the user, "memory" = general. If omitted, keeps current category.',
      },
    },
    required: ['id', 'content'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const id = asNumber(args.id);
    const content = asString(args.content);
    const category = asString(args.category);
    if (!id) return 'Invalid or missing id.';
    if (!content) return 'Content cannot be empty.';
    const updated = await mem.updateMemory(id, content, category || undefined);
    return updated
      ? `Updated memory entry #${id}${category ? ` (category: ${category})` : ''}`
      : `Failed to update memory entry #${id} (not found or error)`;
  },
};

// --- Error Log Analysis ---
