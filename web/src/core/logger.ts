// ============================================================
// vibeAgentGo — Logger (client-side IndexedDB log store)
// DB connection and schema live in db.ts — single source of truth.
// ============================================================

import { tx, openDB } from './db.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// Grab the RAW console methods NOW, at module load — BEFORE global_errors.ts
// wraps console.error. writeLog() uses these stored references instead of
// `console.error` directly, so a logger entry reaches the real console exactly
// once and never re-enters the wrapper's `logger.error()` call. That breaks
// the wrapper → logger.error() → log() → console.error() recursion loop.
const rawConsole: Record<LogLevel, (...args: unknown[]) => void> = {
  // eslint-disable-next-line no-console
  debug: console.debug.bind(console),
  // eslint-disable-next-line no-console
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
};

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  sessionId?: string | null;
  details?: Record<string, unknown>;
}

const STORE = 'logs';

function writeLog(entry: LogEntry): Promise<number> {
  const record: LogEntry = {
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  // Mirror to console so DevTools still shows it.
  // Use the raw references captured at load time (NOT the live console, which
  // global_errors.ts wraps for 'error') so each logger entry yields exactly one
  // console line and does NOT re-enter the wrapper's logger.error() callback.
  try {
    rawConsole[record.level](`[${record.source}] ${record.message}`, record.details ?? '');
  } catch {
    /* ignore console failure */
  }

  return tx<IDBValidKey>(STORE, 'readwrite', (store) => store.add(record)).then((id) => Number(id));
}

export async function readLogs(
  opts: {
    levels?: LogLevel[];
    sources?: string[];
    limit?: number;
    since?: string;
    sessionId?: string | null;
  } = {}
): Promise<LogEntry[]> {
  const db = await openDB();
  return new Promise<LogEntry[]>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const store = transaction.objectStore(STORE);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');
    const results: LogEntry[] = [];
    const limit = opts.limit ?? 200;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      const entry = cursor.value as LogEntry;
      if (opts.levels && !opts.levels.includes(entry.level)) {
        cursor.continue();
        return;
      }
      if (opts.sources && !opts.sources.includes(entry.source)) {
        cursor.continue();
        return;
      }
      if (opts.since && entry.timestamp < opts.since) {
        cursor.continue();
        return;
      }
      if (opts.sessionId !== undefined && opts.sessionId !== null && entry.sessionId !== opts.sessionId) {
        cursor.continue();
        return;
      }
      results.push(entry);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearLogs(): Promise<void> {
  await tx(STORE, 'readwrite', (store) => store.clear());
}

export function log(level: LogLevel, source: string, message: string, details?: Record<string, unknown>): void {
  // Fire-and-forget; logging must never break the caller
  writeLog({ level, source, message, timestamp: new Date().toISOString(), details }).catch(() => {});
}

// Convenience helpers
export const logger = {
  debug: (source: string, message: string, details?: Record<string, unknown>) => log('debug', source, message, details),
  info: (source: string, message: string, details?: Record<string, unknown>) => log('info', source, message, details),
  warn: (source: string, message: string, details?: Record<string, unknown>) => log('warn', source, message, details),
  error: (source: string, message: string, details?: Record<string, unknown>) => log('error', source, message, details),
  fatal: (source: string, message: string, details?: Record<string, unknown>) => log('fatal', source, message, details),
};
