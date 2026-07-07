// ============================================================
// vibeAgentGo — AppController
// Central glue: agent lifecycle, window manager, app registration,
// session persistence, and system chrome (header / onboarding).
// ============================================================

import { ChatApp } from '../apps/ChatApp.js';
import { SettingsApp } from '../apps/SettingsApp.js';
import { ProgramApp } from '../apps/ProgramApp.js';
import { ExplorerApp } from '../apps/ExplorerApp.js';
import { TextEditorApp } from '../apps/TextEditorApp.js';
import { OnboardingWizard } from '../components/OnboardingWizard.js';
import { Agent } from './agent.js';
import { registerGlobalErrorHandlers, captureFunctionError } from './global_errors.js';
import {
  loadConfig,
  saveConfig,
  hasCompletedOnboarding,
  MemoryStore,
} from './memory.js';
import { isTextContentPart } from '../types/index.js';
import { createDefaultTools } from './tools.js';
import { initTheme, toggleTheme } from './theme.js';
import { setLanguage, t } from '../i18n/index.js';
import { WindowManager } from './window_manager.js';
import { VERSION } from '../version.js';
import type { BridgeRequest, BridgeResponse, ChatAttachment, App } from '../types/index.js';

export class AppController {
  private memory = new MemoryStore();
  private tools = createDefaultTools();
  private wm = new WindowManager();

  private currentSessionId: string | null = null;
  private agent: Agent | null = null;
  private isRunning = false;
  private chatApp: ChatApp | null = null;
  private programWindowId: string | null = null;

  private readonly LAST_SESSION_KEY = 'vibeAgentGo-lastSession';

  constructor() {
    initTheme();
    setLanguage(loadConfig().language);
    registerGlobalErrorHandlers();
    this.registerServiceWorker();
    this.registerApps();
  }

  start() {
    const config = loadConfig();
    setLanguage(config.language);
    const isDevMode = new URLSearchParams(window.location.search).has('dev');

    if (hasCompletedOnboarding() || isDevMode) {
      this.startApp();
    } else {
      this.startOnboarding();
    }
  }

  // --- Service worker ---

