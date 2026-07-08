// ============================================================
// vibeAgentGo — Browser Tools (client-side, IndexedDB + Web Worker sandbox)
// Single execution gateway: run (Web Worker)
// ============================================================

import type { Tool, ToolContext } from '../types/index.js';
import { MemoryStore, loadConfig } from './memory.js';
import { readLogs, type LogLevel } from './logger.js';
import { openDB, resetDBConnection } from './db.js';

import { validateArgs } from '../utils/schema_validate.js';
import sandboxRef from './refs/sandbox.md?raw';
import uiRef from './refs/ui.md?raw';
import toolsRef from './refs/tools.md?raw';

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

    const MAX_CHARS = 8000;
    const DEFAULT_LIMIT = 200;
    const offset = Math.max(1, asNumber(args.offset, 1));
    const limit = asNumber(args.limit, 0);
    const effectiveLimit = limit > 0 ? limit : DEFAULT_LIMIT;

    const lines = content.split('\n');
    const totalLines = lines.length;
    const start = Math.max(0, offset - 1);
    const requestedEnd = start + effectiveLimit;
    const slice = lines.slice(start, requestedEnd);

    let numbered = slice.map((line, i) => `${start + i + 1}|${line}`).join('\n');

    // Truncate at character level if still too large for a single LLM message.
    let truncated = false;
    if (numbered.length > MAX_CHARS) {
      numbered = numbered.slice(0, MAX_CHARS) + '\n... (truncated)';
      truncated = true;
    }

    const shownTo = Math.min(requestedEnd, totalLines);
    const shownFrom = start + 1;
    const truncationNote = truncated ? ' — truncated to fit model context' : '';
    return `${numbered}\n\n(shown ${shownFrom}-${shownTo} of ${totalLines} lines${truncationNote})`;
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
    const MAX_RESULTS = 50;
    const shown = results.slice(0, MAX_RESULTS);
    const more = results.length > MAX_RESULTS ? `\n... and ${results.length - MAX_RESULTS} more matches` : '';
    return results.length > 0 ? shown.join('\n') + more : 'No matches found';
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
    listFiles: async () => mem.listFilePaths(),
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

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... (truncated)';
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
    const MAX_CHARS = 4000;
    if (error) {
      return `${truncateText(error, MAX_CHARS)}\n\nLogs:\n${truncateText(logsText, MAX_CHARS)}\n\nResult: ${truncateText(result, MAX_CHARS)}`;
    }
    const out = logsText !== 'No logs' ? `Logs:\n${truncateText(logsText, MAX_CHARS)}\n\nResult: ${truncateText(result, MAX_CHARS)}` : `Result: ${truncateText(result, MAX_CHARS)}`;
    return out;
  },
};

const run: Tool = {
  name: 'run',
  description:
    'Execute JavaScript in the Web Worker sandbox for complex, multi-step tasks. Capabilities: importScripts() for CDN libraries (sql.js, SQLite, CSV parsers, charting libs, etc.), fs.readFile/writeFile/listFiles for workspace I/O, render(title, html) to display interactive views in a dedicated window, async/await. Use for multi-step data processing, CSV→SQLite queries, file transformations, and long-running calculations. For simple calculations use run_code; for pure UI views use run_app. 30s timeout, no DOM access. Use console.log() for output.',
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
    const MAX_CHARS = 4000;
    if (error) {
      return `${truncateText(error, MAX_CHARS)}\n\nLogs:\n${truncateText(logsText, MAX_CHARS)}\n\nResult: ${truncateText(result, MAX_CHARS)}`;
    }
    return logsText !== 'No logs'
      ? `Logs:\n${truncateText(logsText, MAX_CHARS)}\n\nResult: ${truncateText(result, MAX_CHARS)}`
      : `Result: ${truncateText(result, MAX_CHARS)}`;
  },
};

