// ============================================================
// vibeAgentGo — RenderPanel Component (iframe + tabs)
// ============================================================

import { t } from '../i18n/index.js';

interface ViewTab {
  title: string;
  html: string;
  logs?: LogEntry[];
}

export interface LogEntry {
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  timestamp: string;
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
    this.iframe.sandbox = 'allow-scripts';
    this.iframe.style.display = 'none';

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'view-empty';
    this.emptyEl.innerHTML = `
      <div class="empty-icon">📊</div>
      <p>${t('render.title')}</p>
      <p class="empty-hint">${t('render.emptyHint')}</p>
    `;

    this.viewEl.appendChild(this.emptyEl);
    this.viewEl.appendChild(this.iframe);

    this.element.appendChild(this.tabsEl);
    this.element.appendChild(this.viewEl);

    this.attachMessageListener();
  }

  private attachMessageListener() {
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.vibeAgentGoViewLog !== true) return;
      if (data.title && typeof data.title === 'string') {
        this.appendLog(data.title, {
          level: data.level || 'log',
          message: data.message || '',
          stack: data.stack,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      }
    });
  }

  render(views: ViewTab[], activeTitle: string | null) {
    this.views = views;
    this.activeTitle = activeTitle;
    this.renderTabs();
    this.renderActiveView();
  }

  getLogs(title: string): LogEntry[] {
    return this.views.find((v) => v.title === title)?.logs || [];
  }

  clearLogs(title: string) {
    const view = this.views.find((v) => v.title === title);
    if (view) view.logs = [];
  }

  private appendLog(title: string, entry: LogEntry) {
    const view = this.views.find((v) => v.title === title);
    if (!view) return;
    if (!view.logs) view.logs = [];
    view.logs.push(entry);
    if (view.logs.length > 500) view.logs = view.logs.slice(-250);
  }

  private setupLogCapture(html: string, title: string): string {
    const captureScript = `
<script>
(function() {
  const send = (level, args) => {
    const message = args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    const stack = args.find(a => a instanceof Error)?.stack || undefined;
    parent.postMessage({ vibeAgentGoViewLog: true, title: ${JSON.stringify(title)}, level, message, stack, timestamp: new Date().toISOString() }, '*');
  };
  const levels = ['log','error','warn','info','debug','trace'];
  levels.forEach(level => {
    const orig = console[level] || console.log;
    console[level] = (...args) => { send(level === 'debug' || level === 'trace' ? 'log' : level, args); try { orig.apply(console, args); } catch {} };
  });
  window.onerror = (msg, url, line, col, err) => {
    send('error', [err || msg + ' at ' + url + ':' + line + ':' + col]);
    return false;
  };
  window.onunhandledrejection = (e) => {
    send('error', [e.reason instanceof Error ? e.reason : new Error(String(e.reason))]);
  };
})();
</script>
    `.trim();
    if (html.includes('<head>')) {
      return html.replace('<head>', '<head>' + captureScript);
    }
    if (html.includes('<body>')) {
      return html.replace('<body>', '<body>' + captureScript);
    }
    return captureScript + html;
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
        this.views = this.views.filter((v) => v.title !== view.title);
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

    const view = this.views.find((v) => v.title === this.activeTitle);
    if (!view) {
      this.iframe.style.display = 'none';
      this.emptyEl.style.display = 'flex';
      return;
    }

    this.emptyEl.style.display = 'none';
    this.iframe.style.display = 'block';

    // Inject log/error capture and render via srcdoc (sandboxed)
    this.iframe.srcdoc = this.setupLogCapture(view.html, view.title);
  }
}
