// ============================================================
// vibeAgentGo — ProgramApp
// Renders interactive HTML/JS artifacts inside the window manager.
// Replaces the old RenderPanel.
// ============================================================

import type { App, BridgeRequest, BridgeResponse } from '../types/index.js';
import type { MemoryStore } from '../types/index.js';
import { loadConfig } from '../core/memory.js';

interface ProgramAppState {
  title: string;
  html: string;
}

export class ProgramApp implements App {
  id = 'program';
  title = 'Program';
  icon = '🪟';
  element: HTMLElement;
  private container: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private onBridgeRequest: (req: BridgeRequest) => Promise<BridgeResponse>;
  private state: ProgramAppState = { title: 'Program', html: '' };
  private messageHandler: ((e: MessageEvent) => void) | null = null;

  constructor(onBridgeRequest: (req: BridgeRequest) => Promise<BridgeResponse>) {
    this.onBridgeRequest = onBridgeRequest;
    this.element = document.createElement('div');
    this.element.className = 'program-app';
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.innerHTML = '';
    this.render(container);
  }

  /** Called by WindowManager.updateWindowData — re-renders the iframe. */
  setData(data: Record<string, unknown>) {
    const title = typeof data.title === 'string' ? data.title : this.state.title;
    const html = typeof data.html === 'string' ? data.html : this.state.html;
    this.setContent(title, html);
  }

  setContent(title: string, html: string) {
    this.state = { title, html };
    if (this.container) {
      this.render(this.container);
    }
  }

  private render(container: HTMLElement) {
    container.innerHTML = '';
    if (!this.state.html) {
      container.innerHTML = '<div class="program-placeholder">No view rendered yet.</div>';
      return;
    }

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'program-iframe';
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    this.iframe.srcdoc = this.wrapHtml(this.state.html);
    this.iframe.style.width = '100%';
    this.iframe.style.height = '100%';
    this.iframe.style.border = 'none';
    container.appendChild(this.iframe);

    this.messageHandler = (e: MessageEvent) => {
      if (e.source !== this.iframe?.contentWindow) return;
      if (e.data?.type !== 'vibeAgentGo') return;
      this.onBridgeRequest(e.data.payload as BridgeRequest).then((res) => {
        this.iframe?.contentWindow?.postMessage({ type: 'vibeAgentGo', id: e.data.id, payload: res }, '*');
      });
    };
    window.addEventListener('message', this.messageHandler);
  }

  private wrapHtml(html: string): string {
    const cfg = loadConfig();
    const safeConfig = { ...cfg, apiKey: cfg.apiKey ? '[REDACTED]' : '' };
    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, sans-serif; }
  body { color: #e6edf3; background: #0d1117; }
</style>
</head>
<body>
${html}
<script>
(function() {
  const bridge = {
    request: (type, payload) => {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve) => {
        const handler = (e) => {
          if (e.data && e.data.type === 'vibeAgentGo' && e.data.id === id) {
            window.removeEventListener('message', handler);
            resolve(e.data.payload);
          }
        };
        window.addEventListener('message', handler);
        window.parent.postMessage({ type: 'vibeAgentGo', id, payload: { type, ...payload } }, '*');
      });
    },
    readFile: (path) => bridge.request('readFile', { path }),
    writeFile: (path, content) => bridge.request('writeFile', { path, content }),
    listFiles: () => bridge.request('listFiles', {}),
    getMemory: (query, category, limit) => bridge.request('getMemory', { query, category, limit }),
    getConfig: () => bridge.request('getConfig', {}),
    sendMessage: (text) => bridge.request('sendMessage', { text }),
  };
  window.vibeAgentGo = bridge;
  window.config = ${JSON.stringify(safeConfig)};
})();
</script>
</body>
</html>
`;
  }

  onBlur() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }

  onClose(): boolean {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    return true;
  }
}
