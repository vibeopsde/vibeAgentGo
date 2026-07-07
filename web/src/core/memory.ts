// ============================================================
// vibeAgentGo — IndexedDB Memory Store (client-side, no server)
// ============================================================

import type { Message, MemoryEntry, Session } from '../types/index.js';
import { logger } from './logger.js';

const DB_NAME = 'vibeAgentGo-agent';
const DB_VERSION = 3;

// --- DB connection cache ---
// Opening a new IDBDatabase connection on every tx() call causes connection
// leaks: each connection stays open and holds a transaction lock, eventually
// causing getSession() to silently fail (returning null), which makes the
// agent lose all conversation context. We cache a single connection and
// re-open only if it was closed (e.g. by a versionchange from another tab).

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
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
      // so the upgrade can proceed. Next tx() will re-open.
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
      logger.info('memory.openDB', `DB upgraded from v${oldVersion} to v${req.result.version}`, {
        oldVersion,
        newVersion: req.result.version,
      });
    };
  });
  return dbPromise;
}

export function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

function txAll<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T[]>
): Promise<T[]> {
  return tx(storeName, mode, fn);
}

async function cursorAll<T>(storeName: string, direction: IDBCursorDirection = 'prev'): Promise<T[]> {
  return _cursorAll<T>(storeName, direction);
}

