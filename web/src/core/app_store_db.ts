// ============================================================
// vibeAgentGo — InstalledAppStore
// Apps are stored as files in the workspace under apps/<Category>/<id>/.
// This makes them visible in the Explorer, editable, backup-able, and forkable.
// ============================================================

import type { BridgeRequest, BridgeResponse, InstalledApp } from '../types/index.js';

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

  private appPath(app: { category: string; id: string }): string {
    return `${APPS_ROOT}/${app.category}/${app.id}`;
  }

  async listInstalled(): Promise<InstalledApp[]> {
    const files = await this.bridge({ type: 'listFiles' });
    if (!files.ok || !Array.isArray(files.data)) return [];

    const manifests = (files.data as { path: string; content: string }[]).filter((f) =>
      f.path.startsWith(`${APPS_ROOT}/`) && f.path.endsWith('/vAG-app.json')
    );

    const apps: InstalledApp[] = [];
    for (const mf of manifests) {
      try {
        const manifest = JSON.parse(mf.content) as Omit<InstalledApp, 'entryContent' | 'installedAt' | 'updatedAt'>;
        const entryPath = mf.path.replace(/vAG-app\.json$/, manifest.entry || 'index.html');
        const entry = await this.bridge({ type: 'readFile', path: entryPath });
        apps.push({
          ...manifest,
          entryContent: entry.ok && typeof entry.data === 'string' ? entry.data : '',
          installedAt: '',
          updatedAt: '',
        });
      } catch {
        /* skip invalid manifests */
      }
    }
    return apps;
  }

  async getInstalled(id: string): Promise<InstalledApp | undefined> {
    const apps = await this.listInstalled();
    return apps.find((a) => a.id === id);
  }

  async installApp(app: InstalledApp): Promise<void> {
    const basePath = this.appPath(app);

    const manifest = {
      id: app.id,
      name: app.name,
      version: app.version,
      author: app.author,
      category: app.category,
      description: app.description,
      icon: app.icon,
      entry: app.entry,
      permissions: app.permissions,
      minVibeAgentGo: app.minVibeAgentGo,
      license: app.license,
    };

    await this.bridge({ type: 'writeFile', path: `${basePath}/vAG-app.json`, content: JSON.stringify(manifest, null, 2) });
    await this.bridge({ type: 'writeFile', path: `${basePath}/${app.entry}`, content: app.entryContent });
    if (app.icon) {
      await this.bridge({ type: 'writeFile', path: `${basePath}/${app.icon}`, content: app.iconContent || '' });
    }
  }

  async uninstallApp(id: string): Promise<void> {
    const app = await this.getInstalled(id);
    if (!app) return;
    const files = await this.bridge({ type: 'listFiles' });
    if (!files.ok || !Array.isArray(files.data)) return;
    const basePath = this.appPath(app);
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
}
