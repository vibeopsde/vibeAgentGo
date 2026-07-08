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

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
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
  private expandedFolders = new Set<string>();
  private activePath: string | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'explorer-app';
    this.build();
  }

  private build() {
    this.element.innerHTML = `
      <div class="explorer-header">
        <span class="explorer-title">${t('explorer.title') || 'Explorer'}</span>
        <button class="explorer-new-folder" title="${t('explorer.newFolder') || 'New folder'}">📁＋</button>
        <button class="explorer-new-file" title="${t('explorer.newFile') || 'New file'}">＋</button>
        <button class="explorer-refresh" title="${t('explorer.refresh') || 'Refresh'}">↻</button>
      </div>
      <div class="explorer-list"></div>
      <div class="explorer-empty">${t('explorer.empty') || 'No files yet'}</div>
    `;

    this.listEl = this.element.querySelector('.explorer-list') as HTMLElement;

    this.element.querySelector('.explorer-new-folder')?.addEventListener('click', () => this.createFolder());
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

  setActivePath(path: string | null) {
    this.activePath = path;
    this.render();
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

    const tree = this.buildTree();
    for (const node of tree) {
      this.renderNode(this.listEl, node, 0);
    }
  }

  private buildTree(): TreeNode[] {
    const root: TreeNode[] = [];
    const map = new Map<string, TreeNode>();

    const sorted = [...this.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of sorted) {
      const parts = file.path.split('/');
      let parentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const path = i === 0 ? part : `${parentPath}/${part}`;
        const isFolder = i < parts.length - 1 || part === '.keep';
        const existing = map.get(path);
        if (!existing) {
          const node: TreeNode = { name: part, path, isFolder, children: [] };
          map.set(path, node);
          if (i === 0) {
            root.push(node);
          } else {
            const parent = map.get(parentPath)!;
            parent.children.push(node);
          }
        }
        parentPath = path;
      }
    }
    return root;
  }

  private renderNode(container: HTMLElement, node: TreeNode, depth: number) {
    // Hide placeholder .keep files from the tree; they only exist to keep empty folders visible
    if (node.name === '.keep' && node.isFolder) return;

    const el = document.createElement('div');
    el.className = node.isFolder ? 'explorer-folder' : 'explorer-item';
    if (!node.isFolder && node.path === this.activePath) {
      el.classList.add('active');
    }
    el.style.paddingLeft = `${depth * 16 + 8}px`;

    if (node.isFolder) {
      const expanded = this.expandedFolders.has(node.path);
      el.innerHTML = `
        <span class="explorer-folder-toggle">${expanded ? '▼' : '▶'}</span>
        <span class="explorer-icon">📁</span>
        <span class="explorer-name">${escapeHtml(node.name)}</span>
        <div class="explorer-folder-actions">
          <button class="explorer-rename" title="${t('common.rename') || 'Rename'}">✎</button>
          <button class="explorer-delete" title="${t('common.delete') || 'Delete'}">×</button>
        </div>
      `;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.explorer-folder-actions')) return;
        this.toggleFolder(node.path);
      });
      el.querySelector('.explorer-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteFolder(node.path);
      });
      el.querySelector('.explorer-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameFolder(node.path);
      });
      container.appendChild(el);
      if (expanded) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'explorer-folder-children';
        for (const child of node.children) {
          this.renderNode(childrenContainer, child, depth + 1);
        }
        container.appendChild(childrenContainer);
      }
      return;
    }

    const isHtml = node.path.toLowerCase().endsWith('.html');
    el.innerHTML = `
      <span class="explorer-icon">${this.iconFor(node.path)}</span>
      <span class="explorer-name" title="${escapeHtml(node.path)}">${escapeHtml(node.name)}</span>
      <div class="explorer-actions">
        ${isHtml ? '<button class="explorer-play" title="Run">▶</button>' : ''}
        <button class="explorer-rename" title="${t('common.rename') || 'Rename'}">✎</button>
        <button class="explorer-delete" title="${t('common.delete') || 'Delete'}">×</button>
      </div>
    `;
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.explorer-actions')) return;
      this.activePath = node.path;
      this.onOpenFile?.(node.path);
      this.render();
    });
    el.querySelector('.explorer-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteFile(node.path);
    });
    el.querySelector('.explorer-rename')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.renameFile(node.path);
    });
    if (isHtml) {
      el.querySelector('.explorer-play')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.runHtml(node.path);
      });
    }
    container.appendChild(el);
  }

  private toggleFolder(path: string) {
    if (this.expandedFolders.has(path)) {
      this.expandedFolders.delete(path);
    } else {
      this.expandedFolders.add(path);
    }
    this.render();
  }

  private iconFor(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: '📘', js: '📜', json: '📋', md: '📝', html: '🌐', css: '🎨', py: '🐍',
      txt: '📄', yml: '⚙️', yaml: '⚙️', xml: '📠', csv: '📊', log: '📋',
    };
    return map[ext] || '📄';
  }

  private async createFolder() {
    const name = window.prompt(t('explorer.newFolderPrompt') || 'New folder name (e.g. my-project):');
    if (!name) return;
    const folderPath = name.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!folderPath) return;
    const path = `${folderPath}/.keep`;

    const existing = this.files.find((f) => f.path === path || f.path === folderPath || f.path.startsWith(`${folderPath}/`));
    if (existing) {
      window.alert(t('explorer.folderExists') || 'Folder already exists');
      this.expandedFolders.add(folderPath);
      this.render();
      return;
    }

    await this.onBridgeRequest?.({ type: 'writeFile', path, content: '' });
    await this.refresh();
    this.expandedFolders.add(folderPath);
    this.render();
  }

  private async createFile() {
    const name = window.prompt(t('explorer.newFilePrompt') || 'New file name (e.g. notes.md or my-folder/notes.md):');
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
    this.expandedFolders.add(path.split('/').slice(0, -1).join('/'));
    this.render();
    this.activePath = path;
    this.onOpenFile?.(path);
  }

  private async deleteFile(path: string) {
    if (!window.confirm((t('explorer.confirmDelete') || 'Delete {path}?').replace('{path}', path))) return;
    await this.onBridgeRequest?.({ type: 'deleteFile', path });
    if (this.activePath === path) this.activePath = null;
    await this.refresh();
  }

  private async renameFile(oldPath: string) {
    const oldName = oldPath.split('/').pop() || oldPath;
    const newName = window.prompt(t('explorer.renamePrompt') || 'Rename file:', oldName);
    if (!newName || newName.trim() === oldName.trim()) return;
    const cleanName = newName.trim().replace(/^\/+/, '');
    if (!cleanName) return;
    const newPath = oldPath.split('/').slice(0, -1).concat(cleanName).join('/');
    if (this.files.some((f) => f.path === newPath)) {
      window.alert(t('explorer.fileExists') || 'A file already exists with that name');
      return;
    }
    const content = this.files.find((f) => f.path === oldPath)?.content ?? '';
    await this.onBridgeRequest?.({ type: 'writeFile', path: newPath, content });
    await this.onBridgeRequest?.({ type: 'deleteFile', path: oldPath });
    if (this.activePath === oldPath) this.activePath = newPath;
    await this.refresh();
  }

  private async deleteFolder(path: string) {
    const children = this.files.filter((f) => f.path === path || f.path.startsWith(`${path}/`));
    if (children.length === 0) return;
    if (!window.confirm((t('explorer.confirmDeleteFolder') || 'Delete folder {path} and all its contents?').replace('{path}', path))) return;
    for (const file of children) {
      await this.onBridgeRequest?.({ type: 'deleteFile', path: file.path });
    }
    if (this.activePath && this.activePath.startsWith(`${path}/`)) this.activePath = null;
    this.expandedFolders.delete(path);
    await this.refresh();
  }

  private async renameFolder(oldPath: string) {
    const oldName = oldPath.split('/').pop() || oldPath;
    const newName = window.prompt(t('explorer.renameFolderPrompt') || 'Rename folder:', oldName);
    if (!newName || newName.trim() === oldName.trim()) return;
    const cleanName = newName.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!cleanName) return;
    const parentPath = oldPath.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;

    if (this.files.some((f) => f.path === newPath || f.path.startsWith(`${newPath}/`))) {
      window.alert(t('explorer.folderExists') || 'A folder already exists with that name');
      return;
    }

    const affected = this.files.filter((f) => f.path === oldPath || f.path.startsWith(`${oldPath}/`));
    for (const file of affected) {
      const newFilePath = file.path.replace(oldPath, newPath);
      await this.onBridgeRequest?.({ type: 'writeFile', path: newFilePath, content: file.content });
    }
    for (const file of affected) {
      await this.onBridgeRequest?.({ type: 'deleteFile', path: file.path });
    }
    if (this.activePath && this.activePath.startsWith(`${oldPath}/`)) {
      this.activePath = this.activePath.replace(oldPath, newPath);
    }
    if (this.expandedFolders.has(oldPath)) {
      this.expandedFolders.delete(oldPath);
      this.expandedFolders.add(newPath);
    }
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
