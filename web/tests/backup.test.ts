import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { BackupManager, type AppBackup } from '../src/core/backup';
import { MemoryStore, saveConfig, loadConfig, CONFIG_KEY } from '../src/core/memory';
import JSZip from 'jszip';

describe('BackupManager', () => {
  beforeEach(() => {
    localStorage.clear();
    // Re-initialize workspace registry so getActiveWorkspace() works
    localStorage.setItem('vibeAgentGo-activeWorkspace', 'default');
    localStorage.setItem(
      'vibeAgentGo-workspaces',
      JSON.stringify([{ id: 'default', name: 'Default', createdAt: '2026-01-01T00:00:00.000Z' }])
    );
  });

  it('exports memory, sessions, files and config into a zip', async () => {
    const memory = new MemoryStore();

    await memory.saveMemory('I love coffee', 'user');
    await memory.writeFile('hello.txt', 'world');
    saveConfig({ model: 'test-model', baseUrl: 'http://localhost', apiKey: 'sk-test-123', maxTurns: 10, language: 'de', searchProvider: 'none' });

    const manager = new BackupManager('v2607.3.0');
    const blob = await manager.exportZip();
    const zip = await JSZip.loadAsync(blob);

    expect(zip.file('manifest.json')).toBeTruthy();
    expect(zip.file('memory.json')).toBeTruthy();
    expect(zip.file('sessions.json')).toBeTruthy();
    expect(zip.file('config.json')).toBeTruthy();
    expect(zip.file('files/hello.txt')).toBeTruthy();

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'));
    expect(manifest.app_version).toBe('v2607.3.0');
    expect(manifest.includes_api_keys).toBe(false);

    const config = JSON.parse(await zip.file('config.json')!.async('text'));
    expect(config.apiKey).toBe('[REDACTED]');
  });

  it('can include API keys when requested', async () => {
    saveConfig({ apiKey: 'secret123', searchApiKey: 'search-secret', model: 'test', baseUrl: 'http://localhost', maxTurns: 10, language: 'de', searchProvider: 'none' });
    const manager = new BackupManager('v2607.3.0');
    const blob = await manager.exportZip(true);
    const zip = await JSZip.loadAsync(blob);
    const config = JSON.parse(await zip.file('config.json')!.async('text'));
    expect(config.apiKey).toBe('secret123');
    expect(config.searchApiKey).toBe('search-secret');
  });

  it('imports backup zip and restores data', async () => {
    const manager = new BackupManager('v2607.3.0');
    const zip = new JSZip();
    const backup: AppBackup = {
      manifest: { version: 1, exported_at: new Date().toISOString(), app_version: 'v2607.3.0', includes_api_keys: false, workspace_id: 'default', workspace_name: 'Default' },
      memory: [{ id: 1, content: 'I love coffee', category: 'user', created_at: '2024-01-01T00:00:00.000Z' }],
      sessions: [{ id: 'session-1', title: 'Test', messages: [], created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' }],
      files: [],
      config: { model: 'imported', baseUrl: 'http://localhost', apiKey: '[REDACTED]', searchApiKey: '[REDACTED]', maxTurns: 10, language: 'de', searchProvider: 'none' },
      theme: 'dark',
      onboarding: JSON.stringify({ completed: true }),
    };
    zip.file('manifest.json', JSON.stringify(backup.manifest));
    zip.file('memory.json', JSON.stringify(backup.memory));
    zip.file('sessions.json', JSON.stringify(backup.sessions));
    zip.file('config.json', JSON.stringify(backup.config));
    zip.file('theme.json', JSON.stringify(backup.theme));
    zip.file('onboarding.json', JSON.stringify(backup.onboarding));

    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'test.zip', { type: 'application/zip' });

    await manager.importZip(file);

    const memory = new MemoryStore();
    const allMemories = await memory.searchAllMemory(100);
    // Import is a restore-append: backup memory entries get fresh autoIncrement
    // ids instead of overwriting unrelated local entries with colliding ids.
    expect(allMemories.some((m) => m.content === 'I love coffee')).toBe(true);

    const sessions = await memory.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].title).toBe('Test');

    const config = loadConfig();
    expect(config.model).toBe('imported');
    // Redacted keys in the backup should preserve current keys if the file was previously empty.
    expect(config.apiKey).toBe('');

    expect(localStorage.getItem('vibeAgentGo-theme')).toBe('dark');
  });
});