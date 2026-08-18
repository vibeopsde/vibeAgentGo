// ============================================================
// vibeAgentGo — Tool shared helpers
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { ToolContext } from '../../types/index.js';
import { MemoryStore } from '../memory.js';

// --- Helpers ---

export const getMemoryStore = (ctx: ToolContext): MemoryStore => ctx.env.memoryStore!;

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v)) : [];
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : [];
}

// --- File Tools (IndexedDB workspace) ---