const run_app: Tool = {
  name: 'run_app',
  description:
    'Open an interactive HTML/CSS/JS view in its own dedicated window. The HTML is read from a workspace file, not passed inline. Use for charts, dashboards, calculators, data visualizations, or any interactive UI. Each call opens a new independent window. Workflow: first write the HTML to a file with write_file, then call run_app with the file path. No CDN imports.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title shown in the window title bar' },
      file: { type: 'string', description: 'Path to an HTML file in the workspace (e.g. "app.html"). The file content is rendered in a sandboxed iframe.' },
    },
    required: ['title', 'file'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const title = asString(args.title);
    const file = asString(args.file);
    if (!file.trim()) return 'No file path provided.';
    const mem = getMemoryStore(ctx);
    const html = await mem.readFile(file);
    if (html === null) return `File not found: ${file}. Use write_file first to create the HTML file.`;
    if (!html.trim()) return `File "${file}" is empty.`;
    ctx.emit('render_view', { title, html });
    return `Opened "${title}" from ${file} in a new window.`;
  },
};

// --- Help / Reference ---

const HELP_TOPICS: Record<string, string> = {
  sandbox: 'Sandbox-Iframe: run_app, Event-Listener, Canvas, localStorage, Bridge-API (window.vibeAgentGo)',
  ui: 'UI/CSS: Theme-Variablen, Window-Manager-Struktur, App-Factory-Muster',
  tools: 'Tools: alle verfügbaren Tools mit Parametern und typischen Workflows',
};

const HELP_BUILTINS: Record<string, string> = {
  sandbox: sandboxRef,
  ui: uiRef,
  tools: toolsRef,
};

const help: Tool = {
  name: 'help',
  description:
    'Read built-in reference documentation. Available topics: "sandbox" (iframe, events, canvas, bridge API), "ui" (CSS variables, window-manager structure, app pattern), "tools" (all tool parameters and workflows). Call without arguments to list topics. Call with a topic to get the full reference.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Topic to read: "sandbox", "ui", or "tools". Omit to list all topics.',
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const topic = asString(args.topic);
    if (!topic) {
      return 'Available help topics:\n' +
        Object.entries(HELP_TOPICS).map(([k, v]) => `  - ${k}: ${v}`).join('\n') +
        '\n\nCall help({ topic: "..." }) to read a topic.';
    }
    // Try built-in references first
    const builtIn = HELP_BUILTINS[topic];
    if (builtIn) return builtIn;
    // Try workspace file (e.g. help({ topic: "custom.md" }) reads ./custom.md)
    return `Unknown topic: "${topic}". Available topics: ${Object.keys(HELP_TOPICS).join(', ')}`;
  },
};

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

// --- YouTube Transcript ---

export function extractVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // If the user passed an 11-character video ID directly, accept it.
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface TranscriptLine {
  text: string;
  start: number;
  duration?: number;
}

interface TranscriptResponse {
  video_id: string;
  title?: string;
  language?: string;
  transcript: TranscriptLine[];
}

function formatTranscript(data: TranscriptResponse, withTimestamps: boolean): string {
  const header = data.title ? `[${data.title}]\n\n` : '';
  if (withTimestamps) {
    return header + data.transcript.map((line) => `[${formatTimestamp(line.start)}] ${line.text}`).join('\n');
  }
  return header + data.transcript.map((line) => line.text).join(' ');
}

