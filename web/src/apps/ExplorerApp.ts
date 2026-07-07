// ============================================================
// vibeAgentGo — ExplorerApp
// File system browser for the workspace (IndexedDB via bridge).
// ============================================================

import type { App, BridgeRequest, BridgeResponse } from '../types/index.js';
import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';

interface FileEntry {
  path: string;
  content: string;
}

export class ExplorerApp implements App {
  id = 'explorer';
  title = 'Explorer';
  icon = '📁';
  element: HTMLElement;
  private listEl!: HTMLElement;
  private onBridgeRequest: ((req: BridgeRequest) => Promise<BridgeResponse>) | null = null;
  private onOpenFile: ((path: string) => void) | null = null;
  private onRunApp: ((title: string, html: string) => void) | null = null;
  private files: FileEntry[] = [];

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'explorer-app';
    this.build();
  }

  private build() {
    this.element.innerHTML = `
      <div class="explorer-header">
        <span class="explorer-title">${t('explorer.title') || 'Explorer'}</span>
        <button class="explorer-new-file" title="${t('explorer.newFile') || 'New file'}">＋</button>
        <button class="explorer-refresh" title="${t('explorer.refresh') || 'Refresh'}">↻</button>
      </div>
      <div class="explorer-list"></div>
      <div class="explorer-empty">${t('explorer.empty') || 'No files yet'}</div>
    `;

    this.listEl = this.element.querySelector('.explorer-list') as HTMLElement;

    this.element.querySelector('.explorer-new-file')?.addEventListener('click', () => this.createFile());
    this.element.querySelector('.explorer-refresh')?.addEventListener('click', () => this.refresh());
  }

  setBridgeHandler(handler: (req: BridgeRequest) => Promise<BridgeResponse>) {
    this.onBridgeRequest = handler;
  }

  setOnOpenFile(handler: (path: string) => void) {
    this.onOpenFile = handler;
  }

  setOnRunApp(handler: (title: string, html: string) => void) {
    this.onRunApp = handler;
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.element);
    this.refresh();
  }

  async refresh() {
    const res = await this.onBridgeRequest?.({ type: 'listFiles' });
    this.files = (res?.ok ? (res.data as FileEntry[]) : []) || [];
    this.render();
  }

  private render() {
    this.listEl.innerHTML = '';
    const empty = this.element.querySelector('.explorer-empty') as HTMLElement;
    if (this.files.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    for (const file of this.files) {
      const isHtml = file.path.toLowerCase().endsWith('.html');
      const el = document.createElement('div');
      el.className = 'explorer-item';
      el.innerHTML = `
        <span class="explorer-icon">${this.iconFor(file.path)}</span>
        <span class="explorer-name" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
        <div class="explorer-actions">
          ${isHtml ? '<button class="explorer-play" title="Run">▶</button>' : ''}
          <button class="explorer-delete" title="${t('common.delete') || 'Delete'}">×</button>
        </div>
      `;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.explorer-delete')) return;
        if ((e.target as HTMLElement).closest('.explorer-play')) return;
        this.onOpenFile?.(file.path);
      });
      el.querySelector('.explorer-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteFile(file.path);
      });
      if (isHtml) {
        el.querySelector('.explorer-play')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          this.runHtml(file.path);
        });
      }
      this.listEl.appendChild(el);
    }
  }

  private iconFor(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: '📘', js: '📜', json: '📋', md: '📝', html: '🌐', css: '🎨', py: '🐍',
      txt: '📄', yml: '⚙️', yaml: '⚙️', xml: '📠', csv: '📊', log: '📋',
    };
    return map[ext] || '📄';
  }

  private async createFile() {
    const name = window.prompt(t('explorer.newFilePrompt') || 'New file name (e.g. notes.md):');
    if (!name) return;
    const path = name.trim().replace(/^\/+/, '');
    if (!path) return;

    const existing = this.files.find((f) => f.path === path);
    if (existing) {
      window.alert(t('explorer.fileExists') || 'File already exists');
      this.onOpenFile?.(path);
      return;
    }

    await this.onBridgeRequest?.({ type: 'writeFile', path, content: '' });
    await this.refresh();
    this.onOpenFile?.(path);
  }

  private async deleteFile(path: string) {
    if (!window.confirm((t('explorer.confirmDelete') || 'Delete {path}?').replace('{path}', path))) return;
    await this.onBridgeRequest?.({ type: 'deleteFile', path });
    await this.refresh();
  }

  private async runHtml(path: string) {
    const res = await this.onBridgeRequest?.({ type: 'readFile', path });
    if (!res?.ok) return;
    const html = String(res.data);
    const title = path.split('/').pop() || path;
    this.onRunApp?.(title, html);
  }
}
