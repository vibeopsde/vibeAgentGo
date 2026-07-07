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
import { initTheme } from './theme.js';
import { setLanguage, t } from '../i18n/index.js';
import { WindowManager } from './window_manager.js';
import { sounds } from './sounds.js';
import type { BridgeRequest, BridgeResponse, ChatAttachment, App } from '../types/index.js';

export class AppController {
  private memory = new MemoryStore();
  private tools = createDefaultTools();
  private wm = new WindowManager();

  private currentSessionId: string | null = null;
  private agent: Agent | null = null;
  private isRunning = false;
  private activeChatWindowId: string | null = null;

  private readonly LAST_SESSION_KEY = 'vibeAgentGo-lastSession';

  constructor() {
    initTheme();
    const cfg = loadConfig();
    setLanguage(cfg.language);
    sounds.setEnabled(cfg.sounds !== false);
    registerGlobalErrorHandlers();
    this.registerServiceWorker();
    this.registerApps();
  }

  start() {
    const config = loadConfig();
    setLanguage(config.language);
    document.documentElement.lang = config.language;
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

  // --- Chat window helper ---

  private getChatApp(): ChatApp | undefined {
    return this.activeChatWindowId
      ? (this.wm.getInstance(this.activeChatWindowId) as ChatApp | undefined)
      : undefined;
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
          if (!this.activeChatWindowId) {
            this.wm.openWindow({ appId: 'chat', width: 720, height: 520, x: 40, y: 40 });
          }
          const chat = this.getChatApp();
          chat?.appendUser(req.text);
          chat?.setStatus('thinking');
          chat?.startStream();
          this.isRunning = true;
          try {
            await this.agent.run(req.text, config, this.currentSessionId || undefined);
          } catch (e) {
            captureFunctionError('AppController.handleBridgeRequest.sendMessage', e, { sessionId: this.currentSessionId });
            chat?.appendError(e instanceof Error ? e.message : String(e));
            chat?.setStatus('idle');
          } finally {
            this.isRunning = false;
          }
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
      if (role === 'assistant' && content) {
        const chat = this.getChatApp();
        if (chat?.isStreaming()) {
          chat.finalizeStream();
        } else {
          chat?.appendAssistant(content);
        }
      }
    });
    a.on('stream_delta', ({ delta }) => {
      this.getChatApp()?.appendStreamDelta(delta);
    });
    a.on('tool_call', ({ name, args }) => {
      this.getChatApp()?.appendToolCall(name, args);
      sounds.play('tool_call');
    });
    a.on('tool_result', ({ name, result }) => {
      this.getChatApp()?.appendToolResult(name, result);
    });
    a.on('error', ({ message }) => {
      this.getChatApp()?.appendError(message);
      this.getChatApp()?.setStatus('idle');
      this.isRunning = false;
      sounds.play('error');
    });
    a.on('session_saved', ({ sessionId }) => {
      this.currentSessionId = sessionId;
      this.persistLastSession(sessionId);
    });
    a.on('turn', ({ turn, total }) => {
      if (turn > 1) {
        this.getChatApp()?.startStream();
      }
      this.getChatApp()?.setTurn(turn, total);
    });
    a.on('done', ({ sessionId }) => {
      this.getChatApp()?.finalizeStream();
      this.getChatApp()?.setStatus('idle');
      this.currentSessionId = sessionId;
      this.persistLastSession(sessionId);
      this.isRunning = false;
      sounds.play('done');
    });
    a.on('abort', () => {
      this.getChatApp()?.setStatus('idle');
      this.isRunning = false;
    });
  }

  private openProgramView(title: string, html: string) {
    // Each run_app call opens a new independent window — no singleton.
    this.wm.openWindow({
      appId: 'program',
      title,
      data: { title, html },
      width: 480,
      height: 360,
    });
  }

  // --- Session resume ---

  private async resumeSession(sessionId: string) {
    if (this.agent && this.isRunning) {
      this.agent.abort();
    }
    this.currentSessionId = sessionId;
    this.persistLastSession(sessionId);
    this.getChatApp()?.clear();

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
            this.getChatApp()?.appendUser(userText as string);
          } else if (msg.role === 'assistant') {
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              for (const tc of msg.tool_calls) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
                } catch {
                  /* ignore */
                }
                this.getChatApp()?.appendToolCall(tc.function.name, args);
              }
            } else if (msg.content) {
              const assistantText =
                typeof msg.content === 'string'
                  ? msg.content
                  : msg.content
                      .filter((c) => c.type === 'text')
                      .map((c) => (isTextContentPart(c) ? c.text : ''))
                      .join('');
              this.getChatApp()?.appendAssistant(assistantText as string);
            }
          } else if (msg.role === 'tool') {
            this.getChatApp()?.appendToolMessage(msg.tool_call_id || '', String(msg.content));
          }
        }
      }
    } catch (e) {
      this.getChatApp()?.appendError(`${t('error.loadSession')} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // --- App factories ---

  private registerApps() {
    this.wm.registerApp('chat', () => {
      const chatApp = new ChatApp();
      chatApp.setOnResumeSession((sessionId) => this.resumeSession(sessionId));
      chatApp.setOnNewChat(() => this.newChat());
      chatApp.setOnSubmit(async (text: string, attachments: ChatAttachment[]) => {
        const config = loadConfig();
        if (!config.apiKey) {
          chatApp.appendError(t('error.noApiKey'));
          this.wm.launchOrFocus('settings');
          return;
        }
        if (this.isRunning && this.agent) {
          chatApp.appendError(t('common.thinking'));
          return;
        }
        chatApp.appendUser(text, attachments);
        chatApp.setStatus('thinking');
        chatApp.startStream();
        this.isRunning = true;
        if (!this.agent || this.agent.getLastSessionId() !== this.currentSessionId) {
          this.agent = this.createAgent();
        }
        try {
          await this.agent.run(text, config, this.currentSessionId || undefined, attachments);
        } catch (e) {
          captureFunctionError('AppController.onSubmit', e, { sessionId: this.currentSessionId });
          chatApp.appendError(e instanceof Error ? e.message : String(e));
          chatApp.setStatus('idle');
          this.isRunning = false;
        }
      });
      return chatApp;
    });

    this.wm.registerApp('settings', () => {
      const app = new SettingsApp();
      app.element.addEventListener('settings:reload', () => window.location.reload());
      return app;
    });

    // Program windows are opened by run_app/render — no dock icon.
    this.wm.registerApp('program', () => new ProgramApp(this.handleBridgeRequest), false);

    this.wm.registerApp('explorer', () => {
      const app = new ExplorerApp();
      app.setBridgeHandler(this.handleBridgeRequest);
      app.setOnOpenFile((path) => {
        const winId = this.wm.launchOrFocus('editor');
        const editor = this.wm.getInstance(winId) as TextEditorApp | undefined;
        editor?.openFile(path);
      });
      app.setOnRunApp((title, html) => {
        this.openProgramView(title, html);
      });
      return app;
    });

    this.wm.registerApp('editor', () => {
      const app = new TextEditorApp();
      app.setBridgeHandler(this.handleBridgeRequest);
      return app;
    });

    this.wm.on('window_focused', ({ windowId, appId }) => {
      if (appId === 'chat') {
        this.activeChatWindowId = windowId;
      }
    });
  }

  // --- Layout ---

  private buildLayout() {
    const app = document.getElementById('app')!;
    app.innerHTML = '';
    app.appendChild(this.wm.element);
    // Open the chat window with a usable default size; launchOrFocus uses tiny defaults.
    if (this.wm.getWindowsByApp('chat').length === 0) {
      this.wm.openWindow({ appId: 'chat', width: 720, height: 520, x: 40, y: 40 });
    } else {
      this.wm.launchOrFocus('chat');
    }
  }

  private newChat() {
    if (this.agent && this.isRunning) {
      this.agent.abort();
    }
    this.agent = null;
    this.currentSessionId = null;
    this.persistLastSession(null);
    this.getChatApp()?.clear();
    for (const id of this.wm.getWindowsByApp('program')) {
      this.wm.closeWindow(id);
    }
    this.getChatApp()?.setStatus('idle');
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
