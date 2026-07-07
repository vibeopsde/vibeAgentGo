// ============================================================
// vibeAgentGo — Browser Tools (client-side, IndexedDB + Web Worker sandbox)
// Single execution gateway: run (Web Worker)
// ============================================================

import type { Tool, ToolContext } from '../types/index.js';
import { MemoryStore, loadConfig } from './memory.js';
import { renderStateDashboard } from '../render/state_dashboard.js';
import { readLogs, type LogLevel } from './logger.js';
import {
  loadState,
  saveState,
  updateState,
  deleteTask,
  deleteIssue,
  formatStateSummary,
  isValidTaskStatus,
  isValidIssueSeverity,
  isValidIssueStatus,
  generateId,
} from './state.js';

import { validateArgs } from '../utils/schema_validate.js';

// --- Helpers ---

const getMemoryStore = (ctx: ToolContext): MemoryStore => ctx.env.memoryStore!;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v)) : [];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : [];
}

// --- File Tools (IndexedDB workspace) ---

const read_file: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a text file from the browser workspace (IndexedDB). Returns the file content as a string. Use offset (1-indexed line number to start from) and limit (max lines to read) for large files. Lines are prefixed with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
      offset: { type: 'number', description: 'Line number to start reading from (1-indexed). Default: 1' },
      limit: { type: 'number', description: 'Maximum number of lines to read. Default: all lines' },
    },
    required: ['path'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const path = asString(args.path);
    const content = await mem.readFile(path);
    if (content === null) return `File not found: ${path}`;

    const offset = asNumber(args.offset, 1);
    const limit = asNumber(args.limit, 0);

    // If no offset/limit, return the full content
    if (offset <= 1 && limit <= 0) return content;

    const lines = content.split('\n');
    const start = Math.max(0, offset - 1);
    const end = limit > 0 ? start + limit : lines.length;
    const slice = lines.slice(start, end);

    // Prefix with line numbers like Hermes: LINE_NUM|CONTENT
    const numbered = slice.map((line, i) => `${start + i + 1}|${line}`).join('\n');
    const totalLines = lines.length;
    const shownFrom = start + 1;
    const shownTo = Math.min(end, totalLines);
    return `${numbered}\n\n(shown ${shownFrom}-${shownTo} of ${totalLines} lines)`;
  },
};

const read_pdf: Tool = {
  name: 'read_pdf',
  description:
    'Extract text content from a PDF file in the browser workspace (IndexedDB). Returns the extracted text. If the PDF is a scanned image, text extraction may be limited.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the PDF file within the workspace' },
    },
    required: ['path'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const path = asString(args.path);
    const content = await mem.readFile(path);
    if (content === null) return `File not found: ${path}`;
    try {
      const pdfjs = await import('pdfjs-dist');
      const pdfjsLib = pdfjs.default || pdfjs;
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
      }
      const base64 = content.startsWith('data:') ? content.split(',')[1] : content;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const contentItems = await page.getTextContent();
        const pageText = contentItems.items.map((item) => (item as { str: string }).str).join(' ');
        text += `\n\n--- Page ${i} ---\n\n${pageText}`;
      }
      return text.trim() || 'No text found in PDF.';
    } catch (e) {
      return `PDF extraction error: ${e instanceof Error ? e.message : String(e)}`;
    }
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
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    await mem.writeFile(asString(args.path), asString(args.content));
    return `Wrote ${asString(args.content).length} bytes to ${asString(args.path)}`;
  },
};

const search_files: Tool = {
  name: 'search_files',
  description:
    'Search for files by name or content within the browser workspace. Returns matching file paths or lines containing the pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (filename or text to search for)' },
      target: {
        type: 'string',
        enum: ['files', 'content'],
        description: 'Search filenames (files) or file contents (content). Default: files',
      },
    },
    required: ['pattern'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const target = asString(args.target, 'files');
    const results = await mem.searchFiles(asString(args.pattern), target as 'files' | 'content');
    return results.length > 0 ? results.join('\n') : 'No matches found';
  },
};

// --- Execution Gateway (Web Worker with CDN imports + workspace I/O + render) ---

