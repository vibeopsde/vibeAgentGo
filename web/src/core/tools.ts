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

// --- Patch helpers ---

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function applyReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): { content: string; replacements: number } {
  const occurrences = countOccurrences(content, oldString);
  if (occurrences === 0) {
    throw new Error(`old_string not found in file.`);
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error(
      `old_string is not unique (${occurrences} matches). Use replace_all: true to replace all occurrences, or provide more context to make it unique.`
    );
  }
  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  return { content: next, replacements: replaceAll ? occurrences : 1 };
}

function tryValidateFileSyntax(path: string, content: string): { ok: boolean; error?: string } {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) {
    try {
      JSON.parse(content);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `JSON syntax error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (lower.endsWith('.js') || lower.endsWith('.ts')) {
    try {
      // Lightweight syntax check: parse as a module-like function body. This catches many but not all TS-specific issues.
      new Function(content);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `JS/TS syntax error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { ok: true };
}

interface PatchHunk {
  context: string[];
  removals: string[];
  additions: string[];
}

interface PatchFile {
  path: string;
  hunks: PatchHunk[];
}

function parseV4APatch(patchText: string): PatchFile[] {
  const files: PatchFile[] = [];
  const blocks = patchText.split('*** Begin Patch').slice(1);
  for (const block of blocks) {
    const endIdx = block.indexOf('*** End Patch');
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const fileMatch = body.match(/\*\*\* Update File:\s*(.+)/);
    if (!fileMatch) continue;
    const path = fileMatch[1].trim();
    const hunks: PatchHunk[] = [];
    const lines = body.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const hunk: PatchHunk = { context: [], removals: [], additions: [] };
        i++;
        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('***')) {
          const l = lines[i];
          if (l.startsWith('-')) hunk.removals.push(l.slice(1));
          else if (l.startsWith('+')) hunk.additions.push(l.slice(1));
          else if (l.length > 0) hunk.context.push(l);
          i++;
        }
        hunks.push(hunk);
      } else {
        i++;
      }
    }
    files.push({ path, hunks });
  }
  return files;
}

