// ============================================================
// vibeAgentGo — IndexedDB Memory Store (client-side, no server)
// ============================================================

import type { Message, MemoryEntry, Session } from '../types/index.js';

const DB_NAME = 'vibeAgentGo-agent';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
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
    };
  });
}

export function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

function txAll<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T[]>): Promise<T[]> {
  return tx(storeName, mode, fn);
}

// --- Memory ---

export class MemoryStore {
  async saveMemory(content: string, category: 'memory' | 'user' = 'memory'): Promise<number> {
    const entry = {
      content,
      category,
      created_at: new Date().toISOString(),
    };
    const id = await tx<IDBValidKey>('memory', 'readwrite', store => store.add(entry));
    return Number(id);
  }

  async getMemories(limit = 100): Promise<MemoryEntry[]> {
    const all = await txAll<MemoryEntry>('memory', 'readonly', store => store.getAll());
    return all.filter(m => m.category === 'memory').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  async getUserProfile(): Promise<MemoryEntry[]> {
    const all = await txAll<MemoryEntry>('memory', 'readonly', store => store.getAll());
    return all.filter(m => m.category === 'user').sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getAllMemory(limit = 100): Promise<{ memories: MemoryEntry[]; profile: MemoryEntry[] }> {
    const [memories, profile] = await Promise.all([this.getMemories(limit), this.getUserProfile()]);
    return { memories, profile };
  }

  async searchAllMemory(limit = 1000): Promise<MemoryEntry[]> {
    const all = await txAll<MemoryEntry>('memory', 'readonly', store => store.getAll());
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  async deleteMemory(id: number): Promise<boolean> {
    try {
      await tx('memory', 'readwrite', store => store.delete(id));
      return true;
    } catch { return false; }
  }

  // --- Sessions ---

  async saveSession(session: Session): Promise<void> {
    const existing = await this.getSession(session.id);
    const toSave: Session = {
      ...session,
      created_at: existing?.created_at || session.created_at,
      updated_at: new Date().toISOString(),
    };
    await tx('sessions', 'readwrite', store => store.put(toSave));
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      const result = await tx<Session>('sessions', 'readonly', store => store.get(id));
      return result || null;
    } catch { return null; }
  }

  async listSessions(): Promise<{ id: string; title: string; created_at: string; updated_at: string }[]> {
    const all = await txAll<Session>('sessions', 'readonly', store => store.getAll());
    return all
      .map(s => ({ id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await tx('sessions', 'readwrite', store => store.delete(id));
      return true;
    } catch { return false; }
  }

  // --- Files (workspace in IndexedDB) ---

  async writeFile(path: string, content: string): Promise<void> {
    await tx('files', 'readwrite', store => store.put({ path, content, updated_at: new Date().toISOString() }));
  }

  async readFile(path: string): Promise<string | null> {
    try {
      const result = await tx<{ path: string; content: string }>('files', 'readonly', store => store.get(path));
      return result?.content || null;
    } catch { return null; }
  }

  async listFiles(): Promise<{ path: string; content: string }[]> {
    const all = await txAll<{ path: string; content: string }>('files', 'readonly', store => store.getAll());
    return all.sort((a, b) => a.path.localeCompare(b.path));
  }

  async deleteFile(path: string): Promise<boolean> {
    try {
      await tx('files', 'readwrite', store => store.delete(path));
      return true;
    } catch { return false; }
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
    await tx('skills', 'readwrite', store => store.put(record));
  }

  async getSkill(id: string): Promise<SkillRecord | null> {
    try {
      return await tx<SkillRecord>('skills', 'readonly', store => store.get(id));
    } catch { return null; }
  }

  async listSkills(): Promise<SkillRecord[]> {
    return txAll<SkillRecord>('skills', 'readonly', store => store.getAll()).then(all =>
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    );
  }

  async deleteSkill(id: string): Promise<boolean> {
    try {
      await tx('skills', 'readwrite', store => store.delete(id));
      return true;
    } catch { return false; }
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
    try { parsed = JSON.parse(stored); } catch { }
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
  const stripped: Partial<ClientConfig> = parsed || {};
  delete (stripped as any).maxTokens;

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
  } catch { return false; }
}

export function completeOnboarding(): void {
  const state: OnboardingState = { completed: true, completedAt: new Date().toISOString() };
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
}

export function resetLocalData(): void {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem('vibeAgentGo-theme');
  indexedDB.deleteDatabase(DB_NAME);
}