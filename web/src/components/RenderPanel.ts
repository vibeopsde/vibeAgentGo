// ============================================================
// vibeAgentGo — RenderPanel Component (iframe + tabs)
// ============================================================

interface ViewTab {
  title: string;
  html: string;
}

export class RenderPanel {
  element: HTMLElement;
  private tabsEl: HTMLElement;
  private viewEl: HTMLElement;
  private iframe: HTMLIFrameElement;
  private emptyEl: HTMLElement;
  private views: ViewTab[] = [];
  private activeTitle: string | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'render-panel';

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'view-tabs';

    this.viewEl = document.createElement('div');
    this.viewEl.className = 'view-container';

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'view-iframe';
    this.iframe.sandbox = 'allow-scripts allow-modals allow-forms';
    this.iframe.style.display = 'none';

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'view-empty';
    this.emptyEl.innerHTML = `
      <div class="empty-icon">📊</div>
      <p>Render View</p>
      <p class="empty-hint">Der Agent kann hier Mini-Apps, Visualisierungen und Dashboards anzeigen</p>
    `;

    this.viewEl.appendChild(this.emptyEl);
    this.viewEl.appendChild(this.iframe);

    this.element.appendChild(this.tabsEl);
    this.element.appendChild(this.viewEl);
  }

  render(views: ViewTab[], activeTitle: string | null) {
    this.views = views;
    this.activeTitle = activeTitle;
    this.renderTabs();
    this.renderActiveView();
  }

  private renderTabs() {
    this.tabsEl.innerHTML = '';

    if (this.views.length === 0) {
      this.tabsEl.style.display = 'none';
      return;
    }

    this.tabsEl.style.display = 'flex';

    for (const view of this.views) {
      const tab = document.createElement('button');
      tab.className = 'view-tab' + (view.title === this.activeTitle ? ' active' : '');
      tab.textContent = view.title;
      tab.addEventListener('click', () => {
        this.activeTitle = view.title;
        this.renderTabs();
        this.renderActiveView();
      });

      // Close button
      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.views = this.views.filter(v => v.title !== view.title);
        if (this.activeTitle === view.title) {
          this.activeTitle = this.views[0]?.title || null;
        }
        this.render(this.views, this.activeTitle);
      });
      tab.appendChild(closeBtn);

      this.tabsEl.appendChild(tab);
    }
  }

  private renderActiveView() {
    if (!this.activeTitle) {
      this.iframe.style.display = 'none';
      this.emptyEl.style.display = 'flex';
      return;
    }

    const view = this.views.find(v => v.title === this.activeTitle);
    if (!view) {
      this.iframe.style.display = 'none';
      this.emptyEl.style.display = 'flex';
      return;
    }

    this.emptyEl.style.display = 'none';
    this.iframe.style.display = 'block';

    // Render HTML via srcdoc (sandboxed)
    this.iframe.srcdoc = view.html;
  }
}