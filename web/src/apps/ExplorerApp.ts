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
  private contextMenu: HTMLElement | null = null;
  private searchQuery = '';

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
        <button class="explorer-upload" title="${t('explorer.upload') || 'Upload files'}">⬆</button>
        <button class="explorer-refresh" title="${t('explorer.refresh') || 'Refresh'}">↻</button>
      </div>
      <div class="explorer-search">
        <input type="text" class="explorer-search-input" placeholder="${t('explorer.search') || 'Search files...'}" />
      </div>
      <div class="explorer-breadcrumbs"></div>
      <div class="explorer-list" tabindex="0"></div>
      <div class="explorer-details"></div>
      <div class="explorer-empty">${t('explorer.empty') || 'No files yet'}</div>
      <input type="file" class="explorer-upload-input" multiple style="display: none;">
    `;

    this.listEl = this.element.querySelector('.explorer-list') as HTMLElement;
    const uploadInput = this.element.querySelector('.explorer-upload-input') as HTMLInputElement;
    const searchInput = this.element.querySelector('.explorer-search-input') as HTMLInputElement;

    this.element.querySelector('.explorer-new-folder')?.addEventListener('click', () => this.createFolder());
    this.element.querySelector('.explorer-new-file')?.addEventListener('click', () => this.createFile());
    this.element.querySelector('.explorer-refresh')?.addEventListener('click', () => this.refresh());
    this.element.querySelector('.explorer-upload')?.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => this.handleUpload(uploadInput.files));
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.render();
    });

    this.setupDragDrop();
    document.addEventListener('click', () => this.closeContextMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeContextMenu();
    });
  }

  private setupDragDrop() {
    this.listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.listEl.classList.add('drag-over');
    });
    this.listEl.addEventListener('dragleave', () => {
      this.listEl.classList.remove('drag-over');
    });
    this.listEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.listEl.classList.remove('drag-over');
      if (e.dataTransfer?.files.length) {
        await this.handleUpload(e.dataTransfer.files);
      }
    });
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
    this.closeContextMenu();
    this.listEl.innerHTML = '';
    this.renderBreadcrumbs();
    this.renderDetails();
    const empty = this.element.querySelector('.explorer-empty') as HTMLElement;
    if (this.files.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    const tree = this.buildTree();
    if (this.searchQuery) {
      const filtered = this.collectSearchResults(tree);
      if (filtered.length === 0) {
        this.listEl.innerHTML = `<div class="explorer-no-results">${t('explorer.noResults') || 'No files found'}</div>`;
      } else {
        for (const node of filtered) {
          this.renderNode(this.listEl, node, 0, true);
        }
      }
      return;
    }
    for (const node of tree) {
      this.renderNode(this.listEl, node, 0, false);
    }
  }

  private collectSearchResults(tree: TreeNode[]): TreeNode[] {
    const results: TreeNode[] = [];
    const walk = (node: TreeNode) => {
      if (!node.isFolder) {
        if (node.name.toLowerCase().includes(this.searchQuery) || node.path.toLowerCase().includes(this.searchQuery)) {
          results.push(node);
        }
      }
      for (const child of node.children) walk(child);
    };
    for (const node of tree) walk(node);
    return results;
  }

  private renderBreadcrumbs() {
    const el = this.element.querySelector('.explorer-breadcrumbs') as HTMLElement;
    if (!this.activePath) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    const parts = this.activePath.split('/');
    let acc = '';
    const crumbs = parts.map((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLast = i === parts.length - 1;
      return `<button class="explorer-crumb${isLast ? ' active' : ''}" data-path="${escapeHtml(acc)}" ${isLast ? 'disabled' : ''}>${escapeHtml(part)}</button>`;
    });
    el.innerHTML = `<button class="explorer-crumb" data-path="">${t('explorer.root') || 'Root'}</button> > ${crumbs.join(' > ')}`;
    el.querySelectorAll('.explorer-crumb').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).dataset.path ?? '';
        if (!path) return;
        if (path.split('/').length === 1 || this.files.some((f) => f.path === path || f.path.startsWith(`${path}/`))) {
          this.expandedFolders.add(path);
        }
        this.render();
      });
    });
  }

  private renderDetails() {
    const el = this.element.querySelector('.explorer-details') as HTMLElement;
    if (!this.activePath) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    const file = this.files.find((f) => f.path === this.activePath);
    const isFolder = !file && this.files.some((f) => f.path.startsWith(`${this.activePath}/`));
    el.style.display = 'block';
    if (file) {
      const bytes = new Blob([file.content]).size;
      const lines = file.content.split('\n').length;
      el.innerHTML = `
        <div class="explorer-detail-row"><span>Path</span><span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span></div>
        <div class="explorer-detail-row"><span>Size</span><span>${this.formatBytes(bytes)}</span></div>
        <div class="explorer-detail-row"><span>Lines</span><span>${lines}</span></div>
      `;
    } else if (isFolder) {
      const childCount = this.files.filter(
        (f) => f.path.startsWith(`${this.activePath}/`) && !f.path.slice(`${this.activePath}/`.length).includes('/')
      ).length;
      el.innerHTML = `
        <div class="explorer-detail-row"><span>Path</span><span title="${escapeHtml(this.activePath)}">${escapeHtml(this.activePath)}</span></div>
        <div class="explorer-detail-row"><span>Type</span><span>Folder</span></div>
        <div class="explorer-detail-row"><span>Items</span><span>${childCount}</span></div>
      `;
    } else {
      el.style.display = 'none';
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  private renderNode(container: HTMLElement, node: TreeNode, depth: number, flatSearch = false) {
    if (node.name === '.keep' && node.isFolder) return;

    const el = document.createElement('div');
    el.className = node.isFolder ? 'explorer-folder' : 'explorer-item';
    if (!node.isFolder && node.path === this.activePath) {
      el.classList.add('active');
    }
    el.style.paddingLeft = `${depth * 16 + 8}px`;
    el.draggable = !node.isFolder;
    el.dataset.path = node.path;
    el.dataset.type = node.isFolder ? 'folder' : 'file';

    if (node.isFolder) {
      const expanded = this.expandedFolders.has(node.path) || this.searchQuery !== '';
      el.innerHTML = `
        <span class="explorer-folder-toggle">${expanded ? '▼' : '▶'}</span>
        <span class="explorer-icon">${expanded ? '📂' : '📁'}</span>
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
      this.attachFolderDragDrop(el, node.path);
      container.appendChild(el);
      if (expanded) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'explorer-folder-children';
        for (const child of node.children) {
          this.renderNode(childrenContainer, child, depth + 1, flatSearch);
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
        <button class="explorer-duplicate" title="${t('explorer.duplicate') || 'Duplicate'}">⎘</button>
        <button class="explorer-download" title="${t('explorer.download') || 'Download'}">⬇</button>
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
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, node.path, false);
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', node.path);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });
    el.querySelector('.explorer-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteFile(node.path);
    });
    el.querySelector('.explorer-rename')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.renameFile(node.path);
    });
    el.querySelector('.explorer-duplicate')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.duplicateFile(node.path);
    });
    el.querySelector('.explorer-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.downloadFile(node.path);
    });
    if (isHtml) {
      el.querySelector('.explorer-play')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.runHtml(node.path);
      });
    }
    container.appendChild(el);
  }

  private attachFolderDragDrop(el: HTMLElement, folderPath: string) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-target');
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-target');
      const path = e.dataTransfer?.getData('text/plain');
      if (!path || path === folderPath) return;
      if (path.startsWith(`${folderPath}/`)) return;
      await this.moveFileIntoFolder(path, folderPath);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, folderPath, true);
    });
  }

  private async moveFileIntoFolder(filePath: string, folderPath: string) {
    const file = this.files.find((f) => f.path === filePath);
    if (!file) return;
    const name = filePath.split('/').pop() || filePath;
    const newPath = `${folderPath}/${name}`;
    if (this.files.some((f) => f.path === newPath)) {
      window.alert(t('explorer.fileExists') || 'A file already exists in that folder');
      return;
    }
    await this.onBridgeRequest?.({ type: 'writeFile', path: newPath, content: file.content });
    await this.onBridgeRequest?.({ type: 'deleteFile', path: filePath });
    if (this.activePath === filePath) this.activePath = newPath;
    this.expandedFolders.add(folderPath);
    await this.refresh();
  }

  private showContextMenu(x: number, y: number, path: string, isFolder: boolean) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'explorer-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <button data-action="rename">${t('common.rename') || 'Rename'}</button>
      <button data-action="duplicate">${t('explorer.duplicate') || 'Duplicate'}</button>
      ${!isFolder ? `<button data-action="download">${t('explorer.download') || 'Download'}</button>` : ''}
      <button data-action="delete" class="danger">${t('common.delete') || 'Delete'}</button>
    `;
    menu.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('button')?.dataset.action;
      if (!action) return;
      this.closeContextMenu();
      if (action === 'rename') {
        if (isFolder) {
          this.renameFolder(path);
        } else {
          this.renameFile(path);
        }
      } else if (action === 'duplicate') {
        if (isFolder) {
          this.duplicateFolder(path);
        } else {
          this.duplicateFile(path);
        }
      } else if (action === 'download' && !isFolder) {
        this.downloadFile(path);
      } else if (action === 'delete') {
        if (isFolder) {
          this.deleteFolder(path);
        } else {
          this.deleteFile(path);
        }
      }
    });
    document.body.appendChild(menu);
    this.contextMenu = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  }

  private closeContextMenu() {
    this.contextMenu?.remove();
    this.contextMenu = null;
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
      ts: '📘',
      tsx: '⚛️',
      js: '📜',
      jsx: '⚛️',
      mjs: '📜',
      cjs: '📜',
      json: '📋',
      jsonc: '📋',
      lock: '🔒',
      md: '📝',
      mdx: '📝',
      txt: '📄',
      rtf: '📄',
      html: '🌐',
      htm: '🌐',
      xhtml: '🌐',
      css: '🎨',
      scss: '🎨',
      sass: '🎨',
      less: '🎨',
      py: '🐍',
      ipynb: '📓',
      java: '☕',
      kt: '☕',
      scala: '☕',
      groovy: '☕',
      go: '🔵',
      rs: '🦀',
      rb: '💎',
      php: '🐘',
      swift: '🦉',
      r: '📊',
      c: '🔧',
      cpp: '➕',
      h: '🔧',
      hpp: '➕',
      cs: '🔷',
      vb: '🔷',
      fs: '🔷',
      sh: '⚡',
      bash: '⚡',
      zsh: '⚡',
      fish: '⚡',
      ps1: '⚡',
      bat: '⚡',
      cmd: '⚡',
      yml: '⚙️',
      yaml: '⚙️',
      toml: '⚙️',
      ini: '⚙️',
      cfg: '⚙️',
      conf: '⚙️',
      env: '⚙️',
      xml: '📠',
      svg: '🎨',
      csv: '📊',
      tsv: '📊',
      sql: '🗃️',
      prisma: '🗃️',
      log: '📋',
      out: '📋',
      dockerfile: '🐳',
      dockerignore: '🐳',
      gitignore: '🌲',
      gitattributes: '🌲',
      gitmodules: '🌲',
      gitkeep: '🌲',
      license: '⚖️',
      notice: '⚖️',
      readme: '📖',
      changelog: '📖',
      contributing: '📖',
      makefile: '🔨',
      cmake: '🔨',
      gradle: '🔨',
      maven: '🔨',
      pom: '🔨',
      vue: '💚',
      svelte: '🧡',
      astro: '🚀',
      solid: '🔲',
      angular: '🅰️',
      react: '⚛️',
      wasm: '🔳',
      wat: '🔳',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      gif: '🖼️',
      webp: '🖼️',
      bmp: '🖼️',
      ico: '🖼️',
      mp3: '🎵',
      wav: '🎵',
      ogg: '🎵',
      aac: '🎵',
      flac: '🎵',
      m4a: '🎵',
      mp4: '🎬',
      mov: '🎬',
      avi: '🎬',
      mkv: '🎬',
      webm: '🎬',
      ogv: '🎬',
      pdf: '📕',
      doc: '📘',
      docx: '📘',
      xls: '📗',
      xlsx: '📗',
      ppt: '📙',
      pptx: '📙',
      zip: '📦',
      tar: '📦',
      gz: '📦',
      bz2: '📦',
      xz: '📦',
      '7z': '📦',
      rar: '📦',
      jar: '📦',
    };
    // Special file names without extension or dot-prefixed
    const basename = path.split('/').pop()?.toLowerCase() || '';
    if (basename === 'dockerfile') return '🐳';
    if (basename.startsWith('dockerfile.')) return '🐳';
    if (basename === 'license' || basename === 'copying') return '⚖️';
    if (basename.startsWith('readme')) return '📖';
    if (basename.startsWith('changelog')) return '📖';
    if (basename.startsWith('contributing')) return '📖';
    if (basename.startsWith('notice')) return '⚖️';
    if (basename === 'makefile') return '🔨';
    if (basename === 'robots.txt') return '🤖';
    return map[ext] || '📄';
  }

  private async createFolder() {
    const name = window.prompt(t('explorer.newFolderPrompt') || 'New folder name (e.g. my-project):');
    if (!name) return;
    const folderPath = name.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!folderPath) return;
    const path = `${folderPath}/.keep`;

    const existing = this.files.find(
      (f) => f.path === path || f.path === folderPath || f.path.startsWith(`${folderPath}/`)
    );
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
    if (
      !window.confirm(
        (t('explorer.confirmDeleteFolder') || 'Delete folder {path} and all its contents?').replace('{path}', path)
      )
    )
      return;
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

  private async duplicateFile(path: string) {
    const file = this.files.find((f) => f.path === path);
    if (!file) return;
    const parts = path.split('/');
    const name = parts.pop() || path;
    const ext = name.includes('.') ? name.split('.').pop()! : '';
    const base = ext ? name.slice(0, -(ext.length + 1)) : name;
    const parent = parts.join('/');
    const generateName = (n: number): string => {
      const candidate = `${base} copy${n === 1 ? '' : ` ${n}`}${ext ? `.${ext}` : ''}`;
      return parent ? `${parent}/${candidate}` : candidate;
    };
    let n = 1;
    while (this.files.some((f) => f.path === generateName(n))) n++;
    const newPath = generateName(n);
    await this.onBridgeRequest?.({ type: 'writeFile', path: newPath, content: file.content });
    await this.refresh();
    this.activePath = newPath;
    this.onOpenFile?.(newPath);
  }

  private async duplicateFolder(path: string) {
    const children = this.files.filter((f) => f.path === path || f.path.startsWith(`${path}/`));
    if (children.length === 0) return;
    const parent = path.split('/').slice(0, -1).join('/');
    const oldName = path.split('/').pop() || path;
    const base = oldName;
    const generateName = (n: number): string => {
      const candidate = `${base} copy${n === 1 ? '' : ` ${n}`}`;
      return parent ? `${parent}/${candidate}` : candidate;
    };
    let n = 1;
    while (this.files.some((f) => f.path === generateName(n) || f.path.startsWith(`${generateName(n)}/`))) n++;
    const newPath = generateName(n);
    for (const file of children) {
      const newFilePath = file.path.replace(path, newPath);
      await this.onBridgeRequest?.({ type: 'writeFile', path: newFilePath, content: file.content });
    }
    this.expandedFolders.add(newPath);
    await this.refresh();
  }

  private async downloadFile(path: string) {
    const res = await this.onBridgeRequest?.({ type: 'readFile', path });
    if (!res?.ok) return;
    const blob = new Blob([String(res.data ?? '')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() || path;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const text = await file.text();
      const name = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!name) continue;
      let path = name;
      let n = 1;
      while (this.files.some((f) => f.path === path)) {
        const ext = name.includes('.') ? name.split('.').pop()! : '';
        const base = ext ? name.slice(0, -(ext.length + 1)) : name;
        const candidate = `${base}_${n}${ext ? `.${ext}` : ''}`;
        path = candidate;
        n++;
      }
      await this.onBridgeRequest?.({ type: 'writeFile', path, content: text });
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
