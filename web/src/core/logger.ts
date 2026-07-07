// ============================================================
// vibeAgentGo — Logger (client-side IndexedDB log store)
// Writes all runtime errors and events to DB so they can be
// inspected later, even if the chat UI has reset.
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  sessionId?: string | null;
  details?: Record<string, unknown>;
}

const DB_NAME = 'vibeAgentGo-agent';
// MUST match memory.ts DB_VERSION — both open the same DB.
// If they differ, the lower version fails with a version error when the
// higher version is already open, making error_log silently fail.
const DB_VERSION = 3;
const STORE = 'logs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openLoggerDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab triggers a versionchange, close our cached connection
      // so the upgrade can proceed. Next getDB() will re-open.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      // The logs store is also created by memory.ts's onupgradeneeded.
      // Use `contains` guard so we don't try to create it twice.
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('level', 'level', { unique: false });
        store.createIndex('source', 'source', { unique: false });
      }
    };
  });
  return dbPromise;
}

async function getDB(): Promise<IDBDatabase> {
  return openLoggerDB();
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return getDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export function writeLog(entry: LogEntry): Promise<number> {
  const record: LogEntry = {
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  // Mirror to console so DevTools still shows it
  try {
    const consoleMethod =
      record.level === 'debug'
        ? console.debug
        : record.level === 'info'
          ? console.info
          : record.level === 'warn'
            ? console.warn
            : console.error;
    consoleMethod(`[${record.source}] ${record.message}`, record.details ?? '');
  } catch {
    /* ignore console failure */
  }

  return tx<IDBValidKey>('readwrite', (store) => store.add(record)).then((id) => Number(id));
}

export async function readLogs(opts: {
  levels?: LogLevel[];
  sources?: string[];
  limit?: number;
  since?: string;
  sessionId?: string | null;
} = {}): Promise<LogEntry[]> {
  const db = await getDB();
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
  await tx('readwrite', (store) => store.clear());
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
