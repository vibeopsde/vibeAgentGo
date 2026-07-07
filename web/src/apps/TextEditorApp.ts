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
        <button class="editor-save" title="${t('editor.save') || 'Save'} (Ctrl+S)">💾</button>
      </div>
      <textarea class="editor-textarea" spellcheck="false"></textarea>
      <div class="editor-status"></div>
    `;

    this.pathEl = this.element.querySelector('.editor-path') as HTMLElement;
    this.textarea = this.element.querySelector('.editor-textarea') as HTMLTextAreaElement;
    this.statusEl = this.element.querySelector('.editor-status') as HTMLElement;

    this.textarea.addEventListener('input', () => this.markDirty());
    this.textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.save();
      }
    });

    this.element.querySelector('.editor-save')?.addEventListener('click', () => this.save());
  }

  setBridgeHandler(handler: (req: BridgeRequest) => Promise<BridgeResponse>) {
    this.onBridgeRequest = handler;
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.element);
  }

  openFile(path: string) {
    this.currentPath = path;
    this.pathEl.textContent = path;
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
    if (!this.currentPath) return;
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
    this.pathEl.textContent = this.currentPath ? (dirty ? `● ${this.currentPath}` : this.currentPath) : (t('editor.untitled') || 'Untitled');
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
