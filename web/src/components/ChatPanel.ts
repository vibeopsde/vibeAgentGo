// ============================================================
// HAG — ChatPanel Component
// ============================================================

export class ChatPanel {
  element: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  onSubmit: ((text: string) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'chat-panel';

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'messages';

    const inputArea = document.createElement('div');
    inputArea.className = 'input-area';

    this.inputEl = document.createElement('textarea');
    this.inputEl.placeholder = 'Nachricht an HAG...';
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

  appendUser(text: string) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendAssistant(text: string) {
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';

    // If the last message is also assistant, append to it
    const last = this.messagesEl.lastElementChild as HTMLElement;
    if (last && last.classList.contains('msg-assistant')) {
      last.textContent += text;
    } else {
      el.textContent = text;
      this.messagesEl.appendChild(el);
    }
    this.scrollToBottom();
  }

  appendToolCall(name: string, args: any) {
    const el = document.createElement('div');
    el.className = 'msg msg-tool';
    const argStr = Object.keys(args).length > 0 ? JSON.stringify(args).slice(0, 120) : '';
    el.innerHTML = `<span class="tool-icon">🔧</span> <span class="tool-name">${name}</span> <span class="tool-args">${argStr}</span>`;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendToolResult(name: string, result: string) {
    const el = document.createElement('div');
    el.className = 'msg msg-tool-result';
    const preview = result.length > 150 ? result.slice(0, 150) + '...' : result;
    el.innerHTML = `<span class="tool-result-icon">↳</span> <span class="tool-result-text">${this.escape(preview)}</span>`;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  appendError(message: string) {
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
    };
    this.statusEl.textContent = labels[status] || status;
    this.statusEl.className = `status-bar status-${status}`;
  }

  setTurn(turn: number, total: number) {
    this.statusEl.textContent = `Runde ${turn}/${total}`;
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