// ============================================================
// vibeAgentGo — System health check tool
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool, ToolContext } from '../../types/index.js';
import { openDB, resetDBConnection } from '../db.js';
import { loadConfig } from '../memory.js';
import { readLogs } from '../logger.js';
import { getMemoryStore, asBoolean } from './shared.js';

export const sys_check: Tool = {
  name: 'sys_check',
  description:
    'Deterministic health check of the browser-side system. Verifies IndexedDB connection, all object stores, session CRUD, memory, files, logs, configuration, and the worker sandbox. Returns a structured report. Always safe to run. Does NOT require any parameters.',
  parameters: {
    type: 'object',
    properties: {
      repair: {
        type: 'boolean',
        description:
          'If true, attempt to repair a stale database connection by closing and reopening it. Default: false.',
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext) => {
    const mem = getMemoryStore(ctx);
    const repair = asBoolean(args.repair);
    interface Summary {
      total: number;
      passed: number;
      failed: number;
      warnings: number;
      totalMs: number;
    }
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

      const expectedStores = ['memory', 'sessions', 'files', 'logs'];
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
      const { runInWorkerSandbox } = await import('../../utils/worker-sandbox.js');
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
      await Promise.all([mem.listSessions(), mem.searchAllMemory(100), mem.listFilePaths()]);
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
