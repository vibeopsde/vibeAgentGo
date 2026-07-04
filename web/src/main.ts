// ============================================================
// HAG — PWA Main Entry (streaming + reconnection + sessions)
// ============================================================

import './styles/app.css';
import { ChatPanel } from './components/ChatPanel.js';
import { RenderPanel } from './components/RenderPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { MemoryPanel } from './components/MemoryPanel.js';
import { SessionPanel } from './components/SessionPanel.js';

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

// --- WebSocket with Reconnection ---

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 10000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pendingMessages: string[] = []; // Queue messages while disconnected

function connectWs(): WebSocket {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.onopen = () => {
    console.log('WS connected');
    reconnectAttempts = 0;
    chatPanel.setStatus('idle');
    chatPanel.setConnectionStatus(true);

    // Flush queued messages
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift()!;
      socket.send(msg);
    }

    // Start heartbeat
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  };

  socket.onclose = (event) => {
    console.log(`WS closed (code=${event.code}), reconnecting...`);
    chatPanel.setStatus('disconnected');
    chatPanel.setConnectionStatus(false);
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }

    // Exponential backoff with jitter
    reconnectAttempts++;
    const baseDelay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
    const jitter = Math.random() * 500;
    const delay = baseDelay + jitter;

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      ws = connectWs();
    }, delay);
  };

  socket.onerror = () => {
    // onclose will handle reconnection
  };

  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleWsMessage(msg);
  };

  return socket;
}

function sendWs(msg: any) {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  } else {
    // Queue for when we reconnect
    pendingMessages.push(data);
    console.log('WS not connected, message queued');
  }
}

// --- Components ---

const chatPanel = new ChatPanel();
const renderPanel = new RenderPanel();
const settingsModal = new SettingsModal();
const memoryPanel = new MemoryPanel();
const sessionPanel = new SessionPanel();

// --- Message Handler ---

function handleWsMessage(msg: any) {
  switch (msg.type) {
    case 'status':
      chatPanel.setStatus(msg.status);
      if (msg.status === 'thinking') {
        chatPanel.startStream();
      }
      break;
    case 'stream_delta':
      chatPanel.appendStreamDelta(msg.delta);
      break;
    case 'message':
      // Non-streaming message (e.g. "(calling tools...)" or final)
      if (msg.role === 'assistant') {
        chatPanel.finalizeStream();
        chatPanel.appendAssistant(msg.content);
      }
      break;
    case 'tool_call':
      chatPanel.appendToolCall(msg.name, msg.args);
      break;
    case 'tool_result':
      chatPanel.appendToolResult(msg.name, msg.result);
      break;
    case 'render_view':
      addView(msg.title, msg.html);
      break;
    case 'error':
      chatPanel.appendError(msg.message);
      break;
    case 'done':
      chatPanel.finalizeStream();
      chatPanel.setStatus('idle');
      if (msg.sessionId) {
        currentSessionId = msg.sessionId;
      }
      break;
    case 'turn':
      // Turn info — don't override "thinking" status
      // Tool calls create new stream context on next turn
      if (msg.turn > 1) {
        chatPanel.startStream();
      }
      chatPanel.setTurn(msg.turn, msg.total);
      break;
    case 'pong':
      // Heartbeat response — connection alive
      break;
  }
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

  // Load session messages and render them in chat
  try {
    const res = await fetch(`./api/sessions/${sessionId}`);
    const session = await res.json();

    // Render previous messages in chat panel
    for (const msg of session.messages) {
      if (msg.role === 'user') {
        chatPanel.appendUser(msg.content);
      } else if (msg.role === 'assistant' && msg.content) {
        chatPanel.appendAssistant(msg.content);
      }
      // Skip system and tool messages for display
    }
  } catch (e) {
    chatPanel.appendError('Failed to load session: ' + e);
  }
}

// Wire session panel
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

  // Chat submit
  chatPanel.onSubmit = (text: string) => {
    chatPanel.appendUser(text);
    sendWs({
      type: 'chat',
      content: text,
      sessionId: currentSessionId || undefined,
    });
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
ws = connectWs();

// Load settings on start
fetch('./api/config').then(r => r.json()).then(config => {
  if (!config.hasApiKey) {
    settingsModal.open();
  }
});