  private registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('./sw.js').catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.isRunning) {
        const checkInterval = setInterval(() => {
          if (!this.isRunning) {
            clearInterval(checkInterval);
            window.location.reload();
          }
        }, 1000);
        setTimeout(() => window.location.reload(), 60000);
      } else {
        window.location.reload();
      }
    });
  }

  // --- Session persistence ---

  private persistLastSession(id: string | null): void {
    if (id) {
      localStorage.setItem(this.LAST_SESSION_KEY, id);
    } else {
      localStorage.removeItem(this.LAST_SESSION_KEY);
    }
  }

  private loadLastSession(): string | null {
    return localStorage.getItem(this.LAST_SESSION_KEY);
  }

  // --- View bridge (ProgramApp iframe) ---

  private handleBridgeRequest = async (req: BridgeRequest): Promise<BridgeResponse> => {
    try {
      switch (req.type) {
        case 'readFile': {
          const content = await this.memory.readFile(req.path);
          return { ok: true, data: content };
        }
        case 'writeFile': {
          await this.memory.writeFile(req.path, req.content);
          return { ok: true, data: null };
        }
        case 'deleteFile': {
          const ok = await this.memory.deleteFile(req.path);
          return { ok, data: null };
        }
        case 'listFiles': {
          const files = await this.memory.listFiles();
          return { ok: true, data: files };
        }
        case 'getMemory': {
          const all = await this.memory.searchAllMemory(1000);
          const query = req.query.toLowerCase();
          const filtered = all
            .filter((m) => (req.category ? m.category === req.category : true))
            .filter((m) => m.content.toLowerCase().includes(query))
            .slice(0, req.limit ?? 50);
          return { ok: true, data: filtered };
        }
        case 'getConfig': {
          const config = loadConfig();
          const keyPresent = Boolean(config.apiKey);
          const safe: Record<string, unknown> = { ...config, apiKey: keyPresent ? '[REDACTED]' : '' };
          return { ok: true, data: safe };
        }
        case 'sendMessage': {
          if (!this.agent || this.isRunning) {
            return { ok: false, error: 'Agent is busy or not ready' };
          }
          const config = loadConfig();
          if (!config.apiKey) {
            return { ok: false, error: 'No API key configured' };
          }
          this.chatApp?.appendUser(req.text);
          this.chatApp?.setStatus('thinking');
          this.chatApp?.startStream();
          this.isRunning = true;
          this.agent.run(req.text, config, this.currentSessionId || undefined).catch((e) => {
            this.chatApp?.appendError(e instanceof Error ? e.message : String(e));
            this.chatApp?.setStatus('idle');
            this.isRunning = false;
          });
          return { ok: true, data: null };
        }
        default: {
          const _exhaustive: never = req;
          return { ok: false, error: `Unknown bridge request: ${_exhaustive}` };
        }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // --- Agent lifecycle ---

  private createAgent(): Agent {
    if (this.agent) {
      try {
        this.agent.abort();
      } catch {
        /* ignore */
      }
    }
    const a = new Agent(this.tools, this.memory, {
      onRenderView: ({ title, html }) => {
        this.openProgramView(title, html);
      },
    });
    this.setupAgent(a);
    return a;
  }

  private setupAgent(a: Agent) {
    a.on('message', ({ role, content }) => {
      if (role === 'assistant' && content && this.chatApp) {
        if (this.chatApp.isStreaming()) {
          this.chatApp.finalizeStream();
        } else {
          this.chatApp.appendAssistant(content);
        }
      }
    });
    a.on('stream_delta', ({ delta }) => {
      this.chatApp?.appendStreamDelta(delta);
    });
    a.on('tool_call', ({ name, args }) => {
      this.chatApp?.appendToolCall(name, args);
    });
    a.on('tool_result', ({ name, result }) => {
      this.chatApp?.appendToolResult(name, result);
    });
    a.on('error', ({ message }) => {
      this.chatApp?.appendError(message);
      this.chatApp?.setStatus('idle');
      this.isRunning = false;
    });
    a.on('session_saved', ({ sessionId }) => {
      this.currentSessionId = sessionId;
      this.persistLastSession(sessionId);
    });
    a.on('turn', ({ turn, total }) => {
      if (turn > 1) {
        this.chatApp?.startStream();
      }
      this.chatApp?.setTurn(turn, total);
    });
    a.on('done', ({ sessionId }) => {
      this.chatApp?.finalizeStream();
      this.chatApp?.setStatus('idle');
      this.currentSessionId = sessionId;
      this.persistLastSession(sessionId);
      this.isRunning = false;
    });
    a.on('abort', () => {
      this.chatApp?.setStatus('idle');
      this.isRunning = false;
    });
  }

  private openProgramView(title: string, html: string) {
    if (!this.programWindowId) {
      this.programWindowId = this.wm.openWindow({ appId: 'program', title, width: 480, height: 360 });
    }
    this.wm.updateWindowData(this.programWindowId, { title, html });
    this.wm.focusWindow(this.programWindowId);
  }

  // --- Session resume ---

  private async resumeSession(sessionId: string) {
    if (this.agent && this.isRunning) {
      this.agent.abort();
    }
    this.currentSessionId = sessionId;
    this.persistLastSession(sessionId);
    this.chatApp?.clear();

    this.agent = this.createAgent();

    try {
      const session = await this.memory.getSession(sessionId);
      if (session) {
        for (const msg of session.messages) {
          if (msg.role === 'user') {
            const userText =
              typeof msg.content === 'string'
                ? msg.content
                : msg.content
                    .filter((c) => c.type === 'text')
                    .map((c) => (isTextContentPart(c) ? c.text : ''))
                    .join('\n');
            this.chatApp?.appendUser(userText as string);
          } else if (msg.role === 'assistant') {
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              for (const tc of msg.tool_calls) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
                } catch {
                  /* ignore */
                }
                this.chatApp?.appendToolCall(tc.function.name, args);
              }
            } else if (msg.content) {
              const assistantText =
                typeof msg.content === 'string'
                  ? msg.content
                  : msg.content
                      .filter((c) => c.type === 'text')
                      .map((c) => (isTextContentPart(c) ? c.text : ''))
                      .join('');
              this.chatApp?.appendAssistant(assistantText as string);
            }
          } else if (msg.role === 'tool') {
            this.chatApp?.appendToolMessage(msg.tool_call_id || '', String(msg.content));
          }
        }
      }
    } catch (e) {
      this.chatApp?.appendError(`${t('error.loadSession')} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // --- App factories ---

  private registerApps() {
    this.wm.registerApp('chat', () => {
      this.chatApp = new ChatApp();
      this.chatApp.setOnResumeSession((sessionId) => this.resumeSession(sessionId));
      this.chatApp.setOnSubmit(async (text: string, attachments: ChatAttachment[]) => {
        const config = loadConfig();
        if (!config.apiKey) {
          this.chatApp?.appendError(t('error.noApiKey'));
          this.wm.launchOrFocus('settings');
          return;
        }
        if (this.isRunning && this.agent) {
          this.chatApp?.appendError(t('common.thinking'));
          return;
        }
        this.chatApp?.appendUser(text, attachments);
        this.chatApp?.setStatus('thinking');
        this.chatApp?.startStream();
        this.isRunning = true;
        if (!this.agent || this.agent.getLastSessionId() !== this.currentSessionId) {
          this.agent = this.createAgent();
        }
        try {
          await this.agent.run(text, config, this.currentSessionId || undefined, attachments);
        } catch (e) {
          captureFunctionError('AppController.onSubmit', e, { sessionId: this.currentSessionId });
          this.chatApp?.appendError(e instanceof Error ? e.message : String(e));
          this.chatApp?.setStatus('idle');
          this.isRunning = false;
        }
      });
      return this.chatApp;
    });

    this.wm.registerApp('settings', () => {
      const app = new SettingsApp();
      app.element.addEventListener('settings:reload', () => window.location.reload());
      return app;
    });

    this.wm.registerApp('program', () => new ProgramApp(this.handleBridgeRequest));

    this.wm.registerApp('explorer', () => {
      const app = new ExplorerApp();
      app.setBridgeHandler(this.handleBridgeRequest);
      app.setOnOpenFile((path) => {
        const winId = this.wm.launchOrFocus('editor');
        const editor = this.wm.getInstance(winId) as TextEditorApp | undefined;
        editor?.openFile(path);
      });
      return app;
    });

    this.wm.registerApp('editor', () => {
      const app = new TextEditorApp();
      app.setBridgeHandler(this.handleBridgeRequest);
      return app;
    });
  }

  // --- Layout ---

  private buildHeader(): HTMLElement {
    const header = document.createElement('header');
    header.className = 'app-header';
    header.innerHTML = `
      <div class="header-left">
        <img class="logo" src="./logo-192.png" alt="vibeAgentGo" width="32" height="32" />
        <span class="version-tag">${VERSION}</span>
      </div>
      <div class="header-right">
        <button id="btn-theme" class="icon-btn" title="${t('header.theme')}">🌓</button>
        <button id="btn-new" class="icon-btn" title="${t('header.newChat')}">✨</button>
      </div>
    `;
    header.querySelector('#btn-theme')!.addEventListener('click', () => toggleTheme());
    header.querySelector('#btn-new')!.addEventListener('click', () => this.newChat());
    return header;
  }

  private buildLayout() {
    const app = document.getElementById('app')!;
    app.innerHTML = '';
    app.appendChild(this.buildHeader());
    app.appendChild(this.wm.element);
    this.wm.launchOrFocus('chat');
  }

  private newChat() {
    if (this.agent && this.isRunning) {
      this.agent.abort();
    }
    this.agent = null;
    this.currentSessionId = null;
    this.persistLastSession(null);
    this.chatApp?.clear();
    this.programWindowId = null;
    for (const id of this.wm.getWindowsByApp('program')) {
      this.wm.closeWindow(id);
    }
    this.chatApp?.setStatus('idle');
    this.isRunning = false;
  }

  // --- Init ---

  private startApp() {
    const config = loadConfig();
    setLanguage(config.language);
    this.buildLayout();

    const lastId = this.loadLastSession();
    if (lastId) {
      this.resumeSession(lastId);
    }
  }

  private startOnboarding() {
    const config = loadConfig();
    setLanguage(config.language);
    const app = document.getElementById('app')!;
    app.innerHTML = '';
    const wizard = new OnboardingWizard();
    wizard.onComplete = () => this.startApp();
    app.appendChild(wizard.element);
  }
}
