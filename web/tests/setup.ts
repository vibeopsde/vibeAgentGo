// ============================================================
// vibeAgentGo — Vitest setup: polyfill IndexedDB in jsdom
// ============================================================

import { indexedDB } from 'fake-indexeddb';

// @ts-ignore
if (typeof globalThis.indexedDB === 'undefined') {
  // @ts-ignore
  globalThis.indexedDB = indexedDB;
}

// @ts-ignore
if (typeof globalThis.IDBKeyRange === 'undefined') {
  // @ts-ignore
  globalThis.IDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');
}

// @ts-ignore
if (typeof globalThis.IDBTransaction === 'undefined') {
  // @ts-ignore
  globalThis.IDBTransaction = require('fake-indexeddb/lib/FDBTransaction');
}