const run: Tool = {
  name: 'run',
  description:
    'Execute JavaScript in the sandbox — the single gateway to the execution environment. Runs in a Web Worker. Capabilities: importScripts() for CDN libraries (sql.js for SQLite, csv parsers, charting libs, etc.), fs.readFile/writeFile/listFiles for workspace I/O, render(title, html) to display interactive views in the Render Panel, async/await. Use for ALL code execution: data processing, CSV→SQLite queries, file transformations, calculations, and building interactive HTML/CSS/JS mini-apps. 30s timeout, no DOM access. Use console.log() for output.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute. Available globals: fs (workspace I/O: fs.readFile, fs.writeFile, fs.listFiles), console, importScripts (CDN imports), render(title, html) to show interactive views, async/await.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 60000)' },
    },
    required: ['code'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const { runInWorkerSandbox } = await import('../utils/worker-sandbox.js');
    const mem = getMemoryStore(ctx);
    const timeoutMs = Math.max(1000, Math.min(asNumber(args.timeout, 30000), 60000));

    try {
      const { logs, result, error, files } = await runInWorkerSandbox(asString(args.code), {
        readFile: async (path) => mem.readFile(path),
        writeFile: async (path, content) => mem.writeFile(path, content),
        listFiles: async () => mem.listFiles(),
        onRender: (title, html) => {
          ctx.emit('render_view', { title, html });
        },
        timeoutMs,
      });

      // Persist any files the worker wrote via the bridge
      if (files && files.length > 0) {
        for (const f of files) {
          await mem.writeFile(f.path, f.content);
        }
      }

      const logsText =
        logs.length > 0
          ? logs.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join('\n')
          : 'No logs';

      if (error) {
        return `Worker error: ${error.name}: ${error.message}\n${error.stack || ''}\n\nLogs:\n${logsText}\n\nResult: ${result}`;
      }
      return logs.length > 0 ? `Logs:\n${logsText}\n\nResult: ${result}` : `Result: ${result}`;
    } catch (e) {
      return `Worker error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// --- Web Search (Tavily) ---

const web_search: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information using a configured search provider. Returns titles, URLs, and short descriptions of search results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
  handler: async (args: Record<string, unknown>) => {
    const config = loadConfig();
    if (config.searchProvider !== 'tavily' || !config.searchApiKey) {
      return `Web search is not configured. Open Settings → Search Provider and add a Tavily API key.`;
    }
    const query = asString(args.query);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.searchApiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 8,
          include_answer: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        return `Tavily search error: HTTP ${res.status} ${text}`;
      }

      const data = (await res.json()) as Record<string, unknown>;
      const results: string[] = [];

      if (typeof data.answer === 'string') {
        results.push(`Answer: ${data.answer}`);
      }

      const rawResults = data.results;
      if (Array.isArray(rawResults)) {
        for (const r of rawResults.slice(0, 8)) {
          if (typeof r === 'object' && r !== null) {
            const title = asString(r.title);
            const url = asString(r.url);
            const content = asString(r.content).slice(0, 250);
            results.push(`- ${title}\n  ${url}\n  ${content}`);
          }
        }
      }

      return results.length > 0 ? results.join('\n\n') : `No results for "${query}"`;
    } catch (e: unknown) {
      return `Search error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// --- Memory (IndexedDB) ---

const memory_save: Tool = {
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

const memory_search: Tool = {
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
    // Load enough entries to filter by category (if requested) then search by query.
    const all = await mem.searchAllMemory(category ? 1000 : limit * 4);
    const filtered = category ? all.filter((m) => m.category === category) : all;
    const query = asString(args.query).toLowerCase();
    const matches = filtered.filter((m) => m.content.toLowerCase().includes(query)).slice(0, limit);
    if (matches.length === 0) return `No memory entries found for "${query}".`;
    return matches.map((m) => `§ ${m.category}: ${m.content}`).join('\n\n');
  },
};

// --- Project State (agent_state.json) ---

const state_view: Tool = {
  name: 'state_view',
  description:
    'Read and summarize the current project state from agent_state.json in the workspace. Use this at the start of a complex task or when the user refers to project status, roadmap, open issues, or lessons learned.',
  parameters: {
    type: 'object',
    properties: {
      render: {
        type: 'boolean',
        description: 'If true, also render an interactive dashboard view of the project state. Default: false',
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const state = await loadState(mem);
    if (asBoolean(args.render)) {
      const isDark = ctx.env.isDark ?? true;
      const html = renderStateDashboard(state, isDark);
      ctx.emit('render_view', { title: 'Project State', html });
    }
    return formatStateSummary(state);
  },
};

const state_update: Tool = {
  name: 'state_update',
  description: `Update the project state in agent_state.json. This is the shared scratchpad for long-running projects. You can set the goal/phase, add or update tasks/issues, record lessons learned, and track files. Examples:
- {"goal": "Build a task dashboard", "current_phase": "implementation"}
- {"tasks": [{"id": "t1", "title": "Wire UI", "status": "done"}]}
- {"open_issues": [{"id": "i1", "title": "CORS error on mobile", "severity": "high", "status": "open"}]}
- {"lessons_learned": ["Service worker must cache index.html"]}
- {"files": ["src/core/state.ts"]}
Use state_view first to see existing ids. Set delete_task or delete_issue to remove entries.`,
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Overall project goal' },
      current_phase: { type: 'string', description: 'Current phase (e.g. planning, implementation, testing, review)' },
      tasks: {
        type: 'array',
        description: 'Tasks to add or update. Each task must have a title; id is optional for new tasks.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'] },
            depends_on: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
        },
      },
      open_issues: {
        type: 'array',
        description: 'Issues to add or update. Each issue must have a title; id is optional for new issues.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            status: { type: 'string', enum: ['open', 'closed'] },
            notes: { type: 'string' },
          },
        },
      },
      lessons_learned: { type: 'array', items: { type: 'string' }, description: 'New lessons learned to append' },
      files: { type: 'array', items: { type: 'string' }, description: 'File paths to track in the project state' },
      delete_task: { type: 'string', description: 'ID of a task to delete' },
      delete_issue: { type: 'string', description: 'ID of an issue to delete' },
      render: {
        type: 'boolean',
        description: 'If true, render the Project State dashboard after updating. Default: false',
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    let state = await loadState(mem);

    const updates: Record<string, unknown> = {};
    if (typeof args.goal === 'string') updates.goal = args.goal;
    if (typeof args.current_phase === 'string') updates.current_phase = args.current_phase;
    if (Array.isArray(args.tasks)) updates.tasks = asRecordArray(args.tasks);
    if (Array.isArray(args.open_issues)) updates.open_issues = asRecordArray(args.open_issues);
    if (Array.isArray(args.lessons_learned)) updates.lessons_learned = asStringArray(args.lessons_learned);
    if (Array.isArray(args.files)) updates.files = asStringArray(args.files);

    state = updateState(state, updates);

    if (typeof args.delete_task === 'string') {
      state = deleteTask(state, args.delete_task);
    }
    if (typeof args.delete_issue === 'string') {
      state = deleteIssue(state, args.delete_issue);
    }

    await saveState(mem, state);

    if (asBoolean(args.render)) {
      const isDark = ctx.env.isDark ?? true;
      const html = renderStateDashboard(state, isDark);
      ctx.emit('render_view', { title: 'Project State', html });
    }

    return `Updated agent_state.json.\n\n${formatStateSummary(state)}`;
  },
};

// --- Error Log Analysis ---

const error_log: Tool = {
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
      level === 'debug' ? ['debug', 'info', 'warn', 'error', 'fatal']
      : level === 'info' ? ['info', 'warn', 'error', 'fatal']
      : level === 'warn' ? ['warn', 'error', 'fatal']
      : level === 'error' ? ['error', 'fatal']
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

export function createDefaultTools(): Tool[] {
  return [
    read_file,
    read_pdf,
    write_file,
    search_files,
    run,
    web_search,
    memory_save,
    memory_search,
    state_view,
    state_update,
    error_log,
  ];
}