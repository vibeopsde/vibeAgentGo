// ============================================================
// vibeAgentGo — Project State tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  normalizeState,
  updateState,
  deleteTask,
  deleteIssue,
  formatStateSummary,
  generateId,
} from '../src/core/state.js';
import { DEFAULT_PROJECT_STATE, type ProjectState } from '../src/types/index.js';

describe('state utilities', () => {
  it('normalizes a partial state', () => {
    const partial = { goal: 'Test goal' } as Partial<ProjectState>;
    const state = normalizeState(partial);
    expect(state.goal).toBe('Test goal');
    expect(state.current_phase).toBe(DEFAULT_PROJECT_STATE.current_phase);
    expect(state.tasks).toEqual([]);
    expect(state.open_issues).toEqual([]);
    expect(state.lessons_learned).toEqual([]);
    expect(state.files).toEqual([]);
  });

  it('generates a uuid id', () => {
    const id = generateId();
    expect(id.length).toBeGreaterThanOrEqual(12);
    expect(id).toMatch(/[a-f0-9-]+/i);
  });

  it('adds a new task', () => {
    const state = normalizeState({});
    const next = updateState(state, { tasks: [{ title: 'Wire UI', status: 'in_progress' }] });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].title).toBe('Wire UI');
    expect(next.tasks[0].status).toBe('in_progress');
    expect(next.tasks[0].id).toBeDefined();
  });

  it('updates an existing task by id', () => {
    const state = normalizeState({ tasks: [{ id: 't1', title: 'Wire UI', status: 'open' }] });
    const next = updateState(state, { tasks: [{ id: 't1', status: 'done' }] });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].status).toBe('done');
    expect(next.tasks[0].title).toBe('Wire UI');
  });

  it('adds a new issue', () => {
    const state = normalizeState({});
    const next = updateState(state, { open_issues: [{ title: 'CORS bug', severity: 'high' }] });
    expect(next.open_issues).toHaveLength(1);
    expect(next.open_issues[0].title).toBe('CORS bug');
    expect(next.open_issues[0].severity).toBe('high');
  });

  it('appends lessons learned', () => {
    const state = normalizeState({});
    const next = updateState(state, { lessons_learned: ['Cache index.html'] });
    expect(next.lessons_learned).toHaveLength(1);
    expect(next.lessons_learned[0].note).toBe('Cache index.html');
  });

  it('deduplicates tracked files', () => {
    const state = normalizeState({ files: ['a.ts'] });
    const next = updateState(state, { files: ['a.ts', 'b.ts'] });
    expect(next.files).toEqual(['a.ts', 'b.ts']);
  });

  it('deletes a task by id', () => {
    const state = normalizeState({ tasks: [{ id: 't1', title: 'A', status: 'open' }] });
    const next = deleteTask(state, 't1');
    expect(next.tasks).toHaveLength(0);
  });

  it('deletes an issue by id', () => {
    const state = normalizeState({ open_issues: [{ id: 'i1', title: 'A', severity: 'low', status: 'open' }] });
    const next = deleteIssue(state, 'i1');
    expect(next.open_issues).toHaveLength(0);
  });

  it('updates goal and phase', () => {
    const state = normalizeState({});
    const next = updateState(state, { goal: 'Build app', current_phase: 'testing' });
    expect(next.goal).toBe('Build app');
    expect(next.current_phase).toBe('testing');
  });

  it('formatStateSummary includes key sections', () => {
    const state = normalizeState({
      goal: 'Build app',
      current_phase: 'implementation',
      tasks: [{ id: 't1', title: 'Wire UI', status: 'in_progress' }],
      open_issues: [{ id: 'i1', title: 'Bug', severity: 'high', status: 'open' }],
      lessons_learned: [{ id: 'l1', note: 'Lesson', created_at: '2026-01-01' }],
      files: ['src/state.ts'],
    });
    const summary = formatStateSummary(state);
    expect(summary).toContain('Build app');
    expect(summary).toContain('implementation');
    expect(summary).toContain('Wire UI');
    expect(summary).toContain('Bug');
    expect(summary).toContain('Lesson');
    expect(summary).toContain('src/state.ts');
  });
});
