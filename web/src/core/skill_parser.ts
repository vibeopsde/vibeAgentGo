// ============================================================
// vibeAgentGo — Skill Parser
// Parses Markdown files with YAML-ish frontmatter:
//
// ---
// name: VibeAgentGo
// description: Client-side PWA AI agent
// triggers: ["vibeAgentGo", "vibeagentgo", "VCR"]
// ---
//
// Optional skill body (instructions, context, examples)
// ============================================================

import type { Skill } from '../types/index.js';

export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  trigger: string[];
}

/**
 * Parse a skill markdown string. Supports YAML frontmatter.
 * Falls back to heuristics if parsing fails.
 */
export function parseSkill(text: string): ParsedSkill {
  const trimmed = text.trim();
  let name = 'Unnamed Skill';
  let description = '';
  let trigger: string[] = [];
  let content = trimmed;

  // YAML frontmatter detection
  if (trimmed.startsWith('---')) {
    const endIdx = trimmed.indexOf('---', 3);
    if (endIdx !== -1) {
      const frontmatter = trimmed.slice(3, endIdx).trim();
      content = trimmed.slice(endIdx + 3).trim();

      // Parse frontmatter lines, supporting simple key: value plus block lists
      const lines = frontmatter.split('\n');
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
          i++;
          continue;
        }

        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const rawValue = line.slice(colonIdx + 1).trim();

        if (key === 'name') name = cleanValue(rawValue) || name;
        else if (key === 'description') description = cleanValue(rawValue);
        else if (key === 'triggers' || key === 'trigger') {
          const blockLines: string[] = [rawValue];
          i++;
          while (
            i < lines.length &&
            !lines[i].includes(':') &&
            (lines[i].trim().startsWith('-') || lines[i].trim() === '')
          ) {
            blockLines.push(lines[i].trim());
            i++;
          }
          trigger = parseTriggerList(blockLines.join('\n'));
          continue;
        }
        i++;
      }
    }
  }

  return { name, description, content, trigger };
}

function cleanValue(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

function parseTriggerList(value: string): string[] {
  value = value.trim();
  if (!value) return [];

  // YAML array syntax: [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^["']|["']$/g, ''));
  }

  // Multiline dash list: - trigger
  if (value.includes('- ')) {
    return value
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
      .map((s) => s.replace(/^["']|["']$/g, ''));
  }

  // Comma-separated string
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check if a message triggers a skill. Matches any trigger word as a substring
 * (case-insensitive, word boundaries ignored). For project-style skills, this is
 * intentionally broad: "VibeAgentGo" or "VCR" should match.
 */
export function skillTriggers(skill: Skill, text: string): boolean {
  if (!skill.trigger || skill.trigger.length === 0) return false;
  const lowerText = text.toLowerCase();
  return skill.trigger.some((t) => t.length > 0 && lowerText.includes(t.toLowerCase()));
}

/**
 * Filter skills that match the given text. Also includes always-on skills
 * (no triggers) if `includeAlwaysOn` is true.
 */
export function filterSkillsByTrigger(skills: Skill[], text: string, includeAlwaysOn = false): Skill[] {
  return skills.filter((s) => skillTriggers(s, text) || (includeAlwaysOn && (!s.trigger || s.trigger.length === 0)));
}

export function skillToMarkdown(skill: ParsedSkill): string {
  const triggers = skill.trigger.length
    ? `triggers: [${skill.trigger.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`
    : 'triggers: []';
  return `---
name: ${skill.name}
description: ${skill.description}
${triggers}
---

${skill.content}`.trim();
}
