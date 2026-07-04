// ============================================================
// vibeAgentGo — Browser Tools (client-side, IndexedDB + iframe sandbox)
// ============================================================

import type { Tool, ToolContext } from '../types/index.js';
import { MemoryStore, loadConfig } from './memory.js';
import { runInSandbox } from '../utils/sandbox.js';

// --- Helpers ---

const getMemoryStore = (ctx: ToolContext): MemoryStore => ctx.env.memoryStore as MemoryStore;

// --- File Tools (IndexedDB workspace) ---

const read_file: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file from the browser workspace (IndexedDB). Returns the file content as a string.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
    },
    required: ['path'],
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    const content = await mem.readFile(args.path);
    if (content === null) return `File not found: ${args.path}`;
    return content;
  },
};

const write_file: Tool = {
  name: 'write_file',
  description: 'Write content to a file in the browser workspace (IndexedDB). Overwrites existing files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
      content: { type: 'string', description: 'The content to write' },
    },
    required: ['path', 'content'],
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    await mem.writeFile(args.path, args.content);
    return `Wrote ${args.content.length} bytes to ${args.path}`;
  },
};

const search_files: Tool = {
  name: 'search_files',
  description: 'Search for files by name or content within the browser workspace. Returns matching file paths or lines containing the pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (filename or text to search for)' },
      target: { type: 'string', enum: ['files', 'content'], description: 'Search filenames (files) or file contents (content). Default: files' },
    },
    required: ['pattern'],
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    const target = args.target || 'files';
    const results = await mem.searchFiles(args.pattern, target);
    return results.length > 0 ? results.join('\n') : 'No matches found';
  },
};

// --- Code Execution (browser sandbox via Function constructor) ---

const run_code: Tool = {
  name: 'run_code',
  description: 'Execute JavaScript code in a sandboxed iframe environment. Captures console.log/error/warn/info and uncaught exceptions. Use log() or console.log() for output. Returns the result value, logs, and error details including stack traces. No access to IndexedDB or the parent page.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds (default: 5000, max: 30000)' },
    },
    required: ['code'],
  },
  handler: async (args) => {
    try {
      const requested = typeof args.timeout === 'number' ? args.timeout : 5000;
      const timeoutMs = Math.max(100, Math.min(requested, 30000));
      const { logs, result, error } = await runInSandbox(args.code, timeoutMs);
      const logsText = logs.length > 0
        ? logs.map(l => `[${l.level.toUpperCase()}] ${l.message}${l.stack ? '\n' + l.stack : ''}`).join('\n')
        : 'No logs';
      if (error) {
        return `Sandbox error: ${error.name}: ${error.message}\n${error.stack || ''}\n\nLogs:\n${logsText}\n\nResult: ${result}`;
      }
      return logs.length > 0 ? `Logs:\n${logsText}\n\nResult: ${result}` : `Result: ${result}`;
    } catch (e: any) {
      return `Sandbox error: ${e.message || String(e)}`;
    }
  },
};

// --- Web Search (Tavily) ---

