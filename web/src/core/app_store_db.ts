// ============================================================
// vibeAgentGo — InstalledAppStore
// Stores installed vAG-Apps in the shared IndexedDB.
// Uses db.ts helpers so we keep one connection / one schema version.
// ============================================================

import { tx, txAll, cursorAll } from './db.js';
import type { InstalledApp } from '../types/index.js';

export type { InstalledApp } from '../types/index.js';

export class InstalledAppStore {
  async listInstalled(): Promise<InstalledApp[]> {
    return cursorAll<InstalledApp>('installedApps', 'prev');
  }

  async getInstalled(id: string): Promise<InstalledApp | undefined> {
    return tx<InstalledApp | undefined>('installedApps', 'readonly', (store) => store.get(id));
  }

  async installApp(app: InstalledApp): Promise<void> {
    const existing = await this.getInstalled(app.id);
    const now = new Date().toISOString();
    const toSave: InstalledApp = {
      ...app,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };
    await tx('installedApps', 'readwrite', (store) => store.put(toSave));
  }

  async uninstallApp(id: string): Promise<void> {
    await tx('installedApps', 'readwrite', (store) => store.delete(id));
  }

  async isInstalled(id: string): Promise<boolean> {
    const app = await this.getInstalled(id);
    return Boolean(app);
  }

  async needsUpdate(id: string, version: string): Promise<boolean> {
    const app = await this.getInstalled(id);
    if (!app) return false;
    return app.version !== version;
  }
}
