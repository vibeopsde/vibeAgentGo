// ============================================================
// vibeAgentGo — Error/audit log tool
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import { readLogs, type LogLevel } from '../logger.js';
import { asString, asNumber } from './shared.js';

export const error_log: Tool = {
  name: 'error_log',
  description:
    'Read the local error log stored in the browser (IndexedDB). Use this to investigate unexpected crashes, failed LLM requests, or tool errors. Returns the most recent log entries with timestamps, levels, sources, and messages. Use level="info" to also see tool call audit logs (which tool was called with what args, and what it returned). Use level="debug" for full detail including turn-by-turn agent state.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum number of log entries to return. Default: 20' },
      level: {
        type: 'string',
        enum: ['error', 'fatal', 'warn', 'info', 'debug'],
        description: 'Filter by minimum severity level. Default: warn',
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const limit = Math.min(100, Math.max(1, asNumber(args.limit, 20)));
    const level = asString(args.level, 'warn');
    const levels: LogLevel[] =
      level === 'debug'
        ? ['debug', 'info', 'warn', 'error', 'fatal']
        : level === 'info'
          ? ['info', 'warn', 'error', 'fatal']
          : level === 'warn'
            ? ['warn', 'error', 'fatal']
            : level === 'error'
              ? ['error', 'fatal']
              : ['fatal'];

    try {
      const entries = await readLogs({ levels, limit });
      if (entries.length === 0) return 'No matching log entries.';
      return entries
        .map(
          (e) =>
            `[${e.timestamp}] ${e.level.toUpperCase()} ${e.source}: ${e.message}${
              e.details ? ' | ' + JSON.stringify(e.details) : ''
            }`
        )
        .join('\n');
    } catch (e) {
      return `Failed to read error log: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// --- Registry ---

// --- Session Management ---
