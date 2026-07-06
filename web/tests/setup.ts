// ============================================================
// vibeAgentGo — Vitest setup: polyfill IndexedDB in jsdom
// ============================================================

import { IDBFactory, IDBKeyRange, IDBTransaction } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

// Give every test a fresh IndexedDB factory so each test starts with a clean
// database schema and no stale object stores from previous test runs.
beforeEach(() => {
  // @ts-ignore
  globalThis.indexedDB = new IDBFactory();
  // @ts-ignore
  globalThis.IDBKeyRange = IDBKeyRange;
  // @ts-ignore
  globalThis.IDBTransaction = IDBTransaction;
});
