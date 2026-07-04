// ============================================================
// HAG — PWA Main Entry
// ============================================================

import './styles/app.css';
import { ChatPanel } from './components/ChatPanel.js';
import { RenderPanel } from './components/RenderPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { MemoryPanel } from './components/MemoryPanel.js';

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

// --- WebSocket ---

let ws: WebSocket | null = null;

function connectWs(): WebSocket {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.onopen = () => console.log('WS connected');
  socket.onclose = () => {
    console.log('WS disconnected, reconnecting in 2s');
    setTimeout(() => { ws = connectWs(); }, 2000);
  };

  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleWsMessage(msg);
  };

  return socket;
}

// --- Message Handler ---

const chatPanel = new ChatPanel();
const renderPanel = new RenderPanel();
const settingsModal = new SettingsModal();
const memoryPanel = new MemoryPanel();

function handleWsMessage(msg: any) {
  switch (msg.type) {
    case 'status':
      chatPanel.setStatus(msg.status);
      break;
    case 'message':
      if (msg.role === 'assistant') {
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
      chatPanel.setStatus('idle');
      break;
    case 'turn':
      chatPanel.setTurn(msg.turn, msg.total);
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

  // Chat submit
  chatPanel.onSubmit = (text: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      chatPanel.appendError('Not connected to server');
      return;
    }
    chatPanel.appendUser(text);
    ws.send(JSON.stringify({ type: 'chat', content: text }));
  };
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