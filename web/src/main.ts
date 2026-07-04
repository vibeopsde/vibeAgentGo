// ============================================================
// HAG — PWA Main Entry (v0.3 — fully client-side, no server)
// Agent runs in browser, data in IndexedDB, LLM via direct fetch
// ============================================================

import './styles/app.css';
import { ChatPanel } from './components/ChatPanel.js';
import { RenderPanel } from './components/RenderPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { MemoryPanel } from './components/MemoryPanel.js';
import { SessionPanel } from './components/SessionPanel.js';
import { Agent } from './core/agent.js';
import { MemoryStore, loadConfig, saveConfig, hasApiKey } from './core/memory.js';
import { createDefaultTools } from './core/tools.js';

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

// --- Core instances ---

const memory = new MemoryStore();
const tools = createDefaultTools();

// --- Components ---

const chatPanel = new ChatPanel();
const renderPanel = new RenderPanel();
const settingsModal = new SettingsModal();
const memoryPanel = new MemoryPanel();
const sessionPanel = new SessionPanel();

// --- Agent event handlers ---

function setupAgent(a: Agent) {
  a.on('message', ({ role, content }) => {
    if (role === 'assistant') {
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
  currentSessionId = sessionId;
  chatPanel.clear();
  views.length = 0;
  activeView = null;
  renderPanel.render(views, null);

  try {
    const session = await memory.getSession(sessionId);
    if (session) {
      for (const msg of session.messages) {
        if (msg.role === 'user') {
          chatPanel.appendUser(msg.content);
        } else if (msg.role === 'assistant' && msg.content) {
          chatPanel.appendAssistant(msg.content);
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
      <span class="logo">HAG</span>
      <span class="subtitle">Hermes Agent Go</span>
    </div>
    <div class="header-right">
      <button id="btn-sessions" class="icon-btn" title="Sessions">💬</button>
      <button id="btn-new" class="icon-btn" title="New Chat">✨</button>
      <button id="btn-memory" class="icon-btn" title="Memory">🧠</button>
      <button id="btn-settings" class="icon-btn" title="Settings">⚙️</button>
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

  app.appendChild(header);
  app.appendChild(main);

  // Wire buttons
  header.querySelector('#btn-settings')!.addEventListener('click', () => settingsModal.open());
  header.querySelector('#btn-memory')!.addEventListener('click', () => memoryPanel.open());
  header.querySelector('#btn-sessions')!.addEventListener('click', () => sessionPanel.open());
  header.querySelector('#btn-new')!.addEventListener('click', () => newChat());

  // Chat submit — runs agent directly in browser
  chatPanel.onSubmit = async (text: string) => {
    const config = loadConfig();
    if (!config.apiKey) {
      chatPanel.appendError('No API key configured. Open Settings (⚙️).');
      settingsModal.open();
      return;
    }

    chatPanel.appendUser(text);
    chatPanel.setStatus('thinking');
    chatPanel.startStream();

    // Create fresh agent for each message, reusing session messages if resuming
    agent = new Agent(tools, memory);
    setupAgent(agent);

    try {
      // If resuming, load previous session messages
      let sessionMessages: any[] | undefined;
      if (currentSessionId) {
        const existing = await memory.getSession(currentSessionId);
        if (existing) {
          sessionMessages = existing.messages;
        }
      }

      await agent.run(text, config, sessionMessages, currentSessionId || undefined);
    } catch (e: any) {
      chatPanel.appendError(e.message);
      chatPanel.setStatus('idle');
    }
  };
}

function newChat() {
  currentSessionId = null;
  chatPanel.clear();
  views.length = 0;
  activeView = null;
  renderPanel.render(views, null);
  chatPanel.setStatus('idle');
}

// --- Init ---

buildLayout();

// Check if API key is set
if (!hasApiKey()) {
  settingsModal.open();
}