const web_search: Tool = {
  name: 'web_search',
  description: 'Search the web for current information using a configured search provider. Returns titles, URLs, and short descriptions of search results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const config = loadConfig();
    if (config.searchProvider !== 'tavily' || !config.searchApiKey) {
      return `Web search is not configured. Open Settings → Search Provider and add a Tavily API key.`;
    }

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.searchApiKey}`,
        },
        body: JSON.stringify({
          query: args.query,
          search_depth: 'basic',
          max_results: 8,
          include_answer: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        return `Tavily search error: HTTP ${res.status} ${text}`;
      }

      const data = await res.json() as any;
      const results: string[] = [];

      if (data.answer) {
        results.push(`Answer: ${data.answer}`);
      }

      if (data.results?.length) {
        for (const r of data.results.slice(0, 8)) {
          results.push(`- ${r.title}\n  ${r.url}\n  ${r.content?.slice(0, 250) || ''}`);
        }
      }

      return results.length > 0 ? results.join('\n\n') : `No results for "${args.query}"`;
    } catch (e: any) {
      return `Search error: ${e.message}`;
    }
  },
};

// --- Memory (IndexedDB) ---

const memory_save: Tool = {
  name: 'memory_save',
  description: 'Save a durable fact to persistent memory in the browser (IndexedDB). Survives across sessions. Use for user preferences, environment details, or important facts. Category "user" for facts about the user, "memory" for general notes.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact to remember (declarative)' },
      category: { type: 'string', enum: ['memory', 'user'], description: 'Type: "user" = about the user, "memory" = general. Default: memory' },
    },
    required: ['content'],
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    const id = await mem.saveMemory(args.content, args.category || 'memory');
    return `Saved to ${args.category || 'memory'} memory (id: ${id})`;
  },
};

const memory_search: Tool = {
  name: 'memory_search',
  description: 'Search persistent memory entries in the browser (IndexedDB). Returns matching memory entries by content or category. Use this to recall relevant facts before answering or when the user refers to something from the past.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term or phrase to look for in memory contents' },
      category: { type: 'string', enum: ['memory', 'user'], description: 'Optional filter by category' },
      limit: { type: 'number', description: 'Maximum number of results to return. Default: 10' },
    },
    required: ['query'],
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    const limit = args.limit || 10;
    // Load enough entries to filter by category (if requested) then search by query.
    const all = await mem.searchAllMemory(args.category ? 1000 : limit * 4);
    const filtered = args.category ? all.filter(m => m.category === args.category) : all;
    const query = args.query.toLowerCase();
    const matches = filtered
      .filter(m => m.content.toLowerCase().includes(query))
      .slice(0, limit);
    if (matches.length === 0) return `No memory entries found for "${args.query}".`;
    return matches.map(m => `§ ${m.category}: ${m.content}`).join('\n\n');
  },
};

interface RenderPanelLike {
  getLogs(title: string): { level: string; message: string; stack?: string; timestamp: string }[];
  clearLogs(title: string): void;
}

// --- Render View (iframe, same as before) ---

const render_view: Tool = {
  name: 'render_view',
  description: 'Render HTML/CSS/JS as a live interactive view alongside the chat. The view runs in a sandboxed iframe. Pass HTML directly or reference a file path in the workspace. To debug a rendered view, use the inspect_view tool to retrieve its console logs and uncaught errors.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tab title for the view (same title = update existing)' },
      html: { type: 'string', description: 'Full HTML document to render' },
      path: { type: 'string', description: 'Path to an HTML file in the workspace' },
    },
    required: ['title'],
  },
  handler: async (args, ctx) => {
    let html: string;
    if (args.html) {
      html = args.html;
    } else if (args.path) {
      const mem = getMemoryStore(ctx);
      const content = await mem.readFile(args.path);
      if (content === null) return `File not found: ${args.path}`;
      html = content;
    } else {
      return 'Either html or path is required';
    }
    ctx.emit('render_view', { title: args.title, html });
    return `Rendered "${args.title}" in the view panel (${html.length} bytes)`;
  },
};

// --- Inspect View (debug logs from rendered views) ---

const inspect_view: Tool = {
  name: 'inspect_view',
  description: 'Retrieve captured console logs, errors, warnings, and unhandled exceptions from a rendered view (render_view). Use this to debug HTML/JS mini-apps after rendering them. Set clear=true to reset the captured log buffer after reading.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title of the rendered view to inspect' },
      clear: { type: 'boolean', description: 'Whether to clear the log buffer after reading. Default: false' },
    },
    required: ['title'],
  },
  handler: async (args, ctx) => {
    const panel = ctx.env.renderPanel as RenderPanelLike | undefined;
    if (!panel) return 'No render panel is available';
    const logs = panel.getLogs(args.title);
    if (!logs.length) return `No logs captured for view "${args.title}".`;
    const text = logs.map(l =>
      `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${l.stack ? '\n' + l.stack : ''}`
    ).join('\n');
    if (args.clear) panel.clearLogs(args.title);
    return `Logs for "${args.title}":\n\n${text}`;
  },
};

// --- Registry ---

export function createDefaultTools(): Tool[] {
  return [read_file, write_file, search_files, run_code, web_search, memory_save, memory_search, render_view, inspect_view];
}