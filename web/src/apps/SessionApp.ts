// ============================================================
// vibeAgentGo — SessionApp
// Wraps SessionPanel into the App interface for the window manager.
// ============================================================

import { SessionPanel } from '../components/SessionPanel.js';
import type { App } from '../types/index.js';

export class SessionApp implements App {
  id = 'sessions';
  title = 'Sessions';
  icon = '💬';
  element: HTMLElement;
  private panel: SessionPanel;
  onResume: ((sessionId: string) => void) | null = null;

  constructor() {
    this.panel = new SessionPanel();
    this.panel.onResume = (sessionId) => this.onResume?.(sessionId);
    this.element = this.panel.element;
  }

  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.panel.element);
    this.panel.open();
  }

  onFocus() {
    this.panel.open();
  }
}
