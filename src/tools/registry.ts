// ============================================================
// HAG — Tool Registry
// ============================================================

import type { Tool, ToolContext } from '../types/index.js';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, resolve, relative, sep } from 'path';
import { quickjsEval } from './quickjs.js';

// --- Security: resolve paths within workspace only ---

function resolvePath(workspace: string, path: string): string {
  const resolved = resolve(workspace, path);
  const rel = relative(workspace, resolved);
  // Prevent path traversal outside workspace
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`Path "${path}" escapes workspace`);
  }
  return resolved;
}

// --- File Tools ---

const read_file: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file from the workspace. Returns the file content as a string.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
    },
    required: ['path'],
  },
  handler: async (args, ctx) => {
    try {
      const fullPath = resolvePath(ctx.workspace, args.path);
      const content = readFileSync(fullPath, 'utf-8');
      return content;
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  },
};

const write_file: Tool = {
  name: 'write_file',
  description: 'Write content to a file in the workspace. Creates parent directories if needed. Overwrites existing files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
      content: { type: 'string', description: 'The content to write' },
    },
    required: ['path', 'content'],
  },
  handler: async (args, ctx) => {
    const fullPath = resolvePath(ctx.workspace, args.path);
    const dir = join(fullPath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, args.content, 'utf-8');
    return `Wrote ${args.content.length} bytes to ${args.path}`;
  },
};

const search_files: Tool = {
  name: 'search_files',
  description: 'Search for files by name or content within the workspace. Returns matching file paths or lines containing the pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (filename glob or text to search for)' },
      target: { type: 'string', enum: ['files', 'content'], description: 'Search for filenames (files) or file contents (content). Default: files' },
    },
    required: ['pattern'],
  },
  handler: async (args, ctx) => {
    const target = args.target || 'files';
    const results: string[] = [];

    function walk(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (target === 'files') {
          if (entry.name.includes(args.pattern)) {
            results.push(relative(ctx.workspace, fullPath));
          }
        } else if (target === 'content') {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (line.includes(args.pattern)) {
                results.push(`${relative(ctx.workspace, fullPath)}:${i + 1}: ${line.trim()}`);
              }
            });
          } catch { /* skip binary */ }
        }
      }
    }

    try {
      walk(ctx.workspace);
    } catch (e: any) {
      return `Error searching: ${e.message}`;
    }

    return results.length > 0 ? results.join('\n') : 'No matches found';
  },
};

// --- Code Execution ---

const run_code: Tool = {
  name: 'run_code',
  description: 'Execute JavaScript code in a sandboxed QuickJS environment. The code runs isolated with no access to Android APIs or the filesystem. Use log() or console.log() for output. Returns the result value and captured logs.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute' },
    },
    required: ['code'],
  },
  handler: async (args, ctx) => {
    try {
      return await quickjsEval(args.code, { workspace: ctx.workspace, env: ctx.env });
    } catch (e: any) {
      return `Sandbox error: ${e.message}`;
    }
  },
};

// --- Web Search ---

const web_search: Tool = {
  name: 'web_search',
  description: 'Search the web for information. Returns titles, URLs, and descriptions of search results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
  handler: async (args) => {
    // In the mobile app this will use the native HTTP client.
    // For CLI testing, use a simple fetch to a search API.
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`);
      const data = await res.json() as any;
      const results: string[] = [];

      if (data.AbstractText) {
        results.push(`${data.AbstractText}\nSource: ${data.AbstractURL || 'DuckDuckGo'}`);
      }

      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 8)) {
          if (topic.Text) {
            results.push(`- ${topic.Text}\n  ${topic.FirstURL || ''}`);
          }
        }
      }

      return results.length > 0 ? results.join('\n\n') : `No results for "${args.query}"`;
    } catch (e: any) {
      return `Search error: ${e.message}`;
    }
  },
};

// --- Memory ---

const memory_save: Tool = {
  name: 'memory_save',
  description: 'Save a durable fact to persistent memory. This survives across sessions. Use for user preferences, environment details, or important facts. Do NOT save temporary task state or progress logs. Category "user" for facts about the user, "memory" for general notes.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact to remember (declarative, e.g. "User prefers concise responses")' },
      category: { type: 'string', enum: ['memory', 'user'], description: 'Type of memory. "user" = about the user, "memory" = general notes. Default: memory' },
    },
    required: ['content'],
  },
  handler: async (args, ctx) => {
    // memory_save needs access to the MemoryStore — injected via env
    const saveFn = ctx.env.__memorySave as unknown as ((content: string, category: 'memory' | 'user') => number) | undefined;
    if (!saveFn) return 'Memory store not available';
    const id = saveFn(args.content, args.category || 'memory');
    return `Saved to ${args.category || 'memory'} memory (id: ${id})`;
  },
};

// --- Render View ---

const render_view: Tool = {
  name: 'render_view',
  description: 'Render HTML/CSS/JS as a live interactive view alongside the chat. Use this to show visualizations, dashboards, mini web-apps, calculators, or any interactive UI to the user. The view runs in a sandboxed WebView. You can either pass HTML directly or reference a file path in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tab title for the view (use same title to update existing view)' },
      html: { type: 'string', description: 'Full HTML document to render (alternative to path)' },
      path: { type: 'string', description: 'Path to an HTML file in the workspace (alternative to html)' },
    },
    required: ['title'],
  },
  handler: async (args, ctx) => {
    let html: string;
    if (args.html) {
      html = args.html;
    } else if (args.path) {
      const fullPath = resolvePath(ctx.workspace, args.path);
      try {
        html = readFileSync(fullPath, 'utf-8');
      } catch (e: any) {
        return `Error reading view file: ${e.message}`;
      }
    } else {
      return 'Either html or path is required';
    }

    ctx.emit('render_view', { title: args.title, html });
    return `Rendered "${args.title}" in the view panel (${html.length} bytes)`;
  },
};

// --- Registry ---

export function createDefaultTools(): Tool[] {
  return [read_file, write_file, search_files, run_code, web_search, memory_save, render_view];
}

export function dispatchTool(
  toolName: string,
  args: any,
  ctx: ToolContext,
  tools: Tool[]
): Promise<string> {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    return Promise.resolve(`Unknown tool: ${toolName}`);
  }
  return tool.handler(args, ctx);
}