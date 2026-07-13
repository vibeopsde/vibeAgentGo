// ============================================================
// vibeAgentGo — AppStoreApp
// Browse available apps from the remote index and manage installed apps
// that live as single HTML files in the workspace under apps/<Category>/<id>/.
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
  icon: string;
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
  private activeTab: 'store' | 'installed' = 'installed';
  private status = 'idle';
  private message = '';
  private onBridgeRequest: ((req: BridgeRequest) => Promise<BridgeResponse>) | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly REFRESH_INTERVAL_MS = 30000;

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
    this.startRefreshLoop();
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
      const cacheBuster = Date.now();
      const res = await fetch(`https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/index.json?nocache=${cacheBuster}`);
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

  private startRefreshLoop() {
    this.stopRefreshLoop();
    this.refreshTimer = setInterval(() => {
      if (this.status !== 'installing') {
        this.load().catch(() => {});
      }
    }, this.REFRESH_INTERVAL_MS);
  }

  private stopRefreshLoop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refreshInstalled() {
    const files = await this.bridge({ type: 'listFiles' });
    if (!files.ok || !Array.isArray(files.data)) return;

    const installed: InstalledApp[] = [];
    for (const f of files.data as { path: string; content: string }[]) {
      if (!f.path.startsWith('apps/') || !f.path.endsWith('/index.html')) continue;
      const match = f.content.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>[\s\S]*?<\/script>/i);
      if (!match) continue;
      try {
        const manifest = JSON.parse(match[0].replace(/<[^>]+>/g, '').trim()) as StoreAppEntry;
        installed.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          author: manifest.author,
          category: manifest.category,
          description: manifest.description,
          icon: manifest.icon || '📦',
          permissions: manifest.permissions || [],
          minVibeAgentGo: manifest.minVibeAgentGo ?? null,
          license: manifest.license ?? 'MIT',
          entryContent: f.content,
          installedAt: '',
          updatedAt: '',
        });
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

  private getUpdatableApps(): StoreAppEntry[] {
    if (!this.store) return [];
    return this.store.apps.filter((app) => {
      const installed = this.installed.get(app.id);
      return installed && installed.version !== app.version;
    });
  }

  private getInstalledApps(): StoreAppEntry[] {
    if (!this.store) return [];
    return this.store.apps.filter((app) => this.installed.has(app.id));
  }

  private async install(app: StoreAppEntry) {
    this.status = 'installing';
    this.message = t('appstore.installing') || `Installing ${app.name}...`;
    this.render();

    try {
      const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html?nocache=${Date.now()}`;
      const res = await fetch(entryUrl);
      if (!res.ok) throw new Error(`Failed to fetch entry: ${res.status}`);
      const entryContent = await res.text();

      const installed: InstalledApp = {
        id: app.id,
        name: app.name,
        version: app.version,
        author: app.author,
        category: app.category,
        description: app.description,
        icon: app.icon || '📦',
        permissions: app.permissions,
        minVibeAgentGo: app.minVibeAgentGo,
        license: app.license,
        entryContent,
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

  private async updateAll() {
    const updatable = this.getUpdatableApps();
    if (updatable.length === 0) return;
    this.status = 'installing';
    this.message = t('appstore.installing') || 'Updating apps...';
    this.render();

    for (const app of updatable) {
      try {
        const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html?nocache=${Date.now()}`;
        const res = await fetch(entryUrl);
        if (!res.ok) continue;
        const entryContent = await res.text();
        const installed: InstalledApp = {
          id: app.id,
          name: app.name,
          version: app.version,
          author: app.author,
          category: app.category,
          description: app.description,
          icon: app.icon || '📦',
          permissions: app.permissions,
          minVibeAgentGo: app.minVibeAgentGo,
          license: app.license,
          entryContent,
          installedAt: this.installed.get(app.id)?.installedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.bridge({ type: 'installApp', app: installed });
      } catch {
        /* skip failed update */
      }
    }
    await this.refreshInstalled();
    this.status = 'idle';
    this.render();
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

    const updatable = this.getUpdatableApps();
    const updateCount = updatable.length;

    const header = document.createElement('div');
    header.className = 'appstore-header';
    header.innerHTML = `
      <span class="appstore-title" title="${escapeHtml(this.store?.generatedAt || '')}">${t('appstore.title') || 'App Store'}</span>
      <span class="appstore-update-count ${updateCount ? 'visible' : ''}">${escapeHtml(
        (t('appstore.updatesAvailable') || '{count} update(s) available').replace('{count}', String(updateCount))
      )}</span>
      <button class="appstore-update-all ${updateCount ? 'visible' : ''}" title="${t('appstore.updateAll') || 'Update all'}">⬆️</button>
      <button class="appstore-refresh" title="${t('appstore.refresh') || 'Refresh'}">↻</button>
    `;
    header.querySelector('.appstore-refresh')?.addEventListener('click', () => this.load());
    header.querySelector('.appstore-update-all')?.addEventListener('click', () => this.updateAll());

    const tabs = document.createElement('div');
    tabs.className = 'appstore-tabs';
    const storeTab = document.createElement('button');
    storeTab.className = `appstore-tab${this.activeTab === 'store' ? ' active' : ''}`;
    storeTab.textContent = t('appstore.tabStore') || 'Store';
    storeTab.addEventListener('click', () => {
      this.activeTab = 'store';
      this.render();
    });
    const installedTab = document.createElement('button');
    installedTab.className = `appstore-tab${this.activeTab === 'installed' ? ' active' : ''}`;
    installedTab.textContent = t('appstore.tabInstalled') || 'My Apps';
    installedTab.addEventListener('click', () => {
      this.activeTab = 'installed';
      this.render();
    });
    tabs.appendChild(storeTab);
    tabs.appendChild(installedTab);

    const content = document.createElement('div');
    content.className = 'appstore-tab-content';

    if (this.activeTab === 'store') {
      this.renderStoreContent(content);
    } else {
      this.renderInstalledContent(content);
    }

    this.element.appendChild(header);
    this.element.appendChild(tabs);
    this.element.appendChild(content);
  }

  private renderStoreContent(container: HTMLElement) {
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
      grid.innerHTML = `\u003cdiv class="appstore-status"\u003e\n        \u003cdiv class="appstore-spinner"\u003e\u003c/div\u003e\n        \u003cspan\u003e${escapeHtml(this.message)}\u003c/span\u003e\n      \u003c/div\u003e`;
    } else if (this.status === 'error') {
      grid.innerHTML = `\u003cdiv class="appstore-status appstore-error"\u003e${escapeHtml(this.message)}\u003c/div\u003e`;
    } else {
      const apps = this.getFilteredApps();
      if (apps.length === 0) {
        grid.innerHTML = `\u003cdiv class="appstore-status"\u003e${t('appstore.empty') || 'No apps available.'}\u003c/div\u003e`;
      } else {
        for (const app of apps) {
          grid.appendChild(this.renderAppCard(app));
        }
      }
    }

    container.appendChild(filters);
    container.appendChild(grid);
  }

  private renderInstalledContent(container: HTMLElement) {
    const grid = document.createElement('div');
    grid.className = 'appstore-grid';

    if (this.status === 'loading' || this.status === 'installing') {
      grid.innerHTML = `\u003cdiv class="appstore-status"\u003e\n        \u003cdiv class="appstore-spinner"\u003e\u003c/div\u003e\n        \u003cspan\u003e${escapeHtml(this.message)}\u003c/span\u003e\n      \u003c/div\u003e`;
    } else if (this.status === 'error') {
      grid.innerHTML = `\u003cdiv class="appstore-status appstore-error"\u003e${escapeHtml(this.message)}\u003c/div\u003e`;
    } else {
      const apps = this.getInstalledApps();
      if (apps.length === 0) {
        grid.innerHTML = `\u003cdiv class="appstore-status"\u003e${t('appstore.noInstalledApps') || 'No apps installed yet. Browse the Store to install some.'}\u003c/div\u003e`;
      } else {
        for (const app of apps) {
          grid.appendChild(this.renderAppCard(app));
        }
      }
    }

    container.appendChild(grid);
  }

  private renderAppCard(app: StoreAppEntry): HTMLElement {
    const installed = this.installed.get(app.id);
    const needsUpdate = installed ? installed.version !== app.version : false;

    const card = document.createElement('div');
    card.className = 'appstore-card';

    const icon = document.createElement('div');
    icon.className = 'appstore-card-icon';
    icon.textContent = app.icon || '📦';

    const body = document.createElement('div');
    body.className = 'appstore-card-body';
    body.innerHTML = `
      \u003cdiv class="appstore-card-name"\u003e${escapeHtml(app.name)}${needsUpdate ? ' \u003cspan class="appstore-update-badge"\u003eUPDATE\u003c/span\u003e' : ''}\u003c/div\u003e
      \u003cdiv class="appstore-card-meta"\u003e${escapeHtml(app.category)} · v${escapeHtml(app.version)} · ${escapeHtml(app.author)}\u003c/div\u003e
      \u003cdiv class="appstore-card-desc"\u003e${escapeHtml(app.description || '')}\u003c/div\u003e
      \u003cdiv class="appstore-card-perms"\u003e${this.renderPermissions(app.permissions)}\u003c/div\u003e
      ${installed ? `\u003cdiv class="appstore-card-installed"\u003e${escapeHtml(
          (t('appstore.installedVersion') || 'Installed: v{version}').replace('{version}', installed.version)
        )}\u003c/div\u003e` : ''}
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
