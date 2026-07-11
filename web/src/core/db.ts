// ============================================================
// vibeAgentGo — IndexedDB single source of truth
// One connection, one schema, one version. All modules
// (memory.ts, logger.ts, backup.ts) route through this.
// Never call indexedDB.open() elsewhere.
// ============================================================

export const DB_NAME = 'vibeAgentGo-agent';
export const DB_VERSION = 5; // bumped from 4 — adds installedApps store for vAG-Apps
// created by the old logger.ts race condition (only had 'logs' store).

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      // Create any stores that are missing — handles both fresh DBs and
      // upgrades from older versions where stores were added later.
      if (!db.objectStoreNames.contains('memory')) {
        const memStore = db.createObjectStore('memory', { keyPath: 'id', autoIncrement: true });
        memStore.createIndex('category', 'category', { unique: false });
        memStore.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessStore.createIndex('updated_at', 'updated_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('skills')) {
        db.createObjectStore('skills', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
        logStore.createIndex('level', 'level', { unique: false });
        logStore.createIndex('source', 'source', { unique: false });
      }
      if (!db.objectStoreNames.contains('installedApps')) {
        db.createObjectStore('installedApps', { keyPath: 'id' });
      }
      console.info(`[vibeAgentGo] DB upgraded from v${oldVersion} to v${db.version}`);
    };
  });
  return dbPromise;
}

const DB_RECOVERABLE_ERRORS = new Set([
  'InvalidStateError',
  'TransactionInactiveError',
  'NotFoundError',
  'UnknownError',
]);

function isRecoverableDBError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // IndexedDB errors expose a `name` property (e.g. 'InvalidStateError').
  if (DB_RECOVERABLE_ERRORS.has(err.name)) return true;
  const msg = err.message?.toLowerCase() || '';
  return msg.includes('connection is closing') || msg.includes('invalid state');
}

async function withDBRetry<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
  attempt = 0
): Promise<T> {
  try {
    return await runTx<T>(storeName, mode, fn);
  } catch (err) {
    if (attempt === 0 && isRecoverableDBError(err)) {
      // Connection likely became stale (e.g. versionchange from another tab,
      // browser GC, or unexpected InvalidStateError). Reset the cached promise
      // and retry exactly once before giving up.
      dbPromise = null;
      return withDBRetry(storeName, mode, fn, attempt + 1);
    }
    throw err;
  }
}

function runTx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false;
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const req = fn(store);

        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true;
            fn();
          }
        };

        req.onsuccess = () => settle(() => resolve(req.result as T));
        req.onerror = () => settle(() => reject(req.error));

        // If the transaction is aborted (quota, browser GC, versionchange from
        // another tab), the request's onsuccess/onerror may never fire.
        // Without these handlers, the Promise hangs forever — the agent stalls,
        // the user reloads, currentSessionId is lost, and a new session starts.
        transaction.onabort = () => settle(() => reject(transaction.error || new Error('Transaction aborted')));
        transaction.oncomplete = () => settle(() => resolve(req.result as T));
      })
  );
}

export function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return withDBRetry<T>(storeName, mode, fn);
}

export function txAll<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T[]>
): Promise<T[]> {
  return tx(storeName, mode, fn);
}

export async function cursorAll<T>(storeName: string, direction: IDBCursorDirection = 'prev'): Promise<T[]> {
  const db = await openDB();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.openCursor(null, direction);
    const results: T[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value as T);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function cursorByIndex<T>(
  storeName: string,
  indexName: string,
  value: string,
  limit: number,
  direction: IDBCursorDirection = 'prev'
): Promise<T[]> {
  const db = await openDB();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.only(value);
    const request = index.openCursor(range, direction);
    const results: T[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value as T);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export function resetDBConnection(): Promise<void> {
  return new Promise((resolve) => {
    if (dbPromise) {
      dbPromise
        .then((db) => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {})
        .finally(() => {
          dbPromise = null;
          resolve();
        });
    } else {
      dbPromise = null;
      resolve();
    }
  });
}

export async function resetLocalData(): Promise<void> {
  localStorage.removeItem('vibeAgentGo-config');
  localStorage.removeItem('vibeAgentGo-onboarding');
  localStorage.removeItem('vibeAgentGo-theme');
  await resetDBConnection();
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
