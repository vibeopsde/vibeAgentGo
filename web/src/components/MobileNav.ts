// ============================================================
// vibeAgentGo — Mobile bottom tab navigation
// Switches between Chat and Render on small screens.
// ============================================================

export type MobileTab = 'chat' | 'render';

export class MobileNav {
  element: HTMLElement;
  private onTab: (tab: MobileTab) => void;
  private onNew: () => void;
  private activeTab: MobileTab = 'chat';

  constructor(onTab: (tab: MobileTab) => void, onNew: () => void) {
    this.onTab = onTab;
    this.onNew = onNew;
    this.element = document.createElement('nav');
    this.element.className = 'mobile-nav';
    this.element.setAttribute('role', 'tablist');
    this.element.setAttribute('aria-label', 'Mobile tabs');
    this.render();

    this.element.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.mobile-nav-btn') as HTMLButtonElement | null;
      if (!btn) return;
      const action = btn.dataset.action as MobileTab | 'new' | undefined;
      if (action === 'new') {
        this.onNew();
        return;
      }
      if (action === 'chat' || action === 'render') {
        this.setActive(action);
        this.onTab(action);
      }
    });
  }

  private render() {
    this.element.innerHTML = `
      <button class="mobile-nav-btn ${this.activeTab === 'chat' ? 'active' : ''}" data-action="chat" aria-label="Chat" role="tab" aria-selected="${this.activeTab === 'chat'}">
        <span class="mobile-nav-icon">💬</span>
        <span class="mobile-nav-label">Chat</span>
      </button>
      <button class="mobile-nav-btn mobile-nav-primary" data-action="new" aria-label="New Chat">
        <span class="mobile-nav-icon">✨</span>
      </button>
      <button class="mobile-nav-btn ${this.activeTab === 'render' ? 'active' : ''}" data-action="render" aria-label="Render" role="tab" aria-selected="${this.activeTab === 'render'}">
        <span class="mobile-nav-icon">🎨</span>
        <span class="mobile-nav-label">Render</span>
      </button>
    `;
  }

  setActive(tab: MobileTab) {
    this.activeTab = tab;
    this.render();
  }
}
