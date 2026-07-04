// ============================================================
// HAG — Prompt Builder
// ============================================================

import type { MemoryEntry, Skill, Tool, ToolSchema } from '../types/index.js';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const IDENTITY_BLOCK = `You are HAG (Hermes Agent Go), a helpful AI assistant that can write and execute code, manage files, search the web, and build interactive mini-apps.

You have persistent memory across conversations — use the memory_save tool when you learn a durable fact about the user, their preferences, or their environment. Don't save temporary task state.

You can render interactive views (HTML/CSS/JS) alongside the chat using the render_view tool. Use it to show visualizations, dashboards, calculators, or any interactive UI.`;

function buildEnvironmentHints(workspace: string): string {
  return `## Environment
- Platform: ${process.platform === 'android' ? 'Android' : process.platform}
- Working directory: ${workspace}
- You have access to a sandboxed JavaScript runtime (QuickJS) via run_code
- You can read and write files in the workspace
- You can render HTML views via render_view`;
}

function buildMemoryBlock(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map(m => `§ ${m.content}`);
  return `## Memory (persistent across sessions)\n${lines.join('\n')}`;
}

function buildUserProfile(profile: MemoryEntry[]): string {
  if (profile.length === 0) return '';
  const lines = profile.map(p => `§ ${p.content}`);
  return `## User Profile\n${lines.join('\n')}`;
}

function buildSkillsBlock(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const blocks = skills.map(s => {
    const trigger = s.trigger?.length ? `\nTriggers: ${s.trigger.join(', ')}` : '';
    return `### Skill: ${s.name}\n${s.description}${trigger}\n\n${s.content}`;
  });
  return `## Skills\n${blocks.join('\n\n---\n\n')}`;
}

function buildContextFile(workspace: string): string {
  const candidates = ['.agent.md', 'AGENTS.md', 'CLAUDE.md'];
  for (const f of candidates) {
    const path = join(workspace, f);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8').slice(0, 20000);
        return `## Project Context (${f})\n${content}`;
      } catch { /* ignore */ }
    }
  }
  return '';
}

function buildToolSchemas(tools: Tool[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map(t => `- **${t.name}**: ${t.description}`);
  return `## Available Tools\n${lines.join('\n')}`;
}

export interface PromptContext {
  workspace: string;
  memories: MemoryEntry[];
  profile: MemoryEntry[];
  skills: Skill[];
  tools: Tool[];
  extra?: string;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const parts: string[] = [IDENTITY_BLOCK];

  const env = buildEnvironmentHints(ctx.workspace);
  if (env) parts.push(env);

  const memory = buildMemoryBlock(ctx.memories);
  if (memory) parts.push(memory);

  const profile = buildUserProfile(ctx.profile);
  if (profile) parts.push(profile);

  const skills = buildSkillsBlock(ctx.skills);
  if (skills) parts.push(skills);

  const context = buildContextFile(ctx.workspace);
  if (context) parts.push(context);

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

// --- Skill Loading ---

export function loadSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];
  const files = readdirSync(skillsDir).filter((f: string) => f.endsWith('.md'));
  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      // Parse frontmatter
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (match) {
        const frontmatter = match[1];
        const body = match[2];
        const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
        const descMatch = frontmatter.match(/^description:\s*"?([^"\n]+)"?/m);
        const triggerMatch = frontmatter.match(/^trigger:\s*\[([^\]]*)\]/m);

        skills.push({
          name: nameMatch?.[1]?.trim() || file.replace('.md', ''),
          description: descMatch?.[1]?.trim() || '',
          content: body.trim(),
          trigger: triggerMatch?.[1]?.split(',').map(s => s.trim().replace(/"/g, '')),
        });
      } else {
        // No frontmatter — use filename as name
        skills.push({
          name: file.replace('.md', ''),
          description: '',
          content: content.trim(),
        });
      }
    } catch { /* skip broken files */ }
  }

  return skills;
}