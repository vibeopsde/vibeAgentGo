// ============================================================
// vibeAgentGo — TextEditorApp
// Simple text editor for workspace files (IndexedDB via bridge).
// ============================================================

import type { App, BridgeRequest, BridgeResponse } from '../types/index.js';
import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';
import { loadConfig } from '../core/memory.js';

export class TextEditorApp implements App {
  id = 'editor';
  title = 'Editor';
  icon = '📝';
  element: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private pathEl!: HTMLElement;
  private gutterEl!: HTMLElement;
  private onBridgeRequest: ((req: BridgeRequest) => Promise<BridgeResponse>) | null = null;
  private onOpenFile: ((path: string) => void) | null = null;
  private onSave: ((path: string) => void) | null = null;
  private currentPath: string | null = null;
  private dirty = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastInputTime = 0;
  private readonly UNDO_DEBOUNCE_MS = 300;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'editor-app';
    this.build();
  }
  private build() {
    const tabSize = loadConfig().editorTabSize ?? 2;
    this.element.innerHTML = `
      <div class="editor-header">
        <span class="editor-path">${t('editor.untitled') || 'Untitled'}</span>
        <div class="editor-actions">
          <button class="editor-new" title="${t('editor.newFile') || 'New File'} (Ctrl+N)">📄</button>
          <button class="editor-save" title="${t('editor.save') || 'Save'} (Ctrl+S)">💾</button>
          <button class="editor-save-as" title="${t('editor.saveAs') || 'Save As'} (Ctrl+Shift+S)">💾➕</button>
        </div>
      </div>
      <div class="editor-body">
        <div class="editor-gutter" aria-hidden="true"></div>
        <textarea class="editor-textarea" spellcheck="false" style="tab-size: ${tabSize}"></textarea>
      </div>
      <div class="editor-status"></div>
    `;

    this.pathEl = this.element.querySelector('.editor-path') as HTMLElement;
    this.textarea = this.element.querySelector('.editor-textarea') as HTMLTextAreaElement;
    this.gutterEl = this.element.querySelector('.editor-gutter') as HTMLElement;
    this.statusEl = this.element.querySelector('.editor-status') as HTMLElement;

    this.textarea.addEventListener('input', () => { this.recordInput(); this.markDirty(); this.updateGutter(); });
    this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.textarea.addEventListener('scroll', () => this.syncGutter());

    this.element.querySelector('.editor-new')?.addEventListener('click', () => this.newFile());
    this.element.querySelector('.editor-save')?.addEventListener('click', () => this.save());
    this.element.querySelector('.editor-save-as')?.addEventListener('click', () => this.saveAs());
  }

  private recordInput() {
    const now = Date.now();
    if (this.undoStack.length === 0 || now - this.lastInputTime > this.UNDO_DEBOUNCE_MS) {
      this.undoStack.push(this.textarea.value);
      if (this.undoStack.length > 50) this.undoStack.shift();
    } else {
      this.undoStack[this.undoStack.length - 1] = this.textarea.value;
    }
    this.redoStack = [];
    this.lastInputTime = now;
  }

  private undo() {
    if (this.undoStack.length <= 1) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    const previous = this.undoStack[this.undoStack.length - 1];
    this.textarea.value = previous;
    this.markDirty();
    this.updateGutter();
  }

  private redo() {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.textarea.value = next;
    this.markDirty();
    this.updateGutter();
  }

  private findReplaceOverlay: HTMLElement | null = null;
  private findReplaceMode: 'find' | 'replace' = 'find';

  private openFindReplace(mode: 'find' | 'replace') {
    this.findReplaceMode = mode;
    if (!this.findReplaceOverlay) {
      this.findReplaceOverlay = document.createElement('div');
      this.findReplaceOverlay.className = 'editor-find-overlay';
      this.findReplaceOverlay.innerHTML = `
        <div class="find-row">
          <input type="text" class="find-input" placeholder="Find..." />
          <button class="find-prev" title="Previous">▲</button>
          <button class="find-next" title="Next">▼</button>
          <span class="find-match-count"></span>
          <button class="find-close" title="Close (Esc)">×</button>
        </div>
        <div class="replace-row">
          <input type="text" class="replace-input" placeholder="Replace..." />
          <button class="replace-one">Replace</button>
          <button class="replace-all">Replace All</button>
        </div>
      `;
      this.element.appendChild(this.findReplaceOverlay);
      const findInput = this.findReplaceOverlay.querySelector('.find-input') as HTMLInputElement;
      const replaceInput = this.findReplaceOverlay.querySelector('.replace-input') as HTMLInputElement;
      const nextBtn = this.findReplaceOverlay.querySelector('.find-next') as HTMLButtonElement;
      const prevBtn = this.findReplaceOverlay.querySelector('.find-prev') as HTMLButtonElement;
      const closeBtn = this.findReplaceOverlay.querySelector('.find-close') as HTMLButtonElement;
      const replaceOneBtn = this.findReplaceOverlay.querySelector('.replace-one') as HTMLButtonElement;
      const replaceAllBtn = this.findReplaceOverlay.querySelector('.replace-all') as HTMLButtonElement;
      const countEl = this.findReplaceOverlay.querySelector('.find-match-count') as HTMLElement;

      let currentIndex = 0;
      let matches: number[] = [];

      const findAll = () => {
        const query = findInput.value;
        const text = this.textarea.value;
        matches = [];
        if (query) {
          let i = 0;
          while ((i = text.indexOf(query, i)) !== -1) {
            matches.push(i);
            i += query.length;
          }
        }
        currentIndex = Math.max(0, Math.min(currentIndex, matches.length - 1));
        countEl.textContent = matches.length ? `${currentIndex + 1}/${matches.length}` : '';
        this.highlight(currentIndex, matches, query.length);
        return matches;
      };

      const selectMatch = (idx: number) => {
        if (!matches.length) return;
        currentIndex = (idx + matches.length) % matches.length;
        const pos = matches[currentIndex];
        this.textarea.focus();
        this.textarea.setSelectionRange(pos, pos + findInput.value.length);
        findAll();
      };

      findInput.addEventListener('input', () => { currentIndex = 0; findAll(); });
      nextBtn.addEventListener('click', () => selectMatch(currentIndex + 1));
      prevBtn.addEventListener('click', () => selectMatch(currentIndex - 1));
      closeBtn.addEventListener('click', () => this.closeFindReplace());

      replaceOneBtn.addEventListener('click', () => {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        if (this.textarea.value.slice(start, end) === query) {
          this.textarea.setRangeText(replacement, start, end, 'end');
          this.markDirty();
          this.updateGutter();
        }
        findAll();
        selectMatch(currentIndex + 1);
      });

      replaceAllBtn.addEventListener('click', () => {
        const query = findInput.value;
        const replacement = replaceInput.value;
        if (!query) return;
        const text = this.textarea.value;
        const newText = text.split(query).join(replacement);
        if (newText !== text) {
          this.textarea.value = newText;
          this.markDirty();
          this.updateGutter();
        }
        findAll();
      });

      replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          replaceOneBtn.click();
        }
      });
      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); selectMatch(currentIndex + 1); }
        if (e.key === 'Escape') { e.preventDefault(); this.closeFindReplace(); }
      });
      this.findReplaceOverlay.addEventListener('click', (e) => e.stopPropagation());
    }

    const findInput = this.findReplaceOverlay.querySelector('.find-input') as HTMLInputElement;
    const replaceRow = this.findReplaceOverlay.querySelector('.replace-row') as HTMLElement;
    replaceRow.style.display = mode === 'replace' ? 'flex' : 'none';
    this.findReplaceOverlay.style.display = 'flex';
    const selected = this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
    if (selected) findInput.value = selected;
    findInput.focus();
    findInput.select();
    (this.findReplaceOverlay.querySelector('.find-next') as HTMLButtonElement)?.click();
  }

  private closeFindReplace() {
    if (this.findReplaceOverlay) {
      this.findReplaceOverlay.style.display = 'none';
    }
    this.textarea.focus();
  }

  private highlight(currentIndex: number, matches: number[], queryLength: number) {
    if (!matches.length || !queryLength) return;
    const pos = matches[currentIndex] ?? matches[0];
    this.textarea.setSelectionRange(pos, pos + queryLength);
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.openFindReplace('find');
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      this.openFindReplace('replace');
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    }
    if (e.key === 'Escape' && this.findReplaceOverlay?.style.display === 'flex') {
      e.preventDefault();
      this.closeFindReplace();
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
        const tabSize = loadConfig().editorTabSize ?? 2;
        this.textarea.setRangeText(' '.repeat(tabSize), start, end, 'end');
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
    if (this.dirty && !window.confirm(t('editor.unsavedChanges') || 'Discard unsaved changes?')) {
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
    this.pathEl.textContent = this.currentPath ? (this.dirty ? `● ${this.currentPath}` : this.currentPath) : (t('editor.untitled') || 'Untitled');
  }

  setBridgeHandler(handler: (req: BridgeRequest) => Promise<BridgeResponse>) {
    this.onBridgeRequest = handler;
  }

  setOnOpenFile(handler: (path: string) => void) {
    this.onOpenFile = handler;
  }

  setOnSave(handler: (path: string) => void) {
    this.onSave = handler;
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
    this.undoStack = [this.textarea.value];
    this.redoStack = [];
    this.lastInputTime = 0;
    this.updateGutter();
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
      this.onSave?.(this.currentPath);
    } else {
      this.setStatus(t('editor.saveError') || 'Save failed', true);
    }
  }

  private markDirty() {
    this.setDirty(true);
  }

  private updateGutter() {
    const lines = this.textarea.value.split('\n').length;
    this.gutterEl.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
  }

  private syncGutter() {
    this.gutterEl.scrollTop = this.textarea.scrollTop;
  }

  private setDirty(dirty: boolean) {
    this.dirty = dirty;
    this.element.classList.toggle('dirty', dirty);
    this.setPathDisplay();
  }

  private setStatus(text: string, error = false) {
    this.statusEl.textContent = text;
    this.statusEl.className = `editor-status ${error ? 'error' : ''}`;
  }

  onClose(): boolean {
    if (this.dirty) {
      return window.confirm(t('editor.unsavedChanges') || 'Unsaved changes. Discard?');
    }
    return true;
  }

  isDirty(): boolean {
    return this.dirty;
  }
}
