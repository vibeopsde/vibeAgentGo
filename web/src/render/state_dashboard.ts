// ============================================================
// vibeAgentGo — Project State Dashboard Renderer
// Extracted from tools.ts so presentation stays separate from tool logic.
// ============================================================

import { escapeHtml } from '../utils/escape.js';
import type { ProjectState } from '../types/index.js';

export interface DashboardTheme {
  bg: string;
  text: string;
  muted: string;
  cardBg: string;
  border: string;
  headBg: string;
  accentOpen: string;
  accentInProgress: string;
  accentBlocked: string;
  accentDone: string;
  accentLow: string;
  accentMedium: string;
  accentHigh: string;
}

const darkTheme: DashboardTheme = {
  bg: '#0d1117',
  text: '#e6edf3',
  muted: '#7d8590',
  cardBg: '#161b22',
  border: '#30363d',
  headBg: '#1c2128',
  accentOpen: '#7d8590',
  accentInProgress: '#58a6ff',
  accentBlocked: '#f85149',
  accentDone: '#3fb950',
  accentLow: '#7d8590',
  accentMedium: '#d29922',
  accentHigh: '#f85149',
};

const lightTheme: DashboardTheme = {
  bg: '#ffffff',
  text: '#1f2328',
  muted: '#656d76',
  cardBg: '#f6f8fa',
  border: '#d0d7de',
  headBg: '#eaeef2',
  accentOpen: '#656d76',
  accentInProgress: '#0969da',
  accentBlocked: '#cf222e',
  accentDone: '#1a7f37',
  accentLow: '#656d76',
  accentMedium: '#9a6700',
  accentHigh: '#cf222e',
};

export function resolveDashboardTheme(isDark: boolean): DashboardTheme {
  return isDark ? darkTheme : lightTheme;
}

export function renderStateDashboard(state: ProjectState, isDark = true): string {
  const t = resolveDashboardTheme(isDark);
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const issues = Array.isArray(state.open_issues) ? state.open_issues : [];
  const rawLessons = Array.isArray(state.lessons_learned) ? state.lessons_learned : [];
  const lessons: string[] = rawLessons.map((l) => (typeof l === 'string' ? l : l.note));
  const files = Array.isArray(state.files) ? state.files : [];

  const statusColor: Record<string, string> = {
    open: t.accentOpen,
    in_progress: t.accentInProgress,
    blocked: t.accentBlocked,
    done: t.accentDone,
    cancelled: t.muted,
  };

  const severityColor: Record<string, string> = {
    low: t.accentLow,
    medium: t.accentMedium,
    high: t.accentHigh,
  };

  const taskRows = tasks
    .map(
      (task) => `
      <tr>
        <td><span class="badge" style="background:${statusColor[task.status] || t.muted};color:#fff">${escapeHtml(task.status)}</span></td>
        <td><strong>${escapeHtml(task.title)}</strong></td>
        <td>${escapeHtml(task.id)}</td>
        <td>${task.depends_on?.length ? escapeHtml(task.depends_on.join(', ')) : '—'}</td>
        <td>${escapeHtml(task.notes || '')}</td>
      </tr>
    `
    )
    .join('');

  const issueRows = issues
    .map(
      (issue) => `
      <tr>
        <td><span class="badge" style="background:${severityColor[issue.severity] || t.muted};color:#fff">${escapeHtml(issue.severity)}</span></td>
        <td><strong>${escapeHtml(issue.title)}</strong></td>
        <td>${escapeHtml(issue.id)}</td>
        <td>${escapeHtml(issue.notes || '')}</td>
      </tr>
    `
    )
    .join('');

  const lessonItems = lessons.map((lesson) => `&lt;li&gt;${escapeHtml(lesson)}&lt;/li&gt;`).join('');
  const fileItems = files.map((file) => `<li>${escapeHtml(file)}</li>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    :root { color-scheme: dark light; }
    body { font-family: -apple-system, system-ui, sans-serif; background: ${t.bg}; color: ${t.text}; margin: 0; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    h2 { font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; color: ${t.muted}; }
    .meta { color: ${t.muted}; font-size: 12px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .card { background: ${t.cardBg}; border: 1px solid ${t.border}; border-radius: 8px; padding: 12px; }
    .card .value { font-size: 22px; font-weight: 700; }
    .card .label { font-size: 12px; color: ${t.muted}; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: ${t.cardBg}; border: 1px solid ${t.border}; border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 10px; font-size: 13px; border-bottom: 1px solid ${t.border}; }
    th { background: ${t.headBg}; color: ${t.muted}; text-transform: uppercase; font-size: 11px; }
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
    <div class="card"><div class="value">${tasks.filter((t) => t.status === 'done').length}</div><div class="label">Done</div></div>
    <div class="card"><div class="value">${issues.filter((i) => i.status === 'open').length}</div><div class="label">Open Issues</div></div>
    <div class="card"><div class="value">${lessons.length}</div><div class="label">Lessons</div></div>
  </div>

  <h2>Tasks</h2>
  <table>
    <thead><tr><th>Status</th><th>Task</th><th>ID</th><th>Depends on</th><th>Notes</th></tr></thead>
    <tbody>${taskRows || `<tr><td colspan="5" style="color:${t.muted}">No tasks yet</td></tr>`}</tbody>
  </table>

  <h2>Open Issues</h2>
  <table>
    <thead><tr><th>Severity</th><th>Issue</th><th>ID</th><th>Notes</th></tr></thead>
    <tbody>${issueRows || `<tr><td colspan="4" style="color:${t.muted}">No issues yet</td></tr>`}</tbody>
  </table>

  <h2>Lessons Learned</h2>
  <ul>${lessonItems || `<li style="color:${t.muted}">No lessons yet</li>`}</ul>

  <h2>Tracked Files</h2>
  <ul>${fileItems || `<li style="color:${t.muted}">No files tracked</li>`}</ul>
</body>
</html>`;
}
