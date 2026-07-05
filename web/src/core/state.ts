// ============================================================
// vibeAgentGo — Project State utilities (agent_state.json)
// ============================================================

import type { ProjectState, ProjectTask, ProjectIssue, ProjectLesson, TaskStatus } from '../types/index.js';
import { STATE_FILE_PATH, DEFAULT_PROJECT_STATE } from '../types/index.js';
import type { MemoryStore } from './memory.js';

export function normalizeState(state: Partial<ProjectState>): ProjectState {
  return {
    goal: state.goal ?? DEFAULT_PROJECT_STATE.goal,
    current_phase: state.current_phase ?? DEFAULT_PROJECT_STATE.current_phase,
    tasks: Array.isArray(state.tasks) ? state.tasks : DEFAULT_PROJECT_STATE.tasks,
    open_issues: Array.isArray(state.open_issues) ? state.open_issues : DEFAULT_PROJECT_STATE.open_issues,
    lessons_learned: Array.isArray(state.lessons_learned) ? state.lessons_learned : DEFAULT_PROJECT_STATE.lessons_learned,
    files: Array.isArray(state.files) ? state.files : DEFAULT_PROJECT_STATE.files,
    updated_at: state.updated_at ?? new Date().toISOString(),
  };
}

export async function loadState(mem: MemoryStore): Promise<ProjectState> {
  const raw = await mem.readFile(STATE_FILE_PATH);
  if (raw === null) return DEFAULT_PROJECT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectState>;
    return normalizeState(parsed);
  } catch {
    return DEFAULT_PROJECT_STATE;
  }
}

export async function saveState(mem: MemoryStore, state: ProjectState): Promise<void> {
  state.updated_at = new Date().toISOString();
  await mem.writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2));
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function formatStateSummary(state: ProjectState): string {
  const lines: string[] = [];
  lines.push(`Goal: ${state.goal || '(none)'}`);
  lines.push(`Phase: ${state.current_phase}`);
  lines.push(`Updated: ${state.updated_at}`);
  lines.push('');
  if (state.tasks.length) {
    lines.push('Tasks:');
    state.tasks.forEach(t => lines.push(`- [${t.status}] ${t.id}: ${t.title}${t.depends_on?.length ? ` (depends: ${t.depends_on.join(', ')})` : ''}`));
    lines.push('');
  }
  if (state.open_issues.length) {
    lines.push('Open Issues:');
    state.open_issues.forEach(i => lines.push(`- [${i.severity}] ${i.id}: ${i.title}`));
    lines.push('');
  }
  if (state.lessons_learned.length) {
    lines.push('Lessons Learned:');
    state.lessons_learned.forEach(l => lines.push(`- ${l.note}`));
    lines.push('');
  }
  if (state.files.length) {
    lines.push('Tracked Files:');
    state.files.forEach(f => lines.push(`- ${f}`));
  }
  return lines.join('\n');
}

type TaskUpdate = {
  id?: string;
  title?: string;
  status?: TaskStatus;
  depends_on?: string[];
  notes?: string;
};

type IssueUpdate = {
  id?: string;
  title?: string;
  severity?: 'low' | 'medium' | 'high';
  status?: 'open' | 'closed';
  notes?: string;
};

export function updateState(
  state: ProjectState,
  updates: {
    goal?: string;
    current_phase?: string;
    tasks?: TaskUpdate[];
    open_issues?: IssueUpdate[];
    lessons_learned?: string[];
    files?: string[];
  }
): ProjectState {
  const next: ProjectState = { ...state, updated_at: new Date().toISOString() };

  if (typeof updates.goal === 'string') next.goal = updates.goal;
  if (typeof updates.current_phase === 'string') next.current_phase = updates.current_phase;

  if (updates.tasks) {
    for (const t of updates.tasks) {
      if (t.id && next.tasks.some(existing => existing.id === t.id)) {
        next.tasks = next.tasks.map(existing => (existing.id === t.id ? { ...existing, ...t } as ProjectTask : existing));
      } else if (t.title) {
        next.tasks.push({
          id: t.id || generateId(),
          title: t.title,
          status: t.status || 'open',
          depends_on: t.depends_on || [],
          notes: t.notes || '',
        } as ProjectTask);
      }
    }
  }

  if (updates.open_issues) {
    for (const i of updates.open_issues) {
      if (i.id && next.open_issues.some(existing => existing.id === i.id)) {
        next.open_issues = next.open_issues.map(existing => (existing.id === i.id ? { ...existing, ...i } as ProjectIssue : existing));
      } else if (i.title) {
        next.open_issues.push({
          id: i.id || generateId(),
          title: i.title,
          severity: i.severity || 'medium',
          status: i.status || 'open',
          notes: i.notes || '',
        } as ProjectIssue);
      }
    }
  }

  if (updates.lessons_learned) {
    for (const note of updates.lessons_learned) {
      if (!next.lessons_learned.some(l => l.note === note)) {
        next.lessons_learned.push({ id: generateId(), note, created_at: new Date().toISOString() });
      }
    }
  }

  if (updates.files) {
    next.files = Array.from(new Set([...next.files, ...updates.files]));
  }

  return next;
}

export function deleteTask(state: ProjectState, id: string): ProjectState {
  return { ...state, tasks: state.tasks.filter(t => t.id !== id), updated_at: new Date().toISOString() };
}

export function deleteIssue(state: ProjectState, id: string): ProjectState {
  return { ...state, open_issues: state.open_issues.filter(i => i.id !== id), updated_at: new Date().toISOString() };
}

export function isValidTaskStatus(status: string): status is TaskStatus {
  return ['open', 'in_progress', 'blocked', 'done', 'cancelled'].includes(status);
}

export function isValidIssueSeverity(severity: string): severity is 'low' | 'medium' | 'high' {
  return ['low', 'medium', 'high'].includes(severity);
}

export function isValidIssueStatus(status: string): status is 'open' | 'closed' {
  return ['open', 'closed'].includes(status);
}
