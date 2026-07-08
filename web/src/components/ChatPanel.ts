// ============================================================
// vibeAgentGo — ChatPanel Component (streaming-aware + markdown)
// ============================================================

import { renderMarkdown } from '../utils/markdown.js';
import { escapeHtml } from '../utils/escape.js';
import { t } from '../i18n/index.js';
import type { ChatAttachment } from '../types/index.js';

export class ChatPanel {
  element: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private streamEl: HTMLElement | null = null;
  private attachments: ChatAttachment[] = [];
  private attachmentsEl: HTMLElement;
  onSubmit: ((text: string, attachments: ChatAttachment[]) => void) | null = null;
  onToggleSessions: (() => void) | null = null;
  onNewChat: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'chat-panel';

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'messages';

    const inputArea = document.createElement('div');
    inputArea.className = 'input-area';

    this.inputEl = document.createElement('textarea');
    this.inputEl.placeholder = t('chat.placeholder');
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

    const sessionsBtn = document.createElement('button');
    sessionsBtn.className = 'sessions-btn';
    sessionsBtn.title = t('chat.sessions') || 'Sessions';
    sessionsBtn.textContent = '💬';
    sessionsBtn.addEventListener('click', () => this.onToggleSessions?.());

    const newChatBtn = document.createElement('button');
    newChatBtn.className = 'new-chat-btn';
    newChatBtn.title = t('header.newChat') || 'New chat';
    newChatBtn.textContent = '✨';
    newChatBtn.addEventListener('click', () => this.onNewChat?.());

    const attachBtn = document.createElement('button');
    attachBtn.className = 'attach-btn';
    attachBtn.title = t('chat.attachFile');
    attachBtn.textContent = '📎';
    attachBtn.addEventListener('click', () => fileInput.click());

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,.pdf,.txt,.md,.json,.js,.ts,.html,.css,.py,.csv,.xml,.yaml,.yml,.log';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', (e) => this.handleFiles(e));

    this.attachmentsEl = document.createElement('div');
    this.attachmentsEl.className = 'chat-attachments';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status-bar';
    this.statusEl.textContent = t('common.idle');

    inputArea.appendChild(newChatBtn);
    inputArea.appendChild(sessionsBtn);
    inputArea.appendChild(attachBtn);
    inputArea.appendChild(this.inputEl);
    inputArea.appendChild(this.sendBtn);
    inputArea.appendChild(fileInput);

    this.element.appendChild(this.messagesEl);
    this.element.appendChild(this.statusEl);
    this.element.appendChild(this.attachmentsEl);
    this.element.appendChild(inputArea);

    this.setStatus('idle');
  }

  private autoResize() {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
  }

  private send() {
    const text = this.inputEl.value.trim();
    if (!text && this.attachments.length === 0) return;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    const attachments = this.attachments;
    this.attachments = [];
    this.renderAttachments();
    if (this.onSubmit) this.onSubmit(text, attachments);
  }

  private handleFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;

    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (!result) return;
        const attachment: ChatAttachment = {
          name: file.name,
          type: isImage ? 'image' : isPdf ? 'pdf' : 'text',
          content: result,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        };
        this.attachments.push(attachment);
        this.renderAttachments();
      };

      if (isImage || isPdf) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    }
  }

  private removeAttachment(index: number) {
    this.attachments.splice(index, 1);
    this.renderAttachments();
  }

  private renderAttachments() {
    this.attachmentsEl.innerHTML = '';
    if (this.attachments.length === 0) {
      this.attachmentsEl.style.display = 'none';
      return;
    }
    this.attachmentsEl.style.display = 'flex';
    for (let i = 0; i < this.attachments.length; i++) {
      const a = this.attachments[i];
      const el = document.createElement('div');
      el.className = 'chat-attachment';
      const icon = a.type === 'image' ? '🖼️' : a.type === 'pdf' ? '📄' : '📃';
      el.innerHTML = `
        <span class="attachment-icon">${icon}</span>
        <span class="attachment-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
        <button class="attachment-remove" title="${t('chat.removeAttachment')}">×</button>
      `;
      el.querySelector('.attachment-remove')?.addEventListener('click', () => this.removeAttachment(i));
      this.attachmentsEl.appendChild(el);
    }
  }

  clear() {
    this.messagesEl.innerHTML = '';
    this.streamEl = null;
  }

  appendUser(text: string, attachments: ChatAttachment[] = []) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    let html = escapeHtml(text);
    if (attachments.length > 0) {
      html += '<div class="msg-attachments">';
      for (const a of attachments) {
        if (a.type === 'image') {
          html += `<img src="${escapeHtml(a.content)}" alt="${escapeHtml(a.name)}" class="msg-attachment-image" />`;
        } else {
          const icon = a.type === 'pdf' ? '📄' : '📃';
          html += `<div class="msg-attachment-file"><span>${icon}</span><span>${escapeHtml(a.name)}</span></div>`;
        }
      }
      html += '</div>';
    }
    el.innerHTML = html;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendSystem(text: string) {
    this.finalizeStream();
    const el = document.createElement('div');
    el.className = 'msg msg-system';
    el.innerHTML = `<div class="msg-content" data-raw="${escapeHtml(text)}">${renderMarkdown(text)}</div>`;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendToolMessage(toolCallId: string, content: string) {
    this.finalizeStream();
    const el = document.createElement('details');
    el.className = 'msg msg-tool';
    el.innerHTML = `
      <summary>
        <span class="tool-icon">🔧</span>
        <span class="tool-name">${t('chat.toolCall')}</span>
        <span class="tool-args">${escapeHtml(toolCallId)}</span>
      </summary>
      <div class="tool-result-body">${escapeHtml(content)}</div>
    `;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendAssistant(text: string) {
    if (text === undefined || text === null) return;
    this.finalizeStream();
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    el.innerHTML = `<div class="msg-content" data-raw="${escapeHtml(text)}">${renderMarkdown(text)}</div>`;
    this.messagesEl.appendChild(el);
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
    if (!delta) return;
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

  isStreaming(): boolean {
    return this.streamEl !== null;
  }

  finalizeStream() {
    if (this.streamEl) {
      delete this.streamEl.dataset.streaming;
      this.streamEl = null;
    }
  }

  appendToolCall(name: string, args: Record<string, unknown>) {
    // Finalize any streaming content before tool call
    this.finalizeStream();

    const argStr = Object.keys(args).length > 0 ? escapeHtml(JSON.stringify(args).slice(0, 120)) : '';
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
      fallback.innerHTML = `<span class="tool-result-icon">↳</span> <span class="tool-result-text">${escapeHtml(preview)}</span>`;
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
      idle: t('common.idle'),
      thinking: t('common.thinking'),
      connected: t('common.connected'),
      disconnected: t('common.disconnected'),
    };
    this.statusEl.textContent = labels[status] || status;
    this.statusEl.className = `status-bar status-${status}`;
  }

  setTurn(turn: number, total: number) {
    this.statusEl.textContent = `${t('common.turn')} ${turn}/${total}`;
  }

  setConnectionStatus(connected: boolean) {
    this.sendBtn.disabled = !connected;
    this.sendBtn.style.opacity = connected ? '1' : '0.4';
  }

  private scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