function findContextIndex(lines: string[], context: string[], removals: string[]): number {
  const searchLines = context.length > 0 && removals.length > 0
    ? context.concat(removals)
    : context.length > 0
    ? context
    : removals;
  if (searchLines.length === 0) return -1;
  for (let i = 0; i <= lines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (lines[i + j] !== searchLines[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function applyHunk(lines: string[], hunk: PatchHunk): string[] {
  const startIdx = findContextIndex(lines, hunk.context, hunk.removals);
  if (startIdx < 0) {
    throw new Error(
      `Could not find patch context. Expected:\n${hunk.context.concat(hunk.removals).join('\n')}`
    );
  }
  // The context is kept; only the removal lines are replaced by the additions.
  const removalStartIdx = startIdx + hunk.context.length;
  const removeCount = hunk.removals.length > 0 ? hunk.removals.length : 0;
  const before = lines.slice(0, removalStartIdx);
  const after = lines.slice(removalStartIdx + removeCount);
  return before.concat(hunk.additions).concat(after);
}

async function applyV4APatch(
  mem: MemoryStore,
  patchText: string
): Promise<{ path: string; status: string; error?: string }[]> {
  const files = parseV4APatch(patchText);
  const results: { path: string; status: string; error?: string }[] = [];
  for (const file of files) {
    let content = await mem.readFile(file.path);
    if (content === null) {
      content = '';
    }
    const lines = content.split('\n');
    let nextLines = lines;
    try {
      for (const hunk of file.hunks) {
        nextLines = applyHunk(nextLines, hunk);
      }
      const newContent = nextLines.join('\n');
      await mem.writeFile(file.path, newContent);
      results.push({ path: file.path, status: 'patched' });
    } catch (e) {
      results.push({
        path: file.path,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

const patch: Tool = {
  name: 'patch',
  description:
    'Apply targeted edits to text files in the browser workspace (IndexedDB). Two modes: replace (find old_string and replace with new_string) or patch (apply a V4A multi-file patch block). For replace, old_string must be unique unless replace_all is true. For patch, use V4A format: *** Begin Patch / *** Update File: path / @@ context @@ / -old / +new / *** End Patch.',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['replace', 'patch'],
        description: 'replace = single find/replace in one file; patch = multi-file V4A patch block',
      },
      path: {
        type: 'string',
        description: 'Relative path to the file for mode=replace (required for replace)',
      },
      old_string: {
        type: 'string',
        description: 'Exact text to find for mode=replace',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text for mode=replace',
      },
      replace_all: {
        type: 'boolean',
        description: 'If true, replace all occurrences of old_string in mode=replace. Default false.',
      },
      patch: {
        type: 'string',
        description: 'V4A multi-file patch text for mode=patch',
      },
    },
    required: ['mode'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const mode = asString(args.mode);
    if (mode === 'replace') {
      const path = asString(args.path);
      const oldString = asString(args.old_string);
      const newString = asString(args.new_string);
      const replaceAll = asBoolean(args.replace_all);
      if (!path) return 'Error: path is required for mode=replace';
      if (!oldString) return 'Error: old_string is required for mode=replace';
      const content = await mem.readFile(path);
      if (content === null) return `File not found: ${path}`;
      try {
        const { content: updated, replacements } = applyReplace(content, oldString, newString, replaceAll);
        const validation = tryValidateFileSyntax(path, updated);
        if (!validation.ok) {
          return `Error: ${validation.error}\nNo changes were written to ${path}.`;
        }
        await mem.writeFile(path, updated);
        return `Replaced ${replacements} occurrence(s) in ${path}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (mode === 'patch') {
      const patchText = asString(args.patch);
      if (!patchText) return 'Error: patch is required for mode=patch';
      const results = await applyV4APatch(mem, patchText);
      const lines = results.map((r) => {
        if (r.status === 'patched') return `${r.path}: patched`;
        return `${r.path}: error — ${r.error}`;
      });
      const ok = results.every((r) => r.status === 'patched');
      return ok ? lines.join('\n') : `Some files failed:\n${lines.join('\n')}`;
    }
    return `Error: unknown mode ${mode}`;
  },
};

// --- Execution Tools ---

async function runInSandbox(
  code: string,
  ctx: ToolContext,
  timeoutMs: number
): Promise<{ result: string; error?: string; logsText: string }> {
  const { runInWorkerSandbox } = await import('../utils/worker-sandbox.js');
  const mem = getMemoryStore(ctx);
  const { logs, result, error, files } = await runInWorkerSandbox(code, {
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
    return {
      result,
      error: `Worker error: ${error.name}: ${error.message}\n${error.stack || ''}`,
      logsText,
    };
  }
  return { result, logsText };
}

const run_code: Tool = {
  name: 'run_code',
  description:
    'Execute a short JavaScript expression or small function in the Web Worker sandbox. Use for quick calculations, date formatting, parsing, filtering, or simple transformations. Returns the evaluated result or console logs. For complex multi-step tasks, file I/O, CDN imports, or interactive views use run instead.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript expression or small function to evaluate. Available globals: console, async/await. No DOM, no fs, no CDN imports.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 10000, max: 30000)' },
    },
    required: ['code'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const timeoutMs = Math.max(1000, Math.min(asNumber(args.timeout, 10000), 30000));
    const { result, error, logsText } = await runInSandbox(asString(args.code), ctx, timeoutMs);
    if (error) {
      return `${error}\n\nLogs:\n${logsText}\n\nResult: ${result}`;
    }
    return logsText !== 'No logs' ? `Logs:\n${logsText}\n\nResult: ${result}` : `Result: ${result}`;
  },
};

const run: Tool = {
  name: 'run',
  description:
    'Execute JavaScript in the Web Worker sandbox for complex, multi-step tasks. Capabilities: importScripts() for CDN libraries (sql.js, SQLite, CSV parsers, charting libs, etc.), fs.readFile/writeFile/listFiles for workspace I/O, render(title, html) to display interactive views in the Render Panel, async/await. Use for multi-step data processing, CSV→SQLite queries, file transformations, and long-running calculations. For simple calculations use run_code; for pure UI views use run_app. 30s timeout, no DOM access. Use console.log() for output.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute. Available globals: fs (workspace I/O: fs.readFile, fs.writeFile, fs.listFiles), console, importScripts (CDN imports), render(title, html) to show interactive views, async/await.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 60000)' },
    },
    required: ['code'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const timeoutMs = Math.max(1000, Math.min(asNumber(args.timeout, 30000), 60000));
    const { result, error, logsText } = await runInSandbox(asString(args.code), ctx, timeoutMs);
    if (error) {
      return `${error}\n\nLogs:\n${logsText}\n\nResult: ${result}`;
    }
    return logsText !== 'No logs' ? `Logs:\n${logsText}\n\nResult: ${result}` : `Result: ${result}`;
  },
};

const run_app: Tool = {
  name: 'run_app',
  description:
    'Render an interactive HTML/CSS/JS view in the Render Panel. Use for charts, dashboards, calculators, data visualizations, or any interactive UI. The HTML is injected into the Render Panel; if you need dynamic data, generate it first with run_code or run and embed the values directly in the HTML. No file I/O, no CDN imports.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title shown in the Render Panel tab' },
      html: { type: 'string', description: 'Self-contained HTML string. Inline CSS/JS are allowed; external resources are blocked by CSP.' },
    },
    required: ['title', 'html'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const title = asString(args.title);
    const html = asString(args.html);
    if (!html.trim()) return 'No HTML provided.';
    ctx.emit('render_view', { title, html });
    return `Rendered "${title}" in the Render Panel.`;
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
    patch,
    run,
    run_code,
    run_app,
    web_search,
    memory_save,
    memory_search,
    state_view,
    state_update,
    error_log,
  ];
}