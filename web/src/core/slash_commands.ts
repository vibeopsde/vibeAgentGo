import type { Tool, ToolContext, MemoryStore } from '../types/index.js';
import { loadConfig } from './memory.js';

export interface SlashCommandContext {
  text: string;
  args: string[];
  appendSystem(text: string): void;
  appendError(text: string): void;
  setStatus(status: 'idle' | 'thinking'): void;
  clear(): void;
  tools: Tool[];
  memoryStore: MemoryStore;
  workspace: string;
  onNewChat(): void;
  onStopAgent(): void;
  getAgentStatus(): 'idle' | 'thinking';
  listSkills(): Promise<{ name: string; description: string }[]>;
}

type SlashCommand = {
  name: string;
  description: string;
  handler(ctx: SlashCommandContext): Promise<void> | void;
};

const COMMANDS: SlashCommand[] = [
  {
    name: 'help',
    description: 'Show available slash commands',
    handler(ctx) {
      const lines = COMMANDS.map((c) => '`/' + c.name + '` — ' + c.description);
      ctx.appendSystem(`**Slash commands**\n\n${lines.join('\n')}`);
    },
  },
  {
    name: 'new',
    description: 'Start a new chat',
    handler(ctx) {
      ctx.onNewChat();
      ctx.appendSystem('New chat started.');
    },
  },
  {
    name: 'status',
    description: 'Show local app status (model, memory, sessions, files)',
    async handler(ctx) {
      const config = loadConfig();
      const [sessions, memories, files, skills] = await Promise.all([
        ctx.memoryStore.listSessions().catch(() => []),
        ctx.memoryStore.getAllMemory(1000).catch(() => ({ memories: [], profile: [] })),
        ctx.memoryStore.listFiles().catch(() => []),
        ctx.listSkills().catch(() => []),
      ]);
      const allMemory = [...memories.memories, ...memories.profile];
      const lines: string[] = [
        `Model: ${config.model || '(not set)'}`,
        `Base URL: ${config.baseUrl || '(not set)'}`,
        `Language: ${config.language}`,
        `Agent: ${ctx.getAgentStatus()}`,
        `Sessions: ${sessions.length}`,
        `Memory entries: ${allMemory.length}`,
        `Skills: ${skills.length}`,
        `Workspace files: ${files.length}`,
      ];
      ctx.appendSystem(`**Status**\n\n${lines.join('\n')}`);
    },
  },
  {
    name: 'stop',
    description: 'Stop the currently running agent',
    handler(ctx) {
      ctx.onStopAgent();
      ctx.appendSystem('Agent stopped.');
    },
  },
  {
    name: 'clear',
    description: 'Clear the current chat window',
    handler(ctx) {
      ctx.clear();
      ctx.appendSystem('Chat cleared.');
    },
  },
  {
    name: 'sys_check',
    description: 'Run a deterministic system health check',
    async handler(ctx) {
      const sysCheck = ctx.tools.find((t) => t.name === 'sys_check');
      if (!sysCheck) {
        ctx.appendError('sys_check tool is not available.');
        return;
      }
      ctx.setStatus('thinking');
      try {
        const toolCtx: ToolContext = {
          workspace: ctx.workspace,
          emit: () => {},
          env: { memoryStore: ctx.memoryStore as any },
        };
        const repair = ctx.args.includes('repair') || ctx.args.includes('repair=true');
        const result = await sysCheck.handler({ repair }, toolCtx);
        ctx.appendSystem(String(result));
      } catch (e) {
        ctx.appendError(e instanceof Error ? e.message : String(e));
      } finally {
        ctx.setStatus('idle');
      }
    },
  },
];

export function isSlashCommand(text: string): boolean {
  return /^\/[A-Za-z0-9_-]/.test(text.trim());
}

export async function handleSlashCommand(ctx: SlashCommandContext): Promise<boolean> {
  const name = ctx.text.trim().split(/\s+/)[0].slice(1).toLowerCase();
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) return false;
  // Echo the command itself so it appears in the chat history.
  const pretty = ctx.args.length ? `/${name} ${ctx.args.join(' ')}` : `/${name}`;
  ctx.appendSystem(`> ${pretty}`);
  await command.handler(ctx);
  return true;
}

export function getSlashCommands(): { name: string; description: string }[] {
  return COMMANDS.map(({ name, description }) => ({ name, description }));
}
