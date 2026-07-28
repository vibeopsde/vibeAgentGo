// ============================================================
// vibeAgentGo — TextEditorApp tests
// Covers the review fixes: configurable tab size, undo for
// programmatic edits, find-overlay focus behaviour, dirty tracking
// and the save/open guards.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextEditorApp } from '../src/apps/TextEditorApp.js';
import type { BridgeRequest, BridgeResponse } from '../src/types/index.js';

function keydown(target: HTMLElement, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function createEditor(bridge?: (req: BridgeRequest) => Promise<BridgeResponse>) {
  const app = new TextEditorApp();
  document.body.appendChild(app.element);
  const handler =
    bridge ??
    (async (req: BridgeRequest): Promise<BridgeResponse> => {
      if (req.type === 'readFile') return { ok: false, error: 'not found' } as BridgeResponse;
      return { ok: true, data: null } as BridgeResponse;
    });
  app.setBridgeHandler(handler);
  const textarea = app.element.querySelector('.editor-textarea') as HTMLTextAreaElement;
  return { app, textarea };
}

function setConfig(config: Record<string, unknown>) {
  localStorage.setItem('vibeAgentGo-config', JSON.stringify(config));
}

describe('TextEditorApp', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.removeItem('vibeAgentGo-config');
    vi.restoreAllMocks();
  });

  it('inserts the configured tab size on Tab', () => {
    setConfig({ editorTabSize: 4 });
    const { textarea } = createEditor();
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    keydown(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('    ');
  });

  it('removes the configured tab size on Shift+Tab', () => {
    setConfig({ editorTabSize: 4 });
    const { textarea } = createEditor();
    textarea.value = '    hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    textarea.setSelectionRange(4, 4);
    keydown(textarea, { key: 'Tab', shiftKey: true });
    expect(textarea.value).toBe('hello');
  });

  it('falls back to removing fewer leading spaces on Shift+Tab', () => {
    setConfig({ editorTabSize: 4 });
    const { textarea } = createEditor();
    textarea.value = '  hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    textarea.setSelectionRange(2, 2);
    keydown(textarea, { key: 'Tab', shiftKey: true });
    expect(textarea.value).toBe('hello');
  });

  it('undo reverts a programmatic Tab edit', () => {
    const { textarea } = createEditor();
    textarea.value = 'abc';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    textarea.setSelectionRange(3, 3);
    keydown(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('abc  ');
    keydown(textarea, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe('abc');
  });

  it('Ctrl+Shift+Z redoes the undone edit', () => {
    const { textarea } = createEditor();
    textarea.value = 'abc';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    textarea.setSelectionRange(3, 3);
    keydown(textarea, { key: 'Tab' });
    keydown(textarea, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe('abc');
    keydown(textarea, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(textarea.value).toBe('abc  ');
  });

  it('replace all is undoable as a single step', () => {
    const { app, textarea } = createEditor();
    textarea.value = 'foo bar foo';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();

    keydown(textarea, { key: 'h', ctrlKey: true });
    const overlay = app.element.querySelector('.editor-find-overlay') as HTMLElement;
    const findInput = overlay.querySelector('.find-input') as HTMLInputElement;
    const replaceInput = overlay.querySelector('.replace-input') as HTMLInputElement;
    findInput.value = 'foo';
    findInput.dispatchEvent(new Event('input'));
    replaceInput.value = 'baz';
    (overlay.querySelector('.replace-all') as HTMLButtonElement).click();
    expect(textarea.value).toBe('baz bar baz');

    textarea.focus();
    keydown(textarea, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe('foo bar foo');
  });

  it('opening find keeps focus in the find input, even with a selection', () => {
    const { app, textarea } = createEditor();
    textarea.value = 'hello world hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    textarea.setSelectionRange(0, 5);

    keydown(textarea, { key: 'f', ctrlKey: true });
    const overlay = app.element.querySelector('.editor-find-overlay') as HTMLElement;
    const findInput = overlay.querySelector('.find-input') as HTMLInputElement;
    expect(overlay.style.display).toBe('flex');
    expect(document.activeElement).toBe(findInput);
    // Pre-filled query runs immediately and shows the match count.
    expect(findInput.value).toBe('hello');
    const count = overlay.querySelector('.find-match-count') as HTMLElement;
    expect(count.textContent).toBe('1/2');

    // Re-opening with a stale match list must not steal focus either.
    keydown(findInput, { key: 'Escape' });
    textarea.focus();
    keydown(textarea, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(findInput);
  });

  it('dirty flag resets when undoing back to the saved state', async () => {
    const bridge = async (req: BridgeRequest): Promise<BridgeResponse> => {
      if (req.type === 'readFile') return { ok: true, data: 'saved text' } as BridgeResponse;
      return { ok: true, data: null } as BridgeResponse;
    };
    const { app, textarea } = createEditor(bridge);
    app.openFile('a.txt');
    await vi.waitFor(() => expect(app.isDirty()).toBe(false));
    expect(textarea.value).toBe('saved text');

    textarea.value = 'saved text changed';
    textarea.dispatchEvent(new Event('input'));
    expect(app.isDirty()).toBe(true);

    textarea.focus();
    keydown(textarea, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe('saved text');
    expect(app.isDirty()).toBe(false);
  });

  it('save on an untitled editor prompts for a path and writes via bridge', async () => {
    const written: BridgeRequest[] = [];
    const bridge = async (req: BridgeRequest): Promise<BridgeResponse> => {
      written.push(req);
      return { ok: true, data: null } as BridgeResponse;
    };
    const { app, textarea } = createEditor(bridge);
    vi.spyOn(window, 'prompt').mockReturnValue('notes/todo.txt');
    textarea.value = 'content';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    keydown(textarea, { key: 's', ctrlKey: true });
    await vi.waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toMatchObject({ type: 'writeFile', path: 'notes/todo.txt', content: 'content' });
    expect(app.isDirty()).toBe(false);
  });

  it('save shows an error status when the bridge throws', async () => {
    const bridge = async (): Promise<BridgeResponse> => {
      throw new Error('IDB exploded');
    };
    const { app, textarea } = createEditor(bridge);
    vi.spyOn(window, 'prompt').mockReturnValue('a.txt');
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    keydown(textarea, { key: 's', ctrlKey: true });
    await vi.waitFor(() => {
      const status = app.element.querySelector('.editor-status') as HTMLElement;
      expect(status.className).toContain('error');
    });
  });

  it('openFile refuses to discard unsaved changes when confirm is declined', async () => {
    const bridge = async (req: BridgeRequest): Promise<BridgeResponse> => {
      if (req.type === 'readFile') return { ok: true, data: 'file a' } as BridgeResponse;
      return { ok: true, data: null } as BridgeResponse;
    };
    const { app, textarea } = createEditor(bridge);
    app.openFile('a.txt');
    await vi.waitFor(() => expect(textarea.value).toBe('file a'));

    textarea.value = 'file a edited';
    textarea.dispatchEvent(new Event('input'));
    expect(app.isDirty()).toBe(true);

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    app.openFile('b.txt');
    // Still on the old file with the edited content.
    expect(textarea.value).toBe('file a edited');
    expect(app.isDirty()).toBe(true);
  });

  it('gutter renders one entry per line and caches rebuilds', () => {
    const { app, textarea } = createEditor();
    const gutter = app.element.querySelector('.editor-gutter') as HTMLElement;
    expect(gutter.children.length).toBe(1);
    textarea.value = 'a\nb\nc';
    textarea.dispatchEvent(new Event('input'));
    expect(gutter.children.length).toBe(3);
    // Typing within the same line count must not rebuild the gutter.
    const firstNode = gutter.firstElementChild;
    textarea.value = 'a\nb\ncd';
    textarea.dispatchEvent(new Event('input'));
    expect(gutter.children.length).toBe(3);
    expect(gutter.firstElementChild).toBe(firstNode);
  });
});
