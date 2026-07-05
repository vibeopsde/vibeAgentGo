// ============================================================
// vibeAgentGo — PWA Main Entry (VERSION — fully client-side, no server)
// Agent runs in browser, data in IndexedDB, LLM via direct fetch
// ============================================================

import './styles/app.css';
import { initTheme, toggleTheme } from './core/theme.js';
import { ChatPanel } from './components/ChatPanel.js';
import { RenderPanel } from './components/RenderPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { MemoryPanel } from './components/MemoryPanel.js';
import { SessionPanel } from './components/SessionPanel.js';
import { MobileNav, type MobileTab } from './components/MobileNav.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { Agent } from './core/agent.js';
import { MemoryStore, loadConfig, saveConfig, hasApiKey, hasCompletedOnboarding, resetLocalData } from './core/memory.js';
import { createDefaultTools } from './core/tools.js';
import { VERSION } from './version.js';

// Initialize theme before first render to avoid flash
initTheme();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// --- App State ---

interface ViewTab {
  title: string;
  html: string;
}

const views: ViewTab[] = [];
let activeView: string | null = null;
let currentSessionId: string | null = null;
let agent: Agent | null = null;
let isRunning = false;

// --- Core instances ---

const memory = new MemoryStore();
const tools = createDefaultTools();

// --- Components ---

const chatPanel = new ChatPanel();
const renderPanel = new RenderPanel();
const settingsModal = new SettingsModal();
const memoryPanel = new MemoryPanel();
const sessionPanel = new SessionPanel();

// --- Agent lifecycle ---

function createAgent(): Agent {
  if (agent) {
    try { agent.abort(); } catch { /* ignore */ }
  }
  const a = new Agent(tools, memory, { renderPanel });
  setupAgent(a);
  return a;
}

function setupAgent(a: Agent) {
  a.on('message', ({ role, content }) => {
    if (role === 'assistant' && content) {
      chatPanel.finalizeStream();
      chatPanel.appendAssistant(content);
    }
  });
  a.on('stream_delta', ({ delta }) => {
    chatPanel.appendStreamDelta(delta);
  });
  a.on('tool_call', ({ name, args }) => {
    chatPanel.appendToolCall(name, args);
  });
  a.on('tool_result', ({ name, result }) => {
    chatPanel.appendToolResult(name, result);
  });
  a.on('render_view', ({ title, html }) => {
    addView(title, html);
  });
  a.on('error', ({ message }) => {
    chatPanel.appendError(message);
  });
  a.on('turn', ({ turn, total }) => {
    if (turn > 1) {
      chatPanel.startStream();
    }
    chatPanel.setTurn(turn, total);
  });
  a.on('done', ({ sessionId }) => {
    chatPanel.finalizeStream();
    chatPanel.setStatus('idle');
    currentSessionId = sessionId;
    isRunning = false;
  });
  a.on('abort', () => {
    chatPanel.setStatus('idle');
    isRunning = false;
  });
}

function addView(title: string, html: string) {
  const existing = views.find(v => v.title === title);
  if (existing) {
    existing.html = html;
  } else {
    views.push({ title, html });
  }
  activeView = title;
  renderPanel.render(views, activeView);
}

// --- Session Resume ---

async function resumeSession(sessionId: string) {
  // Abort any running agent before switching sessions
  if (agent && isRunning) {
    agent.abort();
  }
  currentSessionId = sessionId;
  chatPanel.clear();
  views.length = 0;
  activeView = null;
  renderPanel.render(views, null);

  // Create a fresh agent bound to the resumed session
  agent = createAgent();

  try {
    const session = await memory.getSession(sessionId);
    if (session) {
      for (const msg of session.messages) {
        if (msg.role === 'user') {
          chatPanel.appendUser(msg.content);
        } else if (msg.role === 'assistant') {
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              let args: any = {};
              try { args = JSON.parse(tc.function.arguments); } catch { }
              chatPanel.appendToolCall(tc.function.name, args);
            }
          } else if (msg.content) {
            chatPanel.appendAssistant(msg.content);
          }
        } else if (msg.role === 'tool') {
          chatPanel.appendToolMessage(msg.tool_call_id || '', msg.content);
        }
      }
    }
  } catch (e: any) {
    chatPanel.appendError('Failed to load session: ' + e.message);
  }
}

sessionPanel.onResume = (id) => {
  resumeSession(id);
};

// --- Layout ---

