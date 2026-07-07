// ============================================================
// vibeAgentGo — ChatApp
// Wraps ChatPanel and adds an integrated session drawer.
// ============================================================

import { ChatPanel } from '../components/ChatPanel.js';
import { SessionPanel } from '../components/SessionPanel.js';
import type { ChatAttachment, App } from '../types/index.js';

export class ChatApp implements App {
  id = 'chat';
  title = 'Chat';
  icon = '💬';
  element: HTMLElement;
  private panel: ChatPanel;
  private sessionPanel: SessionPanel;

  onSubmit: ((text: string, attachments: ChatAttachment[]) => void) | null = null;
  onResumeSession: ((sessionId: string) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'chat-app';

    this.panel = new ChatPanel();
    this.sessionPanel = new SessionPanel();
    this.sessionPanel.onResume = (sessionId) => {
      this.toggleSessions(false);
      this.onResumeSession?.(sessionId);
    };

    this.buildLayout();
  }

  private buildLayout() {
    this.element.innerHTML = '';

    const sidebar = document.createElement('aside');
    sidebar.className = 'chat-session-drawer';
    sidebar.appendChild(this.sessionPanel.element);

    const main = document.createElement('div');
    main.className = 'chat-main';
    main.appendChild(this.panel.element);

    this.element.appendChild(sidebar);
    this.element.appendChild(main);

    this.panel.onToggleSessions = () => this.toggleSessions();
  }

  private toggleSessions(force?: boolean) {
    const drawer = this.element.querySelector('.chat-session-drawer') as HTMLElement;
    if (!drawer) return;
    const next = force !== undefined ? force : !drawer.classList.contains('open');
    drawer.classList.toggle('open', next);
    if (next) {
      this.sessionPanel.open();
    }
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.element);
    this.sessionPanel.open();
    // On desktop, keep the session drawer visible by default; on mobile it starts hidden.
    if (window.innerWidth > 640) {
      this.toggleSessions(true);
    }
  }

  onFocus() {
    this.sessionPanel.open();
  }

  setOnSubmit(handler: (text: string, attachments: ChatAttachment[]) => void) {
    this.panel.onSubmit = handler;
  }

  setOnResumeSession(handler: (sessionId: string) => void) {
    this.onResumeSession = handler;
  }

  appendUser(text: string, attachments?: ChatAttachment[]) {
    this.panel.appendUser(text, attachments);
  }

  appendAssistant(text: string) {
    this.panel.appendAssistant(text);
  }

  appendStreamDelta(delta: string) {
    this.panel.appendStreamDelta(delta);
  }

  finalizeStream() {
    this.panel.finalizeStream();
  }

  appendToolCall(name: string, args: Record<string, unknown>) {
    this.panel.appendToolCall(name, args);
  }

  appendToolResult(name: string, result: string) {
    this.panel.appendToolResult(name, result);
  }

  appendToolMessage(id: string, content: string) {
    this.panel.appendToolMessage(id, content);
  }

  appendError(message: string) {
    this.panel.appendError(message);
  }

  setStatus(status: 'idle' | 'thinking') {
    this.panel.setStatus(status);
  }

  startStream() {
    this.panel.startStream();
  }

  setTurn(turn: number, total: number) {
    this.panel.setTurn(turn, total);
  }

  clear() {
    this.panel.clear();
  }

  isStreaming(): boolean {
    return this.panel.isStreaming();
  }
}
