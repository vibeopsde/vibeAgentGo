// ============================================================
// vibeAgentGo — InstalledAppStore
// Apps are stored as a single HTML file in the workspace under
// apps/<Category>/<id>/index.html. Metadata is embedded in the HTML.
// ============================================================

import type { BridgeRequest, BridgeResponse, InstalledApp } from '../types/index.js';
import { parseAppManifest, type AppManifest } from './appManifest.js';

export type { InstalledApp } from '../types/index.js';

const APPS_ROOT = 'apps';

export interface AppStoreDependencies {
  bridge: (req: BridgeRequest) => Promise<BridgeResponse>;
}

export class InstalledAppStore {
  constructor(private deps: AppStoreDependencies) {}

  private async bridge(req: BridgeRequest): Promise<BridgeResponse> {
    return this.deps.bridge(req);
  }

  private static appPath(manifest: { category: string; id: string }): string {
    return `${APPS_ROOT}/${manifest.category}/${manifest.id}`;
  }

  async listInstalled(): Promise<InstalledApp[]> {
    const files = await this.bridge({ type: 'listFiles' });
    if (!files.ok || !Array.isArray(files.data)) return [];

    const entries = (files.data as { path: string; content: string }[]).filter(
      (f) => f.path.startsWith(`${APPS_ROOT}/`) && f.path.endsWith('/index.html')
    );

    const apps: InstalledApp[] = [];
    for (const entry of entries) {
      const parsed = parseAppManifest(entry.content);
      if (parsed.error || !parsed.manifest) continue;
      const m = parsed.manifest;
      apps.push({
        id: m.id,
        name: m.name,
        version: m.version,
        author: m.author,
        category: m.category,
        description: m.description,
        icon: m.icon,
        permissions: m.permissions,
        minVibeAgentGo: m.minVibeAgentGo ?? null,
        license: m.license ?? 'MIT',
        entryContent: entry.content,
        installedAt: '',
        updatedAt: '',
      });
    }
    return apps;
  }

  async getInstalled(id: string): Promise<InstalledApp | undefined> {
    const apps = await this.listInstalled();
    return apps.find((a) => a.id === id);
  }

  async installApp(app: InstalledApp): Promise<void> {
    const basePath = InstalledAppStore.appPath(app);
    await this.bridge({
      type: 'writeFile',
      path: `${basePath}/index.html`,
      content: app.entryContent,
    });
  }

  async uninstallApp(id: string): Promise<void> {
    const app = await this.getInstalled(id);
    if (!app) return;
    const files = await this.bridge({ type: 'listFiles' });
    if (!files.ok || !Array.isArray(files.data)) return;
    const basePath = InstalledAppStore.appPath(app);
    for (const file of files.data as { path: string }[]) {
      if (file.path.startsWith(`${basePath}/`)) {
        await this.bridge({ type: 'deleteFile', path: file.path });
      }
    }
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

  async readManifest(category: string, id: string): Promise<AppManifest | null> {
    const path = `${APPS_ROOT}/${category}/${id}/index.html`;
    const res = await this.bridge({ type: 'readFile', path });
    if (!res.ok || typeof res.data !== 'string') return null;
    const parsed = parseAppManifest(res.data);
    return parsed.error ? null : parsed.manifest;
  }
}