function buildLayout() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <div class="header-left">
      <span class="logo">vibeAgentGo</span>
      <span class="version-tag">${VERSION}</span>
    </div>
    <div class="header-right">
      <button id="btn-theme" class="icon-btn desktop-only" title="Toggle theme">🌓</button>
      <button id="btn-sessions" class="icon-btn desktop-only" title="Sessions">💬</button>
      <button id="btn-new" class="icon-btn desktop-only" title="New Chat">✨</button>
      <button id="btn-memory" class="icon-btn desktop-only" title="Memory">🧠</button>
      <button id="btn-settings" class="icon-btn desktop-only" title="Settings">⚙️</button>
      <button id="btn-mobile-menu" class="icon-btn mobile-only" title="Menu" aria-label="Menu">☰</button>
    </div>
  `;

  const main = document.createElement('main');
  main.className = 'app-main';

  const chatSection = document.createElement('section');
  chatSection.className = 'chat-section';
  chatSection.appendChild(chatPanel.element);

  const renderSection = document.createElement('section');
  renderSection.className = 'render-section';
  renderSection.appendChild(renderPanel.element);

  main.appendChild(chatSection);
  main.appendChild(renderSection);

  // Mobile starts on Chat tab
  chatSection.classList.add('is-active');

  const mobileNav = new MobileNav(
    (tab: MobileTab) => {
      chatSection.classList.toggle('is-active', tab === 'chat');
      renderSection.classList.toggle('is-active', tab === 'render');
      mobileNav.setActive(tab);
    },
    () => newChat()
  );

  app.appendChild(header);
  app.appendChild(main);
  app.appendChild(mobileNav.element);

  // Wire buttons
  header.querySelector('#btn-settings')!.addEventListener('click', () => settingsModal.open());
  header.querySelector('#btn-memory')!.addEventListener('click', () => memoryPanel.open());
  header.querySelector('#btn-sessions')!.addEventListener('click', () => sessionPanel.open());
  header.querySelector('#btn-new')!.addEventListener('click', () => newChat());
  header.querySelector('#btn-theme')!.addEventListener('click', () => toggleTheme());
  header.querySelector('#btn-mobile-menu')!.addEventListener('click', () => openMobileMenu());

  // Chat submit — runs agent directly in browser
  chatPanel.onSubmit = async (text: string) => {
    const config = loadConfig();
    if (!config.apiKey) {
      chatPanel.appendError('No API key configured. Open Settings (⚙️).');
      settingsModal.open();
      return;
    }

    if (isRunning && agent) {
      chatPanel.appendError('Agent is already running. Please wait or abort.');
      return;
    }

    chatPanel.appendUser(text);
    chatPanel.setStatus('thinking');
    chatPanel.startStream();
    isRunning = true;

    // Reuse existing agent for the current session, or create a fresh one
    if (!agent || agent.getLastSessionId() !== currentSessionId) {
      agent = createAgent();
    }

    try {
      await agent.run(text, config, currentSessionId || undefined);
    } catch (e: any) {
      chatPanel.appendError(e.message);
      chatPanel.setStatus('idle');
      isRunning = false;
    }
  };
}

function newChat() {
  if (agent && isRunning) {
    agent.abort();
  }
  agent = null;
  currentSessionId = null;
  chatPanel.clear();
  views.length = 0;
  activeView = null;
  renderPanel.render(views, null);
  chatPanel.setStatus('idle');
  isRunning = false;
}

function openMobileMenu() {
  // Simple bottom sheet with Settings and Memory for mobile
  const overlay = document.createElement('div');
  overlay.className = 'mobile-menu-overlay';
  overlay.innerHTML = `
    <div class="mobile-menu-sheet">
      <div class="mobile-menu-header">
        <span>Menu</span>
        <button class="mobile-menu-close">✕</button>
      </div>
      <button class="mobile-menu-item" data-action="theme">🌓 Theme</button>
      <button class="mobile-menu-item" data-action="settings">⚙️ Settings</button>
      <button class="mobile-menu-item" data-action="memory">🧠 Memory</button>
      <button class="mobile-menu-item" data-action="sessions">💬 Sessions</button>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('.mobile-menu-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.mobile-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = (item as HTMLElement).dataset.action!;
      close();
      if (action === 'theme') toggleTheme();
      if (action === 'settings') settingsModal.open();
      if (action === 'memory') memoryPanel.open();
      if (action === 'sessions') sessionPanel.open();
    });
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

// --- Init ---

function startApp() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  buildLayout();
}

function startOnboarding() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  const wizard = new OnboardingWizard();
  wizard.onComplete = () => {
    startApp();
  };
  app.appendChild(wizard.element);
}

if (hasCompletedOnboarding()) {
  startApp();
} else {
  startOnboarding();
}