async function _cursorAll<T>(storeName: string, direction: IDBCursorDirection = 'prev'): Promise<T[]> {
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

async function cursorByIndex<T>(
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

// --- Memory ---

export class MemoryStore {
  async saveMemory(content: string, category: string = 'memory'): Promise<number> {
    const safeCategory = category === 'user' ? 'user' : 'memory';
    const entry = {
      content,
      category: safeCategory,
      created_at: new Date().toISOString(),
    };
    const id = await tx<IDBValidKey>('memory', 'readwrite', (store) => store.add(entry));
    return Number(id);
  }

  async getMemories(limit = 100): Promise<MemoryEntry[]> {
    try {
      return await cursorByIndex<MemoryEntry>('memory', 'category', 'memory', limit, 'prev');
    } catch {
      const all = await txAll<MemoryEntry>('memory', 'readonly', (store) => store.getAll());
      return all
        .filter((m) => m.category === 'memory')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    }
  }

  async getUserProfile(): Promise<MemoryEntry[]> {
    try {
      return await cursorByIndex<MemoryEntry>('memory', 'category', 'user', 1000, 'prev');
    } catch {
      const all = await txAll<MemoryEntry>('memory', 'readonly', (store) => store.getAll());
      return all.filter((m) => m.category === 'user').sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
  }

  async getAllMemory(limit = 100): Promise<{ memories: MemoryEntry[]; profile: MemoryEntry[] }> {
    const [memories, profile] = await Promise.all([this.getMemories(limit), this.getUserProfile()]);
    return { memories, profile };
  }

  async searchAllMemory(limit = 1000): Promise<MemoryEntry[]> {
    try {
      return (await cursorAll<MemoryEntry>('memory', 'prev')).slice(0, limit);
    } catch {
      const all = await txAll<MemoryEntry>('memory', 'readonly', (store) => store.getAll());
      return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    }
  }

  async deleteMemory(id: number): Promise<boolean> {
    try {
      await tx('memory', 'readwrite', (store) => store.delete(id));
      return true;
    } catch {
      return false;
    }
  }

  // --- Sessions ---

  async saveSession(session: Session): Promise<void> {
    const existing = await this.getSession(session.id);
    const toSave: Session = {
      ...session,
      created_at: existing?.created_at || session.created_at,
      updated_at: new Date().toISOString(),
    };
    await tx('sessions', 'readwrite', (store) => store.put(toSave));
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      const result = await tx<Session>('sessions', 'readonly', (store) => store.get(id));
      return result || null;
    } catch (e) {
      // Log the error so the agent can pick it up via error_log tool.
      // Don't silently return null — that causes context loss.
      console.error('[vibeAgentGo] getSession failed:', id, e);
      logger.error('memory.getSession', `Failed to load session ${id}`, {
        sessionId: id,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  async listSessions(): Promise<{ id: string; title: string; created_at: string; updated_at: string }[]> {
    const all = await txAll<Session>('sessions', 'readonly', (store) => store.getAll());
    return all
      .map((s) => ({ id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await tx('sessions', 'readwrite', (store) => store.delete(id));
      return true;
    } catch {
      return false;
    }
  }

  // --- Files (workspace in IndexedDB) ---

  async writeFile(path: string, content: string): Promise<void> {
    await tx('files', 'readwrite', (store) => store.put({ path, content, updated_at: new Date().toISOString() }));
  }

  async readFile(path: string): Promise<string | null> {
    try {
      const result = await tx<{ path: string; content: string }>('files', 'readonly', (store) => store.get(path));
      return result?.content || null;
    } catch {
      return null;
    }
  }

  async listFiles(): Promise<{ path: string; content: string }[]> {
    const all = await txAll<{ path: string; content: string }>('files', 'readonly', (store) => store.getAll());
    return all.sort((a, b) => a.path.localeCompare(b.path));
  }

  async deleteFile(path: string): Promise<boolean> {
    try {
      await tx('files', 'readwrite', (store) => store.delete(path));
      return true;
    } catch {
      return false;
    }
  }

  async searchFiles(pattern: string, target: 'files' | 'content' = 'files'): Promise<string[]> {
    const all = await this.listFiles();
    const results: string[] = [];
    for (const f of all) {
      if (target === 'files') {
        if (f.path.includes(pattern)) results.push(f.path);
      } else {
        const lines = f.content.split('\n');
        lines.forEach((line, i) => {
          if (line.includes(pattern)) {
            results.push(`${f.path}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    return results;
  }
}

export const CONFIG_KEY = 'vibeAgentGo-config';
const ONBOARDING_KEY = 'vibeAgentGo-onboarding';

// --- Skills (IndexedDB) ---

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  content: string;
  trigger?: string[];
  created_at: string;
  updated_at: string;
}

export class SkillStore {
  async saveSkill(skill: Omit<SkillRecord, 'created_at' | 'updated_at'>): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.getSkill(skill.id);
    const record: SkillRecord = {
      ...skill,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    await tx('skills', 'readwrite', (store) => store.put(record));
  }

  async getSkill(id: string): Promise<SkillRecord | null> {
    try {
      return await tx<SkillRecord>('skills', 'readonly', (store) => store.get(id));
    } catch {
      return null;
    }
  }

  async listSkills(): Promise<SkillRecord[]> {
    return txAll<SkillRecord>('skills', 'readonly', (store) => store.getAll()).then((all) =>
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    );
  }

  async deleteSkill(id: string): Promise<boolean> {
    try {
      await tx('skills', 'readwrite', (store) => store.delete(id));
      return true;
    } catch {
      return false;
    }
  }
}

export interface ClientConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  maxTurns: number;
  language: 'de' | 'en';
  searchProvider: 'none' | 'tavily';
  searchApiKey: string;
}

export function loadConfig(): ClientConfig {
  const stored = localStorage.getItem(CONFIG_KEY);
  let parsed: Partial<ClientConfig> | undefined;
  if (stored) {
    try {
      parsed = JSON.parse(stored);
    } catch {
      // Ignore malformed stored config
    }
  }
  const defaultLanguage: 'de' | 'en' = navigator.language?.startsWith('de') ? 'de' : 'en';
  const DEFAULT_CONFIG: ClientConfig = {
    model: '',
    baseUrl: '',
    apiKey: '',
    maxTurns: 30,
    language: defaultLanguage,
    searchProvider: 'none',
    searchApiKey: '',
  };
  // Strip legacy keys from old stored configs (e.g. maxTokens was removed in V2607.1.9)
  const stripped = (parsed || {}) as Partial<ClientConfig> & { maxTokens?: number };
  delete stripped.maxTokens;

  const config: ClientConfig = { ...DEFAULT_CONFIG, ...stripped };
  // Normalize language to a valid value for old/invalid configs
  config.language = config.language === 'en' ? 'en' : 'de';
  return config;
}

export function saveConfig(config: Partial<ClientConfig>): ClientConfig {
  const current = loadConfig();
  const updated = { ...current, ...config };
  if (updated.apiKey) updated.apiKey = updated.apiKey.trim();
  if (updated.searchApiKey) updated.searchApiKey = updated.searchApiKey.trim();
  updated.language = updated.language === 'en' ? 'en' : 'de';
  localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

export function hasApiKey(): boolean {
  return !!loadConfig().apiKey;
}

export interface OnboardingState {
  completed: boolean;
  completedAt?: string;
}

export function hasCompletedOnboarding(): boolean {
  const stored = localStorage.getItem(ONBOARDING_KEY);
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as OnboardingState;
    return parsed.completed === true;
  } catch {
    return false;
  }
}

export function completeOnboarding(): void {
  const state: OnboardingState = { completed: true, completedAt: new Date().toISOString() };
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
}

export async function resetLocalData(): Promise<void> {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem('vibeAgentGo-theme');
  // Close the cached DB connection before deleting — otherwise deleteDatabase()
  // is blocked by the open connection and never completes.
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      /* ignore — might already be closed */
    }
    dbPromise = null;
  }
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // resolve anyway — don't block reset
    req.onblocked = () => resolve(); // resolve even if blocked by another tab
  });
}