const youtube_transcript: Tool = {
  name: 'youtube_transcript',
  description:
    'Fetch the transcript of a YouTube video. Accepts a full YouTube URL, a youtu.be short link, a YouTube Shorts/Embed/Live URL, or a raw 11-character video ID. Requires a YouTube transcript proxy to be configured in Settings.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'YouTube URL, short link, or raw video ID',
      },
      language: {
        type: 'string',
        description: 'Preferred transcript language (e.g. "de", "en"). Defaults to the language configured in Settings.',
      },
      with_timestamps: {
        type: 'boolean',
        description: 'If true, include timestamps for each segment. Default: false.',
      },
    },
    required: ['url'],
  },
  handler: async (args: Record<string, unknown>) => {
    const config = loadConfig();
    const proxyUrl = config.youtubeProxyUrl?.trim();
    if (!proxyUrl) {
      return 'YouTube transcript proxy is not configured. Open Settings → YouTube and set the proxy URL (e.g. https://vag.vibeops.de/api/youtube/).';
    }

    const videoId = extractVideoId(asString(args.url));
    if (!videoId) {
      return `Could not extract a valid YouTube video ID from "${asString(args.url)}". Please provide a standard youtube.com/watch?v=... link, a youtu.be/... short link, or the 11-character video ID.`;
    }

    const defaultLanguage = config.youtubeLanguage || config.language || 'en';
    const requestedLanguage = asString(args.language, defaultLanguage);
    const withTimestamps = asBoolean(args.with_timestamps);

    const base = proxyUrl.endsWith('/') ? proxyUrl : `${proxyUrl}/`;
    const endpoint = `${base}transcript`;

    const params = new URLSearchParams({
      video_id: videoId,
      language: requestedLanguage,
      with_timestamps: String(withTimestamps),
    });

    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const text = await res.text().catch(() => `HTTP ${res.status}`);
      if (!res.ok) {
        return `YouTube transcript proxy error: HTTP ${res.status} ${text}`;
      }

      let data: TranscriptResponse;
      try {
        data = JSON.parse(text) as TranscriptResponse;
      } catch (e) {
        return `Invalid JSON from transcript proxy: ${text.slice(0, 200)}`;
      }

      if (!Array.isArray(data.transcript) || data.transcript.length === 0) {
        return `No transcript available for video ${videoId}${data.language ? ` (language: ${data.language})` : ''}. The video may have captions disabled or no captions in the requested language.`;
      }

      return formatTranscript(data, withTimestamps);
    } catch (e) {
      return `YouTube transcript fetch failed: ${e instanceof Error ? e.message : String(e)}`;
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

// --- Error Log Analysis ---

const sys_check: Tool = {
  name: 'sys_check',
  description:
    "Deterministic health check of the browser-side system. Verifies IndexedDB connection, all object stores, session CRUD, memory, files, logs, configuration, and the worker sandbox. Returns a structured report. Always safe to run. Does NOT require any parameters.",
  parameters: {
    type: 'object',
    properties: {
      repair: {
        type: 'boolean',
        description: 'If true, attempt to repair a stale database connection by closing and reopening it. Default: false.',
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext) => {
    const mem = getMemoryStore(ctx);
    const repair = asBoolean(args.repair);
    interface Summary { total: number; passed: number; failed: number; warnings: number; totalMs: number; }
    const report: {
      timestamp: string;
      userAgent: string;
      language: string;
      repairAttempted: boolean;
      checks?: { name: string; status: 'ok' | 'fail' | 'warn'; ms: number; detail?: unknown }[];
      summary?: Summary;
    } = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      repairAttempted: repair,
    };

    const checks: { name: string; status: 'ok' | 'fail' | 'warn'; ms: number; detail?: unknown }[] = [];
    const start = performance.now();

    function add(name: string, status: 'ok' | 'fail' | 'warn', detail?: unknown) {
      checks.push({ name, status, ms: Math.round(performance.now() - start), detail });
    }

    // 1. Open DB and inspect schema
    try {
      if (repair) {
        await resetDBConnection();
      }
      const db = await openDB();
      const storeNames = Array.from(db.objectStoreNames);
      add('db_connection', 'ok', { version: db.version, stores: storeNames });

      const expectedStores = ['memory', 'sessions', 'skills', 'files', 'logs'];
      const missing = expectedStores.filter((s) => !storeNames.includes(s));
      if (missing.length > 0) add('db_schema', 'fail', { missingStores: missing });
      else add('db_schema', 'ok');
    } catch (e) {
      add('db_connection', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 2. Sessions store: list, create, get, delete
    const testSessionId = `sys-check-${Date.now()}`;
    try {
      const listBefore = await mem.listSessions();
      add('sessions_list', 'ok', { count: listBefore.length });

      await mem.saveSession({
        id: testSessionId,
        title: 'System Check Session',
        messages: [{ role: 'user', content: 'ping' }],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      add('sessions_create', 'ok');

      const got = await mem.getSession(testSessionId);
      if (got && got.id === testSessionId) add('sessions_read', 'ok');
      else add('sessions_read', 'fail', { got });

      const deleted = await mem.deleteSession(testSessionId);
      add('sessions_delete', deleted ? 'ok' : 'fail');

      const listAfter = await mem.listSessions();
      add('sessions_list_after', listAfter.find((s) => s.id === testSessionId) ? 'fail' : 'ok');
    } catch (e) {
      add('sessions_crud', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 3. Memory store: write, list, delete
    try {
      const id = await mem.saveMemory('sys_check probe', 'memory');
      add('memory_create', typeof id === 'number' && id > 0 ? 'ok' : 'fail', { id });

      const all = await mem.searchAllMemory(1000);
      add('memory_list', 'ok', { count: all.length });

      const deleted = await mem.deleteMemory(id);
      add('memory_delete', deleted ? 'ok' : 'fail');
    } catch (e) {
      add('memory_crud', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 4. Files store: write, list, read, delete
    const testPath = `sys-check/${Date.now()}.txt`;
    try {
      await mem.writeFile(testPath, 'sys_check file probe');
      const paths = await mem.listFilePaths();
      add('files_list', paths.includes(testPath) ? 'ok' : 'fail', { count: paths.length });

      const content = await mem.readFile(testPath);
      add('files_read', content === 'sys_check file probe' ? 'ok' : 'fail', { contentLength: content?.length });

      const deleted = await mem.deleteFile(testPath);
      add('files_delete', deleted ? 'ok' : 'fail');
    } catch (e) {
      add('files_crud', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 5. Logs readable
    try {
      const logs = await readLogs({ limit: 1 });
      add('logs_read', 'ok', { count: logs.length });
    } catch (e) {
      add('logs_read', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 6. Config readable
    try {
      const cfg = loadConfig();
      add('config_read', 'ok', {
        hasModel: !!cfg.model,
        hasBaseUrl: !!cfg.baseUrl,
        language: cfg.language,
        maxTurns: cfg.maxTurns,
      });
    } catch (e) {
      add('config_read', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 7. Worker sandbox smoke test (small deterministic eval)
    try {
      const { runInWorkerSandbox } = await import('../utils/worker-sandbox.js');
      const result = await runInWorkerSandbox('return 1 + 2;');
      add('worker_sandbox', result.error ? 'fail' : 'ok', {
        result: result.result,
        hasError: !!result.error,
      });
    } catch (e) {
      add('worker_sandbox', 'fail', e instanceof Error ? e.message : String(e));
    }

    // 8. Parallel transaction stress test (catches stale connections / deadlocks)
    try {
      await Promise.all([
        mem.listSessions(),
        mem.searchAllMemory(100),
        mem.listFilePaths(),
      ]);
      add('parallel_tx', 'ok');
    } catch (e) {
      add('parallel_tx', 'fail', e instanceof Error ? e.message : String(e));
    }

    const totalMs = Math.round(performance.now() - start);
    const failed = checks.filter((c) => c.status === 'fail').length;
    const warnings = checks.filter((c) => c.status === 'warn').length;

    report.checks = checks;
    report.summary = {
      total: checks.length,
      passed: checks.length - failed - warnings,
      failed,
      warnings,
      totalMs,
    };

    return `## System Check Report

**Summary:** ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings (${totalMs}ms)

| Check | Status | Detail |
|---|---|---|
${checks.map((c) => `| ${c.name} | ${c.status.toUpperCase()} | ${c.detail !== undefined ? JSON.stringify(c.detail).slice(0, 120) : ''} |`).join('\n')}

**Recommendation:** ${failed > 0 ? 'Some checks failed. Try running `sys_check` with `repair: true` once. If sessions still cannot be switched or deleted, the browser profile/IndexedDB may be damaged and a reset/export+reimport may be needed.' : 'All checks passed. The system is healthy.'}`;
  },
};

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
    help,
    read_file,
    read_pdf,
    write_file,
    search_files,
    patch,
    run,
    run_code,
    run_app,
    web_search,
    youtube_transcript,
    memory_save,
    memory_search,
    sys_check,
    error_log,
  ];
}