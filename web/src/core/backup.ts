// ============================================================
// vibeAgentGo — Backup Manager (client-side ZIP export/import)
// Bundle all IndexedDB + localStorage data into a single ZIP.
// ============================================================

import type { Session, MemoryEntry } from '../types/index.js';
import JSZip from 'jszip';
import { MemoryStore, CONFIG_KEY, loadConfig } from './memory.js';
import { tx } from './db.js';
import { getActiveWorkspace } from './workspace.js';

export interface BackupManifest {
  version: number;
  exported_at: string;
  app_version: string;
  includes_api_keys: boolean;
  workspace_id: string;
  workspace_name: string;
}

export interface AppBackup {
  manifest: BackupManifest;
  memory: MemoryEntry[];
  sessions: Session[];
  files: ImportedFile[];
  config: Record<string, unknown>;
  theme: string | null;
  onboarding: string | null;
}

interface ImportedFile {
  path: string;
  content: string;
  /** Present for binary files: base64-encoded bytes. Absent (or kind omitted) = text. */
  kind?: 'text' | 'binary';
  base64?: string;
}

interface SessionLike {
  id: string;
  messages?: unknown[];
  [key: string]: unknown;
}

export class BackupManager {
  private memory: MemoryStore;
  private appVersion: string;

  constructor(appVersion: string) {
    this.memory = new MemoryStore();
    this.appVersion = appVersion;
  }

  async exportZip(includeApiKeys = false): Promise<Blob> {
    const zip = new JSZip();

    const [memory, sessions, list] = await Promise.all([
      this.memory.searchAllMemory(10000),
      this.memory.listSessions().then((list) => list.map((s) => ({ ...s, messages: [] }))),
      this.memory.listFiles(),
    ]);

    // Resolve each file's content. Binary files are stored with content:'' and their
    // bytes in a separate `binary` field, which listFiles() does not expose — read them
    // back from the store and encode as base64 with kind:'binary'.
    const files: ImportedFile[] = await Promise.all(
      list.map(async (f) => {
        const bytes = await this.memory.readFileBinary(f.path);
        if (bytes) {
          return { path: f.path, content: '', kind: 'binary' as const, base64: this.bytesToBase64(bytes) };
        }
        return { path: f.path, content: f.content ?? '' };
      })
    );

    // Re-fetch full session messages
    const fullSessions = await Promise.all(sessions.map(async (s) => this.memory.getSession(s.id)));

    const config = loadConfig();
    const configClone = JSON.parse(JSON.stringify(config));
    if (!includeApiKeys) {
      configClone.apiKey = '[REDACTED]';
      configClone.searchApiKey = '[REDACTED]';
    }

    const ws = getActiveWorkspace();
    const backup: AppBackup = {
      manifest: {
        version: 1,
        exported_at: new Date().toISOString(),
        app_version: this.appVersion,
        includes_api_keys: includeApiKeys,
        workspace_id: ws.id,
        workspace_name: ws.name,
      },
      memory,
      sessions: fullSessions.filter((s): s is Session => Boolean(s)),
      files,
      config: configClone,
      theme: localStorage.getItem('vibeAgentGo-theme'),
      onboarding: localStorage.getItem('vibeAgentGo-onboarding'),
    };

    zip.file('manifest.json', JSON.stringify(backup.manifest, null, 2));
    zip.file('memory.json', JSON.stringify(backup.memory, null, 2));
    zip.file('sessions.json', JSON.stringify(backup.sessions, null, 2));
    zip.file('config.json', JSON.stringify(backup.config, null, 2));
    zip.file('theme.json', JSON.stringify(backup.theme, null, 2));
    zip.file('onboarding.json', JSON.stringify(backup.onboarding, null, 2));

    // Authoritative file manifest: carries the kind/base64 markers that the plain
    // files/ folder cannot. Import prefers this over reconstructing from the folder.
    zip.file('files.json', JSON.stringify(files, null, 2));

    // Keep the human-readable files/ folder for text files only (binary content lives
    // in files.json to avoid corrupting bytes).
    const filesFolder = zip.folder('files');
    for (const f of files) {
      if (f.kind !== 'binary') {
        filesFolder?.file(f.path, f.content);
      }
    }

    return zip.generateAsync({ type: 'blob' });
  }

  async importZip(file: File): Promise<void> {
    const zip = await JSZip.loadAsync(file);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('Invalid backup: manifest.json missing');
    const manifest: BackupManifest = JSON.parse(await manifestFile.async('text'));
    if (manifest.version !== 1) throw new Error(`Unsupported backup version: ${manifest.version}`);

    const loadJson = async (name: string) => {
      const f = zip.file(name);
      return f ? JSON.parse(await f.async('text')) : undefined;
    };

    const memoryRaw = await loadJson('memory.json');
    const sessionsRaw = await loadJson('sessions.json');
    const configRaw = await loadJson('config.json');
    const theme = (await loadJson('theme.json')) ?? null;
    const onboarding = (await loadJson('onboarding.json')) ?? null;

    // Files: prefer the authoritative files.json (carries kind/base64 markers that
    // the plain files/ folder cannot express). Fall back to the folder for older,
    // pre-binary backups.
    const filesRaw = (await loadJson('files.json')) ?? null;
    const files: ImportedFile[] = Array.isArray(filesRaw) ? filesRaw : await this.reconstructFilesFromZip(zip);

    // Validate the entire payload (JSON parse + structure) BEFORE writing anything,
    // so a corrupt or half-written backup can never leave a partially-restored state.
    this.assertValidPayload({ memoryRaw, sessionsRaw, configRaw, theme, onboarding, files });
    const memory = this.normalizeMemory(memoryRaw);
    const sessions = this.normalizeSessions(sessionsRaw);
    const config =
      configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw)
        ? (configRaw as Record<string, unknown>)
        : {};

