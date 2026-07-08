// ============================================================
// vibeAgentGo — TextEditorApp
// Simple text editor for workspace files (IndexedDB via bridge).
// ============================================================

import type { App, BridgeRequest, BridgeResponse } from '../types/index.js';
import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';

export class TextEditorApp implements App {
  id = 'editor';
  title = 'Editor';
  icon = '📝';
  element: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private pathEl!: HTMLElement;
  private onBridgeRequest: ((req: BridgeRequest) => Promise<BridgeResponse>) | null = null;
  private onOpenFile: ((path: string) => void) | null = null;
  private currentPath: string | null = null;
  private isDirty = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'editor-app';
    this.build();
  }

  private build() {
    this.element.innerHTML = `
      <div class="editor-header">
        <span class="editor-path">${t('editor.untitled') || 'Untitled'}</span>
        <div class="editor-actions">
          <button class="editor-new" title="${t('editor.newFile') || 'New File'} (Ctrl+N)">📄</button>
          <button class="editor-save" title="${t('editor.save') || 'Save'} (Ctrl+S)">💾</button>
          <button class="editor-save-as" title="${t('editor.saveAs') || 'Save As'} (Ctrl+Shift+S)">💾➕</button>
        </div>
      </div>
      <textarea class="editor-textarea" spellcheck="false"></textarea>
      <div class="editor-status"></div>
    `;

    this.pathEl = this.element.querySelector('.editor-path') as HTMLElement;
    this.textarea = this.element.querySelector('.editor-textarea') as HTMLTextAreaElement;
    this.statusEl = this.element.querySelector('.editor-status') as HTMLElement;

    this.textarea.addEventListener('input', () => this.markDirty());
    this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

    this.element.querySelector('.editor-new')?.addEventListener('click', () => this.newFile());
    this.element.querySelector('.editor-save')?.addEventListener('click', () => this.save());
    this.element.querySelector('.editor-save-as')?.addEventListener('click', () => this.saveAs());
  }

  private handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        this.saveAs();
      } else {
        this.save();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      this.newFile();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      const value = this.textarea.value;
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const before = value.slice(lineStart, start);
        if (before.startsWith('  ')) {
          this.textarea.setRangeText(before.slice(2), lineStart, start, 'end');
        } else if (before.startsWith('\t')) {
          this.textarea.setRangeText(before.slice(1), lineStart, start, 'end');
        }
      } else {
        this.textarea.setRangeText('  ', start, end, 'end');
      }
      this.markDirty();
    }
  }

  private async ensurePath(): Promise<string | null> {
    if (this.currentPath) return this.currentPath;
    return this.promptForPath(t('editor.saveAsPrompt') || 'File name?');
  }

  private async promptForPath(message: string): Promise<string | null> {
    const input = window.prompt(message, this.currentPath || 'untitled.txt');
    if (!input) return null;
    const path = input.trim().replace(/^\/+|\/+$/g, '');
    if (!path) return null;
    return path;
  }

  private async newFile() {
    if (this.isDirty && !window.confirm(t('editor.unsavedChanges') || 'Discard unsaved changes?')) {
      return;
    }
    const path = await this.promptForPath(t('editor.newFilePrompt') || 'Name for new file?');
    if (!path) return;
    const res = await this.onBridgeRequest?.({ type: 'readFile', path });
    if (res?.ok) {
      const overwrite = window.confirm(t('editor.fileExists') || 'File exists. Overwrite?');
      if (!overwrite) return;
    }
    this.currentPath = path;
    this.textarea.value = '';
    this.setDirty(false);
    this.setPathDisplay();
    this.setStatus(t('editor.newFileCreated') || 'New file created');
    await this.save();
  }

  private async saveAs() {
    const path = await this.promptForPath(t('editor.saveAsPrompt') || 'Save as file name?');
    if (!path) return;
    this.currentPath = path;
    this.setPathDisplay();
    await this.save();
  }

  private setPathDisplay() {
    this.pathEl.textContent = this.currentPath ? (this.isDirty ? `● ${this.currentPath}` : this.currentPath) : (t('editor.untitled') || 'Untitled');
  }

  setBridgeHandler(handler: (req: BridgeRequest) => Promise<BridgeResponse>) {
    this.onBridgeRequest = handler;
  }

  setOnOpenFile(handler: (path: string) => void) {
    this.onOpenFile = handler;
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.element);
  }

  openFile(path: string) {
    this.currentPath = path;
    this.pathEl.textContent = path;
    this.onOpenFile?.(path);
    this.load();
  }

  private async load() {
    if (!this.currentPath) return;
    const res = await this.onBridgeRequest?.({ type: 'readFile', path: this.currentPath });
    this.textarea.value = (res?.ok ? String(res.data ?? '') : '') || '';
    this.setDirty(false);
    this.setStatus(t('editor.loaded') || 'Loaded');
  }

  private async save() {
    const path = await this.ensurePath();
    if (!path) return;
    this.currentPath = path;
    this.setPathDisplay();
    const content = this.textarea.value;
    const res = await this.onBridgeRequest?.({ type: 'writeFile', path: this.currentPath, content });
    if (res?.ok) {
      this.setDirty(false);
      this.setStatus(t('editor.saved') || 'Saved');
    } else {
      this.setStatus(t('editor.saveError') || 'Save failed', true);
    }
  }

  private markDirty() {
    this.setDirty(true);
  }

  private setDirty(dirty: boolean) {
    this.isDirty = dirty;
    this.element.classList.toggle('dirty', dirty);
    this.setPathDisplay();
  }

  private setStatus(text: string, error = false) {
    this.statusEl.textContent = text;
    this.statusEl.className = `editor-status ${error ? 'error' : ''}`;
  }

  onClose(): boolean {
    if (this.isDirty) {
      return window.confirm(t('editor.unsavedChanges') || 'Unsaved changes. Discard?');
    }
    return true;
  }
}
