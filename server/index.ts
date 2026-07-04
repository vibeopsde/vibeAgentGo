// ============================================================
// HAG — PWA Backend (Express + Agent Core, streaming + sessions)
// ============================================================

import express from 'express';
import { Agent } from '../src/core/agent.js';
import { MemoryStore } from '../src/core/memory.js';
import { createDefaultTools } from '../src/tools/registry.js';
import type { AgentConfig, Message } from '../src/types/index.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HAG_HOME = process.env.HAG_HOME || join(process.env.HOME || '/tmp', '.hag');
const WORKSPACE = process.env.HAG_WORKSPACE || join(HAG_HOME, 'workspace');
const DB_PATH = join(HAG_HOME, 'memory.db');

mkdirSync(HAG_HOME, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });

function loadConfig(): AgentConfig {
  const configPath = join(HAG_HOME, 'config.json');
  const config: AgentConfig = {
    model: process.env.HAG_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.HAG_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.HAG_API_KEY || process.env.OPENAI_API_KEY || '',
    maxTurns: 30,
    workspace: WORKSPACE,
  };
  if (existsSync(configPath)) {
    try { Object.assign(config, JSON.parse(readFileSync(configPath, 'utf-8'))); } catch { }
  }
  config.workspace = WORKSPACE;
  return config;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- Config endpoints ---

app.get('/api/config', (_req, res) => {
  const config = loadConfig();
  res.json({
    model: config.model,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    maxTurns: config.maxTurns,
  });
});

app.post('/api/config', (req, res) => {
  const configPath = join(HAG_HOME, 'config.json');
  const current = loadConfig();
  const updated = { ...current, ...req.body, workspace: WORKSPACE };
  writeFileSync(configPath, JSON.stringify(updated, null, 2));
  res.json({ ok: true, model: updated.model, baseUrl: updated.baseUrl, hasApiKey: !!updated.apiKey });
});

// --- Memory endpoints ---

const memory = new MemoryStore(DB_PATH);

app.get('/api/memory', (_req, res) => {
  res.json(memory.getAllMemory());
});

app.delete('/api/memory/:id', (req, res) => {
  const id = parseInt(req.params.id);
  res.json({ ok: memory.deleteMemory(id) });
});

// --- Sessions ---

app.get('/api/sessions', (_req, res) => {
  res.json(memory.listSessions());
});

app.get('/api/sessions/:id', (req, res) => {
  const session = memory.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  res.json({ ok: memory.deleteSession(req.params.id) });
});

// --- Workspace files ---

app.get('/api/files', (_req, res) => {
  const walk = (dir: string, base: string = ''): any[] => {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e: any) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .flatMap((e: any) => {
        const path = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
          return { name: e.name, path, type: 'dir', children: walk(join(dir, e.name), path) };
        }
        return { name: e.name, path, type: 'file', size: statSync(join(dir, e.name)).size };
      });
  };
  try {
    res.json(walk(WORKSPACE));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/file', (req, res) => {
  const filePath = join(WORKSPACE, req.query.path as string || '');
  try {
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// --- WebSocket for Agent Chat ---

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface ClientState {
  ws: WebSocket;
  agent: Agent | null;
  config: AgentConfig;
  currentSessionId: string | null;
  pendingQueue: string[];
}

const clients = new Map<WebSocket, ClientState>();

function send(ws: WebSocket, msg: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function handleChat(client: ClientState, msg: any) {
  const ws = client.ws;
  const config = client.config;

  if (!config.apiKey) {
    send(ws, { type: 'error', message: 'No API key configured. Open Settings.' });
    return;
  }

  // Create agent with tools
  const tools = createDefaultTools();
  const agent = new Agent(config, tools, memory);
  client.agent = agent;

  // Wire events to WebSocket
  agent.on('message', ({ role, content }) => {
    send(ws, { type: 'message', role, content });
  });
  agent.on('stream_delta', ({ delta }) => {
    send(ws, { type: 'stream_delta', delta });
  });
  agent.on('tool_call', ({ name, args }) => {
    send(ws, { type: 'tool_call', name, args });
  });
  agent.on('tool_result', ({ name, result }) => {
    send(ws, { type: 'tool_result', name, result });
  });
  agent.on('render_view', ({ title, html }) => {
    send(ws, { type: 'render_view', title, html });
  });
  agent.on('error', ({ message }) => {
    send(ws, { type: 'error', message });
  });
  agent.on('turn', ({ turn, total }) => {
    send(ws, { type: 'turn', turn, total });
  });

  send(ws, { type: 'status', status: 'thinking' });

  // Session resume: load previous messages if sessionId provided
  let sessionMessages: Message[] | undefined;
  let sessionId: string | undefined = msg.sessionId;

  if (msg.sessionId) {
    const existing = memory.getSession(msg.sessionId);
    if (existing) {
      sessionMessages = existing.messages;
      client.currentSessionId = msg.sessionId;
    }
  }

  try {
    const result = await agent.run(msg.content, sessionMessages, sessionId);
    // Get the session ID — either from the agent's save or the one we passed
    const finalSessionId = agent.getLastSessionId() || sessionId || client.currentSessionId;
    client.currentSessionId = finalSessionId || null;
    send(ws, { type: 'done', result, sessionId: finalSessionId });
  } catch (e: any) {
    send(ws, { type: 'error', message: e.message });
  }
}

wss.on('connection', (ws: WebSocket) => {
  const config = loadConfig();
  const client: ClientState = {
    ws,
    agent: null,
    config,
    currentSessionId: null,
    pendingQueue: [],
  };
  clients.set(ws, client);

  console.log('Client connected');

  ws.on('message', async (data: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'chat') {
      await handleChat(client, msg);
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// --- Heartbeat: detect dead connections ---

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000);

// --- Serve static PWA (built by Vite) ---

app.use(express.static(join(__dirname, '..', 'web', 'dist')));
app.use((_req, res) => {
  res.sendFile(join(__dirname, '..', 'web', 'dist', 'index.html'));
});

const PORT = parseInt(process.env.HAG_PORT || '3456');
server.listen(PORT, () => {
  const cfg = loadConfig();
  console.log(`\n┌─────────────────────────────────────────────┐`);
  console.log(`│  HAG Server v0.2.0                          │`);
  console.log(`│  http://localhost:${PORT}                       │`);
  console.log(`│  Model: ${cfg.model.padEnd(33)}│`);
  console.log(`│  Workspace: ${WORKSPACE.slice(-31).padStart(33)}│`);
  console.log(`└─────────────────────────────────────────────┘\n`);
});