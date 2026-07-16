// ============================================================
// vibeAgentGo — IndexedDB Memory Store (client-side, no server)
// DB connection and schema live in db.ts — single source of truth.
// ============================================================

import type { Message, MemoryEntry, Session } from '../types/index.js';
import { logger } from './logger.js';
import { tx, txAll, cursorAll, cursorByIndex } from './db.js';

// Re-export for callers that still import from memory.ts
export { tx, txAll, cursorAll, cursorByIndex, resetLocalData, DB_NAME, openDB } from './db.js';

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

  async updateMemory(id: number, content: string, category?: string): Promise<boolean> {
    try {
      const existing = await tx<MemoryEntry>('memory', 'readonly', (store) => store.get(id));
      if (!existing) return false;
      const updated: MemoryEntry = {
        ...existing,
        content,
        category: category ? (category === 'user' ? 'user' : 'memory') : existing.category,
        created_at: existing.created_at,
        updated_at: new Date().toISOString(),
      };
      await tx('memory', 'readwrite', (store) => store.put(updated));
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

  async writeFileBinary(path: string, data: Uint8Array): Promise<void> {
    const buffer =
      data.byteLength === data.buffer.byteLength
        ? data.buffer
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await tx('files', 'readwrite', (store) =>
      store.put({ path, content: '', binary: buffer, updated_at: new Date().toISOString() })
    );
  }

  async readFileBinary(path: string): Promise<Uint8Array | null> {
    try {
      const result = await tx<{ path: string; binary?: ArrayBuffer }>('files', 'readonly', (store) => store.get(path));
      return result?.binary ? new Uint8Array(result.binary) : null;
    } catch {
      return null;
    }
  }

  async listFiles(): Promise<{ path: string; content: string }[]> {
    const all = await txAll<{ path: string; content: string }>('files', 'readonly', (store) => store.getAll());
    return all.sort((a, b) => a.path.localeCompare(b.path));
  }

  async listFilePaths(): Promise<string[]> {
    const all = await txAll<{ path: string }>('files', 'readonly', (store) => store.getAll());
    return all.map((f) => f.path).sort((a, b) => a.localeCompare(b));
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
    const paths = target === 'files' ? await this.listFilePaths() : (await this.listFiles()).map((f) => f.path);
    const results: string[] = [];
    for (const path of paths) {
      if (target === 'files') {
        if (path.includes(pattern)) results.push(path);
      } else {
        const content = await this.readFile(path);
        if (!content) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (line.includes(pattern)) {
            results.push(`${path}:${i + 1}: ${line.trim()}`);
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
  id?: string;
  name: string;
  description: string;
  content: string;
  trigger?: string[];
  created_at?: string;
  updated_at?: string;
}

export class SkillStore {
  async saveSkill(skill: Omit<SkillRecord, 'created_at' | 'updated_at'> & { id: string }): Promise<void> {
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
      all.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
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
  sounds?: boolean;
  editorTabSize?: number;
  gitUrl?: string;
  gitUsername?: string;
  gitToken?: string;
  gitCorsProxy?: string;
  gitAutoBackup?: boolean;
  youtubeProxyUrl?: string;
  youtubeLanguage?: string;
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
    editorTabSize: 2,
    youtubeProxyUrl: 'https://vag.vibeops.de/api/youtube/',
    youtubeLanguage: defaultLanguage,
  };
  // Strip legacy keys from old stored configs (e.g. maxTokens was removed in V2607.1.9)
  const stripped = (parsed || {}) as Partial<ClientConfig> & { maxTokens?: number };
  delete stripped.maxTokens;

  const config: ClientConfig = { ...DEFAULT_CONFIG, ...stripped };
  // Normalize language to a valid value for old/invalid configs
  config.language = config.language === 'en' ? 'en' : 'de';
  // If no YouTube proxy is configured, default to the built-in instance proxy.
  if (!config.youtubeProxyUrl?.trim()) {
    config.youtubeProxyUrl = DEFAULT_CONFIG.youtubeProxyUrl;
  }
  return config;
}

export function saveConfig(config: Partial<ClientConfig>): ClientConfig {
  const current = loadConfig();
  const updated = { ...current, ...config };
  if (updated.apiKey) updated.apiKey = updated.apiKey.trim();
  if (updated.searchApiKey) updated.searchApiKey = updated.searchApiKey.trim();
  updated.language = updated.language === 'en' ? 'en' : 'de';
  updated.editorTabSize = Math.max(1, Math.min(8, Math.round(Number(updated.editorTabSize) || 2)));
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
