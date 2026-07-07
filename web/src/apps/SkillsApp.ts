// ============================================================
// vibeAgentGo — SkillsApp
// Wraps SkillsPanel into the App interface for the window manager.
// ============================================================

import { SkillsPanel } from '../components/SkillsPanel.js';
import type { App } from '../types/index.js';

export class SkillsApp implements App {
  id = 'skills';
  title = 'Skills';
  icon = '🛠️';
  element: HTMLElement;
  private panel: SkillsPanel;

  constructor() {
    this.panel = new SkillsPanel();
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
