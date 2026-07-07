// ============================================================
// vibeAgentGo — MemoryApp
// Wraps MemoryPanel into the App interface for the window manager.
// ============================================================

import { MemoryPanel } from '../components/MemoryPanel.js';
import type { App } from '../types/index.js';

export class MemoryApp implements App {
  id = 'memory';
  title = 'Memory';
  icon = '🧠';
  element: HTMLElement;
  private panel: MemoryPanel;

  constructor() {
    this.panel = new MemoryPanel();
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
