// ============================================================
// vibeAgentGo — TextEditorApp
// Simple text editor for workspace files (IndexedDB via bridge).
// Syntax highlighting via Prism.js overlay.
// ============================================================

import type { App, BridgeRequest, BridgeResponse } from '../types/index.js';
import { t } from '../i18n/index.js';
import { loadConfig } from '../core/memory.js';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup.js'; // html/xml
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-bash.js';

/** Map file extensions to Prism language identifiers. */
function languageForPath(path: string): string | null {
  const ext = path.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (!ext) return null;
  const map: Record<string, string> = {
    html: 'markup',
    htm: 'markup',
    xml: 'markup',
    svg: 'markup',
    css: 'css',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
    bash: 'bash',
  };
  return map[ext] ?? null;
}

export class TextEditorApp implements App {
  id = 'editor';
  title = 'Editor';
  icon = '📝';
  element: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private pathEl!: HTMLElement;
  private gutterEl!: HTMLElement;
  private highlightEl!: HTMLPreElement;
  private onBridgeRequest: ((req: BridgeRequest) => Promise<BridgeResponse>) | null = null;
  private onOpenFile: ((path: string) => void) | null = null;
  private onSave: ((path: string) => void) | null = null;
  private currentPath: string | null = null;
  private currentLang: string | null = null;
  private dirty = false;
  private savedContent = '';
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastInputTime = 0;
  private readonly UNDO_DEBOUNCE_MS = 300;
  private lastGutterLines = 0;
  private findReplaceOverlay: HTMLElement | null = null;
  private findReplaceMode: 'find' | 'replace' = 'find';
  private runFind: (() => void) | null = null;

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
        <div class="editor-code-wrap">
          <pre class="editor-highlight" aria-hidden="true"><code></code></pre>
          <textarea class="editor-textarea plain" spellcheck="false" style="tab-size: ${tabSize}"></textarea>
        </div>
      </div>
      <div class="editor-status"></div>
    `;

    this.pathEl = this.element.querySelector('.editor-path') as HTMLElement;
    this.textarea = this.element.querySelector('.editor-textarea') as HTMLTextAreaElement;
    this.gutterEl = this.element.querySelector('.editor-gutter') as HTMLElement;
    this.highlightEl = this.element.querySelector('.editor-highlight') as HTMLPreElement;
    this.statusEl = this.element.querySelector('.editor-status') as HTMLElement;
    // Set tab-size on the pre element too
    this.highlightEl.style.tabSize = String(tabSize);

    this.textarea.addEventListener('input', () => {
      this.recordInput();
      this.refreshDirty();
      this.updateGutter();
      this.highlightCode();
    });
    this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.textarea.addEventListener('scroll', () => {
      this.syncGutter();
      this.syncHighlightScroll();
    });

    this.element.querySelector('.editor-new')?.addEventListener('click', () => this.newFile());
    this.element.querySelector('.editor-save')?.addEventListener('click', () => this.save());
    this.element.querySelector('.editor-save-as')?.addEventListener('click', () => this.saveAs());

    this.updateGutter();
  }

  /** Highlight the textarea content using Prism and update the overlay. */
  private highlightCode() {
    const code = this.textarea.value;
    if (this.currentLang && Prism.languages[this.currentLang]) {
      this.textarea.classList.remove('plain');
      const highlighted = Prism.highlight(code, Prism.languages[this.currentLang], this.currentLang);
      this.highlightEl.querySelector('code')!.innerHTML = highlighted;
    } else {
      // No language: show plain text, no highlighting
      this.textarea.classList.add('plain');
      this.highlightEl.querySelector('code')!.textContent = code;
    }
  }

  /** Keep the highlight overlay scrolled in sync with the textarea. */
  private syncHighlightScroll() {
    this.highlightEl.scrollTop = this.textarea.scrollTop;
    this.highlightEl.scrollLeft = this.textarea.scrollLeft;
  }

  /** Update the current language based on the file path and re-highlight. */
  private updateLanguage() {
    this.currentLang = this.currentPath ? languageForPath(this.currentPath) : null;
    this.highlightCode();
  }

  private recordInput(force = false) {
    const now = Date.now();
    if (force || this.undoStack.length === 0 || now - this.lastInputTime > this.UNDO_DEBOUNCE_MS) {
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
    this.refreshDirty();
    this.updateGutter();
    this.highlightCode();
  }

  private redo() {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.textarea.value = next;
    this.refreshDirty();
    this.updateGutter();
    this.highlightCode();
  }

  private openFindReplace(mode: 'find' | 'replace') {
    this.findReplaceMode = mode;
    if (!this.findReplaceOverlay) {
      this.findReplaceOverlay = document.createElement('div');
      this.findReplaceOverlay.className = 'editor-find-overlay';
      this.findReplaceOverlay.innerHTML = `
        <div class="find-row">
          <input type="text" class="find-input" placeholder="${t('editor.findPlaceholder') || 'Find...'}" />
          <button class="find-prev" title="${t('editor.findPrev') || 'Previous'}">▲</button>
          <button class="find-next" title="${t('editor.findNext') || 'Next'}">▼</button>
          <span class="find-match-count"></span>
          <button class="find-close" title="${t('editor.closeFind') || 'Close (Esc)'}">×</button>
        </div>
        <div class="replace-row">
          <input type="text" class="replace-input" placeholder="${t('editor.replacePlaceholder') || 'Replace...'}" />
          <button class="replace-one">${t('editor.replaceOne') || 'Replace'}</button>
          <button class="replace-all">${t('editor.replaceAll') || 'Replace All'}</button>
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
        this.textarea.setSelectionRange(pos, pos + findInput.value.length);
        findAll();
      };

      this.runFind = findAll;

      findInput.addEventListener('input', () => {
        currentIndex = 0;
        findAll();
      });
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
          this.recordInput(true);
          this.refreshDirty();
          this.updateGutter();
          this.highlightCode();
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
          this.recordInput(true);
          this.refreshDirty();
          this.updateGutter();
          this.highlightCode();
        }
        findAll();
      });

      replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          replaceOneBtn.click();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeFindReplace();
        }
      });
      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          selectMatch(currentIndex + 1);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeFindReplace();
        }
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
    // Run the search directly instead of simulating a button click: a click
    // would move focus out of the find input (and a stale match list could
    // even pull focus into the textarea, so typing would edit the document).
    this.runFind?.();
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
    this.scrollToPosition(pos);
  }

  // Scroll the textarea so the given offset is visible without stealing focus
  // from the find input. Line-based estimate using the CSS line-height.
  private scrollToPosition(pos: number) {
    const line = this.textarea.value.slice(0, pos).split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 20;
    const visibleLines = this.textarea.clientHeight / lineHeight;
    const topLine = this.textarea.scrollTop / lineHeight;
    if (line < topLine + 1 || line > topLine + visibleLines - 1) {
      this.textarea.scrollTop = Math.max(0, (line - 3) * lineHeight);
    }
    this.syncGutter();
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
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
      const tabSize = loadConfig().editorTabSize ?? 2;
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const before = value.slice(lineStart, start);
        if (before.startsWith(' '.repeat(tabSize))) {
          this.textarea.setRangeText(before.slice(tabSize), lineStart, start, 'end');
        } else if (before.startsWith('\t')) {
          this.textarea.setRangeText(before.slice(1), lineStart, start, 'end');
        } else {
          // Fewer than tabSize leading spaces: remove what is there.
          const leading = before.match(/^ +/);
          if (leading) {
            this.textarea.setRangeText(before.slice(leading[0].length), lineStart, start, 'end');
          }
        }
      } else {
        this.textarea.setRangeText(' '.repeat(tabSize), start, end, 'end');
      }
      if (this.textarea.value !== value) {
        this.recordInput(true);
        this.refreshDirty();
        this.highlightCode();
      }
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
    this.savedContent = '';
    this.undoStack = [''];
    this.redoStack = [];
    this.lastInputTime = 0;
    this.updateGutter();
    this.updateLanguage();
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
    this.updateLanguage();
    await this.save();
  }

  private setPathDisplay() {
    this.pathEl.textContent = this.currentPath
      ? this.dirty
        ? `● ${this.currentPath}`
        : this.currentPath
      : t('editor.untitled') || 'Untitled';
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
    // Defensive guard: callers should avoid reusing dirty editors, but a
    // direct call must never silently discard unsaved content.
    if (this.dirty && this.currentPath !== path) {
      if (!window.confirm(t('editor.unsavedChanges') || 'Unsaved changes. Discard?')) return;
    }
    this.currentPath = path;
    this.setPathDisplay();
    this.updateLanguage();
    this.onOpenFile?.(path);
    this.load();
  }

  private async load() {
    if (!this.currentPath) return;
    const res = await this.onBridgeRequest?.({ type: 'readFile', path: this.currentPath });
    this.textarea.value = (res?.ok ? String(res.data ?? '') : '') || '';
    this.savedContent = this.textarea.value;
    this.undoStack = [this.textarea.value];
    this.redoStack = [];
    this.lastInputTime = 0;
    this.updateGutter();
    this.highlightCode();
    this.setDirty(false);
    this.setStatus(t('editor.loaded') || 'Loaded');
  }

  private async save() {
    const path = await this.ensurePath();
    if (!path) return;
    this.currentPath = path;
    this.setPathDisplay();
    const content = this.textarea.value;
    try {
      const res = await this.onBridgeRequest?.({ type: 'writeFile', path: this.currentPath, content });
      if (res?.ok) {
        this.savedContent = content;
        this.setDirty(false);
        this.setStatus(t('editor.saved') || 'Saved');
        this.onSave?.(this.currentPath);
      } else {
        this.setStatus(t('editor.saveError') || 'Save failed', true);
      }
    } catch (err) {
      console.warn('Editor save failed', err);
      this.setStatus(t('editor.saveError') || 'Save failed', true);
    }
  }

  private refreshDirty() {
    this.setDirty(this.textarea.value !== this.savedContent);
  }

  private updateGutter() {
    const lines = this.textarea.value.split('\n').length;
    if (lines === this.lastGutterLines) return;
    this.lastGutterLines = lines;
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
