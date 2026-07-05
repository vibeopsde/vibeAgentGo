// ============================================================
// vibeAgentGo — Browser Tools (client-side, IndexedDB + iframe sandbox)
// ============================================================

import type { Tool, ToolContext } from '../types/index.js';
import { MemoryStore, loadConfig } from './memory.js';
import { runInSandbox } from '../utils/sandbox.js';
import { escapeHtml } from '../utils/escape.js';
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

// --- Project State (agent_state.json) ---

const state_view: Tool = {
  name: 'state_view',
  description: 'Read and summarize the current project state from agent_state.json in the workspace. Use this at the start of a complex task or when the user refers to project status, roadmap, open issues, or lessons learned.',
  parameters: {
    type: 'object',
    properties: {
      render: { type: 'boolean', description: 'If true, also render an interactive dashboard view of the project state. Default: false' },
    },
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    const state = await loadState(mem);
    if (args.render) {
      const html = renderStateDashboard(state);
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
      render: { type: 'boolean', description: 'If true, render the Project State dashboard after updating. Default: false' },
    },
  },
  handler: async (args, ctx) => {
    const mem = getMemoryStore(ctx);
    let state = await loadState(mem);

    const updates: any = {};
    if (typeof args.goal === 'string') updates.goal = args.goal;
    if (typeof args.current_phase === 'string') updates.current_phase = args.current_phase;
    if (Array.isArray(args.tasks)) updates.tasks = args.tasks;
    if (Array.isArray(args.open_issues)) updates.open_issues = args.open_issues;
    if (Array.isArray(args.lessons_learned)) updates.lessons_learned = args.lessons_learned;
    if (Array.isArray(args.files)) updates.files = args.files;

    state = updateState(state, updates);

    if (typeof args.delete_task === 'string') {
      state = deleteTask(state, args.delete_task);
    }
    if (typeof args.delete_issue === 'string') {
      state = deleteIssue(state, args.delete_issue);
    }

    await saveState(mem, state);

    if (args.render) {
      const html = renderStateDashboard(state);
      ctx.emit('render_view', { title: 'Project State', html });
    }

    return `Updated agent_state.json.\n\n${formatStateSummary(state)}`;
  },
};

function renderStateDashboard(state: any): string {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const issues = Array.isArray(state.open_issues) ? state.open_issues : [];
  const lessons = Array.isArray(state.lessons_learned) ? state.lessons_learned : [];
  const files = Array.isArray(state.files) ? state.files : [];

  const statusColor: Record<string, string> = {
    open: '#7d8590',
    in_progress: '#58a6ff',
    blocked: '#f85149',
    done: '#3fb950',
    cancelled: '#7d8590',
  };

  const severityColor: Record<string, string> = {
    low: '#7d8590',
    medium: '#d29922',
    high: '#f85149',
  };

  const taskRows = tasks
    .map((t: any) => `
      <tr>
        <td><span class="badge" style="background:${statusColor[t.status] || '#7d8590'};color:#fff">${t.status}</span></td>
        <td><strong>${escapeHtml(t.title)}</strong></td>
        <td>${t.id}</td>
        <td>${t.depends_on?.length ? escapeHtml(t.depends_on.join(', ')) : '—'}</td>
        <td>${escapeHtml(t.notes || '')}</td>
      </tr>
    `)
    .join('');

  const issueRows = issues
    .map((i: any) => `
      <tr>
        <td><span class="badge" style="background:${severityColor[i.severity] || '#7d8590'};color:#fff">${i.severity}</span></td>
        <td><strong>${escapeHtml(i.title)}</strong></td>
        <td>${i.id}</td>
        <td>${escapeHtml(i.notes || '')}</td>
      </tr>
    `)
    .join('');

  const lessonItems = lessons
    .map((l: any) => `<li>${escapeHtml(typeof l === 'string' ? l : l.note)}</li>`)
    .join('');

  const fileItems = files
    .map((f: string) => `<li>${escapeHtml(f)}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    :root { color-scheme: dark light; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    h2 { font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; color: #7d8590; }
    .meta { color: #7d8590; font-size: 12px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
    .card .value { font-size: 22px; font-weight: 700; }
    .card .label { font-size: 12px; color: #7d8590; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #30363d; }
    th { background: #1c2128; color: #7d8590; text-transform: uppercase; font-size: 11px; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }
    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>🗂️ ${escapeHtml(state.goal || 'Project State')}</h1>
  <div class="meta">Phase: ${escapeHtml(state.current_phase || '—')} · Updated: ${escapeHtml(state.updated_at || '—')}</div>

  <div class="grid">
    <div class="card"><div class="value">${tasks.length}</div><div class="label">Tasks</div></div>
    <div class="card"><div class="value">${tasks.filter((t: any) => t.status === 'done').length}</div><div class="label">Done</div></div>
    <div class="card"><div class="value">${issues.filter((i: any) => i.status === 'open').length}</div><div class="label">Open Issues</div></div>
    <div class="card"><div class="value">${lessons.length}</div><div class="label">Lessons</div></div>
  </div>

  <h2>Tasks</h2>
  <table>
    <thead><tr><th>Status</th><th>Task</th><th>ID</th><th>Depends on</th><th>Notes</th></tr></thead>
    <tbody>${taskRows || '<tr><td colspan="5" style="color:#7d8590">No tasks yet</td></tr>'}</tbody>
  </table>

  <h2>Open Issues</h2>
  <table>
    <thead><tr><th>Severity</th><th>Issue</th><th>ID</th><th>Notes</th></tr></thead>
    <tbody>${issueRows || '<tr><td colspan="4" style="color:#7d8590">No issues yet</td></tr>'}</tbody>
  </table>

  <h2>Lessons Learned</h2>
  <ul>${lessonItems || '<li style="color:#7d8590">No lessons yet</li>'}</ul>

  <h2>Tracked Files</h2>
  <ul>${fileItems || '<li style="color:#7d8590">No files tracked</li>'}</ul>
</body>
</html>`;
}

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
  return [read_file, write_file, search_files, run_code, web_search, memory_save, memory_search, state_view, state_update, render_view, inspect_view];
}