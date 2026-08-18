// ============================================================
// vibeAgentGo — Execution tools (Web Worker sandbox)
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import type { ToolContext } from '../../types/index.js';
import { getMemoryStore, asString, asNumber } from './shared.js';

// --- Execution Tools ---

async function runInSandbox(
  code: string,
  ctx: ToolContext,
  timeoutMs: number
): Promise<{ result: string; error?: string; logsText: string }> {
  const { runInWorkerSandbox } = await import('../../utils/worker-sandbox.js');
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

  const logsText = logs.length > 0 ? logs.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join('\n') : 'No logs';

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

export const run_code: Tool = {
  name: 'run_code',
  description:
    'Execute a short JavaScript expression or small function in the Web Worker sandbox. Use for quick calculations, date formatting, parsing, filtering, or simple transformations. Returns the evaluated result or console logs. For complex multi-step tasks, file I/O, CDN imports, or interactive views use run instead.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript expression or small function to evaluate. Available globals: console, async/await. No DOM, no fs, no CDN imports.',
      },
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
    const out =
      logsText !== 'No logs'
        ? `Logs:\n${truncateText(logsText, MAX_CHARS)}\n\nResult: ${truncateText(result, MAX_CHARS)}`
        : `Result: ${truncateText(result, MAX_CHARS)}`;
    return out;
  },
};

export const run: Tool = {
  name: 'run',
  description:
    'Execute JavaScript in the Web Worker sandbox for complex, multi-step tasks. Capabilities: importScripts() for CDN libraries (sql.js, SQLite, CSV parsers, charting libs, etc.), fs.readFile/writeFile/listFiles for workspace I/O, render(title, html) to display interactive views in a dedicated window, async/await. Use for multi-step data processing, CSV→SQLite queries, file transformations, and long-running calculations. For simple calculations use run_code; for pure UI views use run_app. 30s timeout, no DOM access. Use console.log() for output.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript code to execute. Available globals: fs (workspace I/O: fs.readFile, fs.writeFile, fs.listFiles), console, importScripts (CDN imports), render(title, html) to show interactive views, async/await.',
      },
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

export const run_app: Tool = {
  name: 'run_app',
  description:
    'Open an interactive HTML/CSS/JS view in its own dedicated window. The HTML is read from a workspace file, not passed inline. Use for charts, dashboards, calculators, data visualizations, or any interactive UI. Each call opens a new independent window. Workflow: first write the HTML to a file with write_file, then call run_app with the file path. No CDN imports.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title shown in the window title bar' },
      file: {
        type: 'string',
        description:
          'Path to an HTML file in the workspace (e.g. "app.html"). The file content is rendered in a sandboxed iframe.',
      },
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
