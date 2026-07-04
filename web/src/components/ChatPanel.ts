// ============================================================
// vibeAgentGo — ChatPanel Component (streaming-aware + markdown)
// ============================================================

import { renderMarkdown } from '../utils/markdown.js';

export class ChatPanel {
  element: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private streamEl: HTMLElement | null = null;
  onSubmit: ((text: string) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'chat-panel';

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'messages';

    const inputArea = document.createElement('div');
    inputArea.className = 'input-area';

    this.inputEl = document.createElement('textarea');
    this.inputEl.placeholder = 'Nachricht an vibeAgentGo...';
    this.inputEl.rows = 1;
    this.inputEl.addEventListener('input', () => this.autoResize());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'send-btn';
    this.sendBtn.textContent = '➤';
    this.sendBtn.addEventListener('click', () => this.send());

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status-bar';
    this.statusEl.textContent = 'Bereit';

    inputArea.appendChild(this.inputEl);
    inputArea.appendChild(this.sendBtn);

    this.element.appendChild(this.messagesEl);
    this.element.appendChild(this.statusEl);
    this.element.appendChild(inputArea);

    this.setStatus('idle');
  }

  private autoResize() {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
  }

  private send() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    if (this.onSubmit) this.onSubmit(text);
  }

  clear() {
    this.messagesEl.innerHTML = '';
    this.streamEl = null;
  }

  appendUser(text: string) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendAssistant(text: string) {
    if (text === undefined || text === null) return;
    // Non-streaming path: append to last assistant msg or create new
    const last = this.messagesEl.lastElementChild as HTMLElement;
    if (last && last.classList.contains('msg-assistant') && !last.dataset.streaming) {
      const contentEl = last.querySelector('.msg-content') as HTMLElement;
      if (contentEl) {
        const raw = (contentEl.dataset.raw || '') + text;
        contentEl.dataset.raw = raw;
        contentEl.innerHTML = renderMarkdown(raw);
      }
    } else {
      const el = document.createElement('div');
      el.className = 'msg msg-assistant';
      el.innerHTML = `<div class="msg-content" data-raw="${this.escape(text)}">${renderMarkdown(text)}</div>`;
      this.messagesEl.appendChild(el);
    }
    this.streamEl = null;
    this.scrollToBottom();
  }

  startStream() {
    // Create a new assistant message element for streaming
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    el.dataset.streaming = 'true';
    el.dataset.raw = '';
    el.innerHTML = '<div class="msg-content"></div>';
    this.messagesEl.appendChild(el);
    this.streamEl = el;
    this.scrollToBottom();
  }

  appendStreamDelta(delta: string) {
    if (!delta || delta === 'undefined') return;
    if (!this.streamEl) {
      this.startStream();
    }
    const stream = this.streamEl!;
    const contentEl = stream.querySelector('.msg-content') as HTMLElement;
    const current = stream.dataset.raw || '';
    const next = current + delta;
    stream.dataset.raw = next;
    contentEl.innerHTML = renderMarkdown(next);
    this.scrollToBottom();
  }

  finalizeStream() {
    if (this.streamEl) {
      delete this.streamEl.dataset.streaming;
      this.streamEl = null;
    }
  }

  appendToolCall(name: string, args: any) {
    // Finalize any streaming content before tool call
    this.finalizeStream();

    const argStr = Object.keys(args).length > 0 ? JSON.stringify(args).slice(0, 120) : '';
    const el = document.createElement('details');
    el.className = 'msg msg-tool';
    el.innerHTML = `
      <summary>
        <span class="tool-icon">🔧</span>
        <span class="tool-name">${name}</span>
        <span class="tool-args">${argStr}</span>
      </summary>
    `;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendToolResult(name: string, result: string) {
    const el = this.messagesEl.lastElementChild as HTMLElement;
    if (el && el.tagName === 'DETAILS' && el.classList.contains('msg-tool')) {
      const body = document.createElement('div');
      body.className = 'tool-result-body';
      const preview = result.length > 400 ? result.slice(0, 400) + '...' : result;
      body.textContent = preview;
      el.appendChild(body);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'msg msg-tool-result';
      const preview = result.length > 150 ? result.slice(0, 150) + '...' : result;
      fallback.innerHTML = `<span class="tool-result-icon">↳</span> <span class="tool-result-text">${this.escape(preview)}</span>`;
      this.messagesEl.appendChild(fallback);
    }
    this.scrollToBottom();
  }

  appendError(message: string) {
    this.finalizeStream();
    const el = document.createElement('div');
    el.className = 'msg msg-error';
    el.textContent = `❌ ${message}`;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  setStatus(status: string) {
    const labels: Record<string, string> = {
      idle: 'Bereit',
      thinking: 'Denke nach...',
      connected: 'Verbunden',
      disconnected: 'Getrennt — verbinde...',
    };
    this.statusEl.textContent = labels[status] || status;
    this.statusEl.className = `status-bar status-${status}`;
  }

  setTurn(turn: number, total: number) {
    this.statusEl.textContent = `Runde ${turn}/${total}`;
  }

  setConnectionStatus(connected: boolean) {
    this.sendBtn.disabled = !connected;
    this.sendBtn.style.opacity = connected ? '1' : '0.4';
  }

  private scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private escape(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}