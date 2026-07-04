// ============================================================
// HAG — Memory Store (SQLite)
// ============================================================

import BetterSqlite3 from 'better-sqlite3';
import type { MemoryEntry, Session } from '../types/index.js';
import { join } from 'path';

type SqliteDatabase = BetterSqlite3.Database;

export class MemoryStore {
  private db: SqliteDatabase;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'memory',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        messages TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_category ON agent_memory(category);
      CREATE INDEX IF NOT EXISTS idx_memory_created ON agent_memory(created_at DESC);
    `);
  }

  // --- Memory ---

  saveMemory(content: string, category: 'memory' | 'user' = 'memory'): number {
    const stmt = this.db.prepare('INSERT INTO agent_memory (content, category) VALUES (?, ?)');
    const result = stmt.run(content, category);
    return Number(result.lastInsertRowid);
  }

  getMemories(limit = 100): MemoryEntry[] {
    const stmt = this.db.prepare('SELECT * FROM agent_memory WHERE category = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all('memory', limit) as MemoryEntry[];
  }

  getUserProfile(): MemoryEntry[] {
    const stmt = this.db.prepare('SELECT * FROM agent_memory WHERE category = ? ORDER BY created_at DESC');
    return stmt.all('user') as MemoryEntry[];
  }

  getAllMemory(limit = 100): { memories: MemoryEntry[]; profile: MemoryEntry[] } {
    return {
      memories: this.getMemories(limit),
      profile: this.getUserProfile(),
    };
  }

  deleteMemory(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM agent_memory WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  clearMemory(category?: 'memory' | 'user'): number {
    if (category) {
      const stmt = this.db.prepare('DELETE FROM agent_memory WHERE category = ?');
      return stmt.run(category).changes;
    }
    const stmt = this.db.prepare('DELETE FROM agent_memory');
    return stmt.run().changes;
  }

  // --- Sessions ---

  saveSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        messages = excluded.messages,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      session.id,
      session.title,
      JSON.stringify(session.messages),
      session.created_at,
      new Date().toISOString()
    );
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      messages: JSON.parse(row.messages),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listSessions(): { id: string; title: string; created_at: string; updated_at: string }[] {
    const stmt = this.db.prepare('SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC');
    return stmt.all() as any[];
  }

  deleteSession(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    return stmt.run(id).changes > 0;
  }

  close() {
    this.db.close();
  }
}