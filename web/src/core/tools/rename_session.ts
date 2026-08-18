// ============================================================
// vibeAgentGo — Session rename tool
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import { getMemoryStore, asString } from './shared.js';

export const rename_session: Tool = {
  name: 'rename_session',
  description:
    'Rename the current chat session with a concise, descriptive title. Use this after the first user message to give the session a meaningful name (e.g. "Git-Backup einrichten" instead of the truncated first message). Keep titles under 60 characters.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The new title for the current session. Concise and descriptive, max 60 characters.',
      },
    },
    required: ['title'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const title = asString(args.title).trim().slice(0, 60);
    if (!title) return 'Error: title is required';
    const sessionId = (ctx.env.sessionId as string) || null;
    if (!sessionId) return 'Error: no active session to rename';
    const session = await mem.getSession(sessionId);
    if (!session) return `Error: session ${sessionId} not found`;
    await mem.saveSession({
      ...session,
      title,
      updated_at: new Date().toISOString(),
    });
    return `Session renamed to "${title}"`;
  },
};