    // Restore localStorage. API keys are kept only when they are not redacted in the backup.
    const current = loadConfig();
    const restoredConfig = { ...current, ...config };
    if (config.apiKey === '[REDACTED]') restoredConfig.apiKey = current.apiKey;
    if (config.searchApiKey === '[REDACTED]') restoredConfig.searchApiKey = current.searchApiKey;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(restoredConfig));
    if (theme !== null) localStorage.setItem('vibeAgentGo-theme', theme);
    if (onboarding !== null) localStorage.setItem('vibeAgentGo-onboarding', onboarding);

    // Restore IndexedDB. Memory and sessions are written all-or-nothing after the
    // validation above; files are restored next, routing binary entries back through
    // writeFileBinary and never clobbering an existing binary file with empty text.
    await Promise.all(memory.map((m) => this.saveMemoryRaw(m)));
    await Promise.all(sessions.map((s) => this.memory.saveSession(s as unknown as Session)));
    await this.restoreFiles(files);
  }

  /** Reconstruct the file list from the legacy files/ folder (pre-binary backups). */
  private async reconstructFilesFromZip(zip: JSZip): Promise<ImportedFile[]> {
    const out: ImportedFile[] = [];
    const filesFolder = zip.folder('files');
    if (filesFolder) {
      filesFolder.forEach((relativePath, entry) => {
        // Skip directories and macOS resource forks
        if (entry.dir || relativePath.startsWith('__MACOSX') || relativePath.includes('/.DS_Store')) return;
        out.push({ path: relativePath, content: '' });
      });
    }
    for (const f of out) {
      const zipFile = zip.file(`files/${f.path}`);
      if (zipFile) f.content = await zipFile.async('text');
    }
    return out;
  }

  /** Structural check of the backup payload. Throws on any inconsistency. */
  private assertValidPayload(payload: {
    memoryRaw: unknown;
    sessionsRaw: unknown;
    configRaw: unknown;
    theme: unknown;
    onboarding: unknown;
    files: ImportedFile[];
  }): void {
    if (payload.memoryRaw != null && !Array.isArray(payload.memoryRaw)) {
      throw new Error('Invalid backup: memory.json must be an array');
    }
    if (payload.sessionsRaw != null && !Array.isArray(payload.sessionsRaw)) {
      throw new Error('Invalid backup: sessions.json must be an array');
    }
    if (payload.configRaw != null && (typeof payload.configRaw !== 'object' || Array.isArray(payload.configRaw))) {
      throw new Error('Invalid backup: config.json must be an object');
    }
    if (payload.theme != null && typeof payload.theme !== 'string') {
      throw new Error('Invalid backup: theme.json must be a string');
    }
    if (payload.onboarding != null && typeof payload.onboarding !== 'string') {
      throw new Error('Invalid backup: onboarding.json must be a string');
    }
    for (const [i, f] of payload.files.entries()) {
      if (!f || typeof f !== 'object') throw new Error(`Invalid backup: files entry ${i} is not an object`);
      if (typeof f.path !== 'string' || !f.path)
        throw new Error(`Invalid backup: files entry ${i} is missing a valid path`);
      if (f.kind === 'binary' && (typeof f.base64 !== 'string' || !f.base64)) {
        throw new Error(`Invalid backup: binary file ${f.path} is missing base64 data`);
      }
    }
  }

  private normalizeMemory(raw: unknown): MemoryEntry[] {
    if (raw == null) return [];
    const out: MemoryEntry[] = [];
    for (const m of raw as unknown[]) {
      if (!m || typeof m !== 'object') throw new Error('Invalid backup: memory.json contains a non-object entry');
      if (typeof (m as MemoryEntry).id !== 'number')
        throw new Error('Invalid backup: memory entry missing a numeric id');
      if (typeof (m as MemoryEntry).content !== 'string')
        throw new Error('Invalid backup: memory entry missing string content');
      out.push(m as MemoryEntry);
    }
    return out;
  }

  private normalizeSessions(raw: unknown): SessionLike[] {
    if (raw == null) return [];
    const out: SessionLike[] = [];
    for (const s of raw as unknown[]) {
      if (!s || typeof s !== 'object') throw new Error('Invalid backup: sessions.json contains a non-object entry');
      if (typeof (s as SessionLike).id !== 'string' || !(s as SessionLike).id) {
        throw new Error('Invalid backup: session entry is missing a valid id');
      }
      out.push(s as SessionLike);
    }
    return out;
  }

  /**
   * Restore files. Binary entries (kind:'binary') are written via writeFileBinary
   * with their base64 bytes. A legacy entry without a kind marker and empty content
   * is skipped whenever the target already exists as a binary file — writing '' would
   * destroy the stored bytes (silent data loss in a backup round-trip).
   */
  private async restoreFiles(files: ImportedFile[]): Promise<void> {
    for (const entry of files) {
      if (!entry || typeof entry.path !== 'string' || !entry.path) continue;
      const isBinary = entry.kind === 'binary';
      if (!isBinary) {
        // Ambiguous empty text entry: preserve an existing binary file.
        if (entry.content === '') {
          const existingBytes = await this.memory.readFileBinary(entry.path);
          if (existingBytes) continue;
        }
        await this.memory.writeFile(entry.path, entry.content ?? '');
      } else {
        if (typeof entry.base64 !== 'string' || !entry.base64) continue;
        await this.memory.writeFileBinary(entry.path, this.base64ToBytes(entry.base64));
      }
    }
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  private async saveMemoryRaw(entry: MemoryEntry): Promise<void> {
    // Use direct IndexedDB put to preserve id and timestamps.
    await tx('memory', 'readwrite', (store: IDBObjectStore) => store.put(entry));
  }
}
