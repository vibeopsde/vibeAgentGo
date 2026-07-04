// ============================================================
// vibeAgentGo — Mobile bottom navigation for quick actions
// ============================================================

export class MobileNav {
  element: HTMLElement;
  private onAction: (action: string) => void;

  constructor(onAction: (action: string) => void) {
    this.onAction = onAction;
    this.element = document.createElement('nav');
    this.element.className = 'mobile-nav';
    this.element.innerHTML = `
      <button class="mobile-nav-btn" data-action="sessions" aria-label="Sessions">
        <span class="mobile-nav-icon">💬</span>
        <span class="mobile-nav-label">Sessions</span>
      </button>
      <button class="mobile-nav-btn mobile-nav-primary" data-action="new" aria-label="New Chat">
        <span class="mobile-nav-icon">✨</span>
      </button>
      <button class="mobile-nav-btn" data-action="menu" aria-label="Menu">
        <span class="mobile-nav-icon">☰</span>
        <span class="mobile-nav-label">Menu</span>
      </button>
    `;

    this.element.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.mobile-nav-btn') as HTMLButtonElement | null;
      if (!btn) return;
      this.onAction(btn.dataset.action!);
    });
  }
}
