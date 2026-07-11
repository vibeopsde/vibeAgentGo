// ============================================================
// vibeAgentGo — AppStoreApp
// Browse available apps from the remote index and manage installed apps
// that live as files in the workspace under apps/<Category>/<id>/.
// ============================================================

import type { App, BridgeRequest, BridgeResponse, InstalledApp } from '../types/index.js';
import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';

export interface StoreAppEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  icon: string | null;
  entry: string;
  path: string;
  minVibeAgentGo: string | null;
  license: string | null;
  permissions: string[];
}

export interface StoreIndex {
  generatedAt: string;
  count: number;
  apps: StoreAppEntry[];
}

export class AppStoreApp implements App {
  id = 'appstore';
  title = 'App Store';
  icon = '🛍️';
  element: HTMLElement;

  private store: StoreIndex | null = null;
  private installed: Map<string, InstalledApp> = new Map();
  private categories: string[] = [];
  private selectedCategory: string | 'all' = 'all';
  private status = 'idle';
  private message = '';
  private onBridgeRequest: ((req: BridgeRequest) => Promise<BridgeResponse>) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'appstore-app';
    this.build();
  }

  setBridgeHandler(handler: (req: BridgeRequest) => Promise<BridgeResponse>) {
    this.onBridgeRequest = handler;
  }

  setInstalled(installed: InstalledApp[]) {
    this.installed = new Map(installed.map((a) => [a.id, a]));
    this.render();
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.element);
    this.load();
  }

  private async bridge(req: BridgeRequest): Promise<BridgeResponse> {
    if (!this.onBridgeRequest) return { ok: false, error: 'No bridge handler' };
    return this.onBridgeRequest(req);
  }

  private async load() {
    this.status = 'loading';
    this.message = t('appstore.loading') || 'Loading App Store...';
    this.render();

    try {
      const res = await fetch('https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.store = (await res.json()) as StoreIndex;
      this.categories = Array.from(new Set(this.store.apps.map((a) => a.category))).sort();
      await this.refreshInstalled();
      this.status = 'idle';
    } catch (e) {
      this.status = 'error';
      this.message = t('appstore.error') || `Failed to load App Store: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.render();
  }

  private async refreshInstalled() {
    const files = await this.bridge({ type: 'listFiles' });
    if (!files.ok || !Array.isArray(files.data)) return;

    const manifests = (files.data as { path: string; content: string }[]).filter((f) =>
      f.path.startsWith('apps/') && f.path.endsWith('/vAG-app.json')
    );

    const installed: InstalledApp[] = [];
    for (const mf of manifests) {
      try {
        const manifest = JSON.parse(mf.content) as StoreAppEntry;
        const entryPath = mf.path.replace(/vAG-app\.json$/, manifest.entry || 'index.html');
        const entry = await this.bridge({ type: 'readFile', path: entryPath });
        installed.push({
          ...manifest,
          entryContent: entry.ok && typeof entry.data === 'string' ? entry.data : '',
        } as InstalledApp);
      } catch {
        /* skip invalid */
      }
    }
    this.installed = new Map(installed.map((a) => [a.id, a]));
  }

  private getFilteredApps(): StoreAppEntry[] {
    if (!this.store) return [];
    if (this.selectedCategory === 'all') return this.store.apps;
    return this.store.apps.filter((a) => a.category === this.selectedCategory);
  }

  private async install(app: StoreAppEntry) {
    this.status = 'installing';
    this.message = t('appstore.installing') || `Installing ${app.name}...`;
    this.render();

    try {
      const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/${app.entry}`;
      const res = await fetch(entryUrl);
      if (!res.ok) throw new Error(`Failed to fetch entry: ${res.status}`);
      const entryContent = await res.text();

      const iconContent = await this.fetchIcon(app);

      const installed: InstalledApp = {
        ...app,
        entryContent,
        icon: iconContent,
        iconContent,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.bridge({ type: 'installApp', app: installed });
      await this.refreshInstalled();
      this.status = 'idle';
    } catch (e) {
      this.status = 'error';
      this.message = t('appstore.installError') || `Install failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.render();
  }

  private async fetchIcon(app: StoreAppEntry): Promise<string | null> {
    if (!app.icon) return null;
    try {
      const iconUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/${app.icon}`;
      const res = await fetch(iconUrl);
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  }

  private async uninstall(app: StoreAppEntry) {
    await this.bridge({ type: 'uninstallApp', id: app.id });
    await this.refreshInstalled();
    this.render();
  }

  private async launch(app: StoreAppEntry) {
    await this.bridge({ type: 'launchApp', id: app.id });
  }

  private build() {
    this.render();
  }

  private render() {
    this.element.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'appstore-header';
    header.innerHTML = `
      <span class="appstore-title">${t('appstore.title') || 'App Store'}</span>
      <button class="appstore-refresh" title="${t('appstore.refresh') || 'Refresh'}">↻</button>
    `;
    header.querySelector('.appstore-refresh')?.addEventListener('click', () => this.load());

    const filters = document.createElement('div');
    filters.className = 'appstore-filters';

    const allBtn = document.createElement('button');
    allBtn.className = `appstore-filter${this.selectedCategory === 'all' ? ' active' : ''}`;
    allBtn.textContent = t('appstore.all') || 'All';
    allBtn.addEventListener('click', () => {
      this.selectedCategory = 'all';
      this.render();
    });
    filters.appendChild(allBtn);

    for (const cat of this.categories) {
      const btn = document.createElement('button');
      btn.className = `appstore-filter${this.selectedCategory === cat ? ' active' : ''}`;
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        this.selectedCategory = cat;
        this.render();
      });
      filters.appendChild(btn);
    }

    const grid = document.createElement('div');
    grid.className = 'appstore-grid';

    if (this.status === 'loading' || this.status === 'installing') {
      grid.innerHTML = `<div class="appstore-status">
        <div class="appstore-spinner"></div>
        <span>${escapeHtml(this.message)}</span>
      </div>`;
    } else if (this.status === 'error') {
      grid.innerHTML = `<div class="appstore-status appstore-error">${escapeHtml(this.message)}</div>`;
    } else {
      const apps = this.getFilteredApps();
      if (apps.length === 0) {
        grid.innerHTML = `<div class="appstore-status">${t('appstore.empty') || 'No apps available.'}</div>`;
      } else {
        for (const app of apps) {
          grid.appendChild(this.renderAppCard(app));
        }
      }
    }

    this.element.appendChild(header);
    this.element.appendChild(filters);
    this.element.appendChild(grid);
  }

  private renderAppCard(app: StoreAppEntry): HTMLElement {
    const installed = this.installed.get(app.id);
    const needsUpdate = installed ? installed.version !== app.version : false;

    const card = document.createElement('div');
    card.className = 'appstore-card';

    const icon = document.createElement('div');
    icon.className = 'appstore-card-icon';
    if (installed?.icon) {
      icon.innerHTML = installed.icon;
    } else if (app.icon) {
      icon.textContent = '📦';
    } else {
      icon.textContent = '📄';
    }

    const body = document.createElement('div');
    body.className = 'appstore-card-body';
    body.innerHTML = `
      <div class="appstore-card-name">${escapeHtml(app.name)}</div>
      <div class="appstore-card-meta">${escapeHtml(app.category)} · v${escapeHtml(app.version)} · ${escapeHtml(app.author)}</div>
      <div class="appstore-card-desc">${escapeHtml(app.description || '')}</div>
      <div class="appstore-card-perms">${this.renderPermissions(app.permissions)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'appstore-card-actions';

    if (installed) {
      if (needsUpdate) {
        const updateBtn = document.createElement('button');
        updateBtn.className = 'appstore-btn primary';
        updateBtn.textContent = t('appstore.update') || 'Update';
        updateBtn.addEventListener('click', () => this.install(app));
        actions.appendChild(updateBtn);
      }
      const launchBtn = document.createElement('button');
      launchBtn.className = 'appstore-btn';
      launchBtn.textContent = t('appstore.launch') || 'Launch';
      launchBtn.addEventListener('click', () => this.launch(app));
      actions.appendChild(launchBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'appstore-btn danger';
      removeBtn.textContent = t('appstore.uninstall') || 'Uninstall';
      removeBtn.addEventListener('click', () => this.uninstall(app));
      actions.appendChild(removeBtn);
    } else {
      const installBtn = document.createElement('button');
      installBtn.className = 'appstore-btn primary';
      installBtn.textContent = t('appstore.install') || 'Install';
      installBtn.addEventListener('click', () => this.install(app));
      actions.appendChild(installBtn);
    }

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(actions);
    return card;
  }

  private renderPermissions(perms: string[]): string {
    if (!perms.length) return t('appstore.noPermissions') || 'No permissions required';
    return `${t('appstore.permissions') || 'Permissions'}: ${perms.join(', ')}`;
  }
}
