// ============================================================
// vibeAgentGo — Prompt Builder (browser-side, no fs access)
// ============================================================

import type { MemoryEntry, Skill, Tool, ToolSchema } from '../types/index.js';
import { SkillStore } from './memory.js';

const IDENTITY_BLOCK = `You are vibeAgentGo (Hermes Agent Go), a helpful AI assistant running entirely in the user's browser. You can write and execute code, manage files in the browser's IndexedDB, search the web, and build interactive mini-apps.

Keep your responses concise and to the point. Avoid unnecessary preamble, redundant explanations, and overly verbose digressions. Use tools when needed, but don't loop or ask clarifying questions unless the task truly requires it.

You have persistent memory across conversations — use the memory_save tool when you learn a durable fact about the user, their preferences, or their environment. Don't save temporary task state.

For long-running or multi-step projects, use the state_view and state_update tools with agent_state.json. This shared scratchpad tracks goal, phase, tasks, open issues, lessons learned, and files. At the start of a complex task, call state_view to load context. After meaningful progress, call state_update to keep the state in sync. Use render: true when you want to show the Project State dashboard.

You can render interactive views (HTML/CSS/JS) alongside the chat using the render_view tool. Use it to show visualizations, dashboards, calculators, or any interactive UI.

All data — sessions, memory, files — lives in the user's browser (IndexedDB). Nothing is sent to a server except LLM API calls. The user has full data sovereignty.`;

function buildMemoryBlock(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map(m => `§ ${m.content}`);
  return `## Memory (persistent across sessions, stored in browser)\n${lines.join('\n')}`;
}

function buildUserProfile(profile: MemoryEntry[]): string {
  if (profile.length === 0) return '';
  const lines = profile.map(p => `§ ${p.content}`);
  return `## User Profile\n${lines.join('\n')}`;
}

function buildSkillsBlock(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const blocks = skills.map(s => `### Skill: ${s.name}\n${s.description}\n\n${s.content}`);
  return `## Skills\n${blocks.join('\n\n---\n\n')}`;
}

function buildToolSchemas(tools: Tool[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map(t => `- **${t.name}**: ${t.description}`);
  return `## Available Tools\n${lines.join('\n')}`;
}

export interface PromptContext {
  memories: MemoryEntry[];
  profile: MemoryEntry[];
  skills: Skill[];
  tools: Tool[];
  extra?: string;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const parts: string[] = [IDENTITY_BLOCK];

  parts.push(`## Environment
- Platform: Browser (PWA, mobile-first)
- All data stored locally in IndexedDB — no server-side storage
- You have access to a sandboxed JavaScript runtime via run_code
- You can read and write files in the browser workspace (IndexedDB)
- You can render HTML views via render_view
- You can inspect rendered views with inspect_view to read console logs, errors, warnings, and uncaught exceptions for debugging`);

  const memory = buildMemoryBlock(ctx.memories);
  if (memory) parts.push(memory);

  const profile = buildUserProfile(ctx.profile);
  if (profile) parts.push(profile);

  const skills = buildSkillsBlock(ctx.skills);
  if (skills) parts.push(skills);

  const toolList = buildToolSchemas(ctx.tools);
  if (toolList) parts.push(toolList);

  if (ctx.extra) parts.push(ctx.extra);

  return parts.join('\n\n');
}

export function toolsToSchemas(tools: Tool[]): ToolSchema[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// Skills are loaded from IndexedDB via SkillStore. The UI to create/edit skills is future work.
export async function loadSkills(): Promise<Skill[]> {
  const store = new SkillStore();
  const records = await store.listSkills();
  return records.map(r => ({
    name: r.name,
    description: r.description,
    content: r.content,
    trigger: r.trigger,
  }));
}