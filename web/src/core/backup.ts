// ============================================================
// vibeAgentGo — Backup Manager (client-side ZIP export/import)
// Bundle all IndexedDB + localStorage data into a single ZIP.
// ============================================================

import JSZip from 'jszip';
import { MemoryStore, SkillStore, CONFIG_KEY, loadConfig, tx } from './memory.js';

export interface BackupManifest {
  version: number;
  exported_at: string;
  app_version: string;
  includes_api_keys: boolean;
}

export interface AppBackup {
  manifest: BackupManifest;
  memory: any[];
  sessions: any[];
  skills: any[];
  files: { path: string; content: string }[];
  config: Record<string, any>;
  theme: string | null;
  onboarding: string | null;
}

export class BackupManager {
  private memory: MemoryStore;
  private skillStore: SkillStore;
  private appVersion: string;

  constructor(appVersion: string) {
    this.memory = new MemoryStore();
    this.skillStore = new SkillStore();
    this.appVersion = appVersion;
  }

  async exportZip(includeApiKeys = false): Promise<Blob> {
    const zip = new JSZip();

    const [memory, sessions, skills, files] = await Promise.all([
      this.memory.searchAllMemory(10000),
      this.memory.listSessions().then(list => list.map(s => ({ ...s, messages: [] as any[] }))),
      this.skillStore.listSkills(),
      this.memory.listFiles(),
    ]);

    // Re-fetch full session messages
    const fullSessions = await Promise.all(
      sessions.map(async s => this.memory.getSession(s.id))
    );

    const config = loadConfig();
    const configClone = JSON.parse(JSON.stringify(config));
    if (!includeApiKeys) {
      configClone.apiKey = '[REDACTED]';
      configClone.searchApiKey = '[REDACTED]';
    }

    const backup: AppBackup = {
      manifest: {
        version: 1,
        exported_at: new Date().toISOString(),
        app_version: this.appVersion,
        includes_api_keys: includeApiKeys,
      },
      memory,
      sessions: fullSessions.filter(Boolean) as any[],
      skills,
      files,
      config: configClone,
      theme: localStorage.getItem('vibeAgentGo-theme'),
      onboarding: localStorage.getItem('vibeAgentGo-onboarding'),
    };

    zip.file('manifest.json', JSON.stringify(backup.manifest, null, 2));
    zip.file('memory.json', JSON.stringify(backup.memory, null, 2));
    zip.file('sessions.json', JSON.stringify(backup.sessions, null, 2));
    zip.file('skills.json', JSON.stringify(backup.skills, null, 2));
    zip.file('config.json', JSON.stringify(backup.config, null, 2));
    zip.file('theme.json', JSON.stringify(backup.theme, null, 2));
    zip.file('onboarding.json', JSON.stringify(backup.onboarding, null, 2));

    const filesFolder = zip.folder('files');
    for (const f of files) {
      filesFolder?.file(f.path, f.content);
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

    const memory: any[] = await loadJson('memory.json') || [];
    const sessions: any[] = await loadJson('sessions.json') || [];
    const skills: any[] = await loadJson('skills.json') || [];
    const config: Record<string, any> = await loadJson('config.json') || {};
    const theme: string | null = await loadJson('theme.json') ?? null;
    const onboarding: string | null = await loadJson('onboarding.json') ?? null;

    const filesFolder = zip.folder('files');
    const files: { path: string; content: string }[] = [];
    if (filesFolder) {
      filesFolder.forEach((relativePath, file) => {
        if (!file.dir) files.push({ path: relativePath, content: '' });
      });
    }
    for (const f of files) {
      f.content = await zip.file(`files/${f.path}`)!.async('text');
    }

    // Restore localStorage. API keys are kept only when they are not redacted in the backup.
    const current = loadConfig();
    const restoredConfig = { ...current, ...config };
    if (config.apiKey === '[REDACTED]') restoredConfig.apiKey = current.apiKey;
    if (config.searchApiKey === '[REDACTED]') restoredConfig.searchApiKey = current.searchApiKey;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(restoredConfig));
    if (theme !== null) localStorage.setItem('vibeAgentGo-theme', theme);
    if (onboarding !== null) localStorage.setItem('vibeAgentGo-onboarding', onboarding);

    // Restore IndexedDB
    await Promise.all(memory.map((m: any) => this.saveMemoryRaw(m)));
    await Promise.all(sessions.map((s: any) => this.memory.saveSession(s)));
    await Promise.all(skills.map((s: any) => this.skillStore.saveSkill(s)));
    await Promise.all(files.map((f: any) => this.memory.writeFile(f.path, f.content)));
  }

  private async saveMemoryRaw(entry: any): Promise<void> {
    // Use direct IndexedDB put to preserve id and timestamps.
    await tx('memory', 'readwrite', (store: IDBObjectStore) => store.put(entry));
  }
}
