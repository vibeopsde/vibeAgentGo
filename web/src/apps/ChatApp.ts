// ============================================================
// vibeAgentGo — ChatApp
// Wraps ChatPanel into the App interface and connects to the agent.
// ============================================================

import { ChatPanel } from '../components/ChatPanel.js';
import type { ChatAttachment, App } from '../types/index.js';

export class ChatApp implements App {
  id = 'chat';
  title = 'Chat';
  icon = '💬';
  element: HTMLElement;
  private panel: ChatPanel;
  onSubmit: ((text: string, attachments: ChatAttachment[]) => void) | null = null;

  constructor() {
    this.panel = new ChatPanel();
    this.element = this.panel.element;
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.panel.element);
  }

  setOnSubmit(handler: (text: string, attachments: ChatAttachment[]) => void) {
    this.panel.onSubmit = handler;
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
