// ============================================================
// vibeAgentGo — Vitest setup: polyfill IndexedDB in jsdom
// ============================================================

import { IDBFactory, IDBKeyRange, IDBTransaction } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

// Give every test a fresh IndexedDB factory so each test starts with a clean
// database schema and no stale object stores from previous test runs.
// We also initialize the schema by forcing the database open, because some
// fake-indexeddb versions create an empty DB on the first request and delay
// onupgradeneeded until a later open — this caused "No objectStore named..."
// errors in the first test that touched the store.
beforeEach(async () => {
  // @ts-ignore
  globalThis.indexedDB = new IDBFactory();
  // @ts-ignore
  globalThis.IDBKeyRange = IDBKeyRange;
  // @ts-ignore
  globalThis.IDBTransaction = IDBTransaction;

  // Pre-open the database with the expected schema so every store exists.
  // Must match DB_VERSION in memory.ts — if the version is lower, the cached
  // connection in memory.ts triggers a versionchange, closes itself, and
  // causes test timeouts.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('vibeAgentGo-agent', 3);
    req.onupgradeneeded = () => {
      const db = req.result;
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
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
});
