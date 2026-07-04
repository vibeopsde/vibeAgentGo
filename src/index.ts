// ============================================================
// HAG — Hermes Agent Go — Entry Point
// ============================================================

import { Agent } from './core/agent.js';
import { MemoryStore } from './core/memory.js';
import { createDefaultTools } from './tools/registry.js';
import type { AgentConfig } from './types/index.js';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const HAG_HOME = process.env.HAG_HOME || join(process.env.HOME || '/tmp', '.hag');
const WORKSPACE = process.env.HAG_WORKSPACE || join(HAG_HOME, 'workspace');
const DB_PATH = join(HAG_HOME, 'memory.db');
const SKILLS_DIR = join(WORKSPACE, 'skills');

function ensureDirs() {
  for (const dir of [HAG_HOME, WORKSPACE, SKILLS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadConfig(): AgentConfig {
  const configPath = join(HAG_HOME, 'config.json');

  // Defaults from env vars
  const config: AgentConfig = {
    model: process.env.HAG_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.HAG_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.HAG_API_KEY || process.env.OPENAI_API_KEY || '',
    maxTurns: 30,
    workspace: WORKSPACE,
  };

  // Override with config.json if exists
  if (existsSync(configPath)) {
    try {
      const file = JSON.parse(readFileSync(configPath, 'utf-8'));
      Object.assign(config, file);
      config.workspace = WORKSPACE; // workspace is always local
    } catch { /* ignore */ }
  }

  if (!config.apiKey) {
    console.error('⚠ No API key found. Set HAG_API_KEY or OPENAI_API_KEY env var, or create config.json in ~/.hag/');
    console.error('  Example: export HAG_API_KEY="sk-..."');
    console.error('  Or:      export HAG_BASE_URL="http://your-mac-studio:1234/v1" HAG_API_KEY="dummy"');
    process.exit(1);
  }

  return config;
}

function writeDefaultConfig() {
  const configPath = join(HAG_HOME, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'YOUR_API_KEY_HERE',
      maxTurns: 30,
    }, null, 2));
    console.log(`📝 Created default config at ${configPath}`);
    console.log('   Edit it to set your API key and model.\n');
  }
}

// --- Render view handler (CLI mode — writes to file) ---

function handleRenderView(data: { title: string; html: string }) {
  const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filePath = join(WORKSPACE, `${slug}.html`);
  writeFileSync(filePath, data.html);
  console.log(`\n📄 Render View: "${data.title}" → ${filePath}`);
  console.log(`   Open in browser: file://${filePath}\n`);
}

// --- Main ---

export async function main() {
  ensureDirs();
  writeDefaultConfig();
  const config = loadConfig();

  const memory = new MemoryStore(DB_PATH);
  const tools = createDefaultTools();
  const agent = new Agent(config, tools, memory);

  // Event handlers
  agent.on('message', ({ role, content }) => {
    if (role === 'assistant' && content) {
      console.log(`\n🤖 ${content}`);
    }
  });
  agent.on('tool_call', ({ name, args }) => {
    const argStr = Object.keys(args).length > 0 ? JSON.stringify(args).slice(0, 100) : '(no args)';
    console.log(`\n🔧 ${name}(${argStr})`);
  });
  agent.on('tool_result', ({ name, result }) => {
    const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
    console.log(`   → ${preview}`);
  });
  agent.on('render_view', handleRenderView);
  agent.on('error', ({ message }) => {
    console.error(`\n❌ Error: ${message}`);
  });

  // Interactive CLI
  const query = process.argv[2];

  if (query) {
    // Single query mode
    console.log(`👤 ${query}`);
    const result = await agent.run(query);
    console.log(`\n✅ Done.`);
    memory.close();
    return;
  }

  // Interactive REPL mode
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  HAG — Hermes Agent Go v0.1.0               │');
  console.log('│  Model: ' + config.model.padEnd(35) + '│');
  console.log('│  Workspace: ' + (WORKSPACE.length > 33 ? '...' + WORKSPACE.slice(-30) : WORKSPACE).padEnd(33) + '│');
  console.log('│  Type /help for commands, /quit to exit     │');
  console.log('└─────────────────────────────────────────────┘\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '👤 > ',
  });

  let sessionMessages: any[] = [];

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) { rl.prompt(); return; }

    // Slash commands
    if (trimmed === '/quit' || trimmed === '/exit') {
      memory.close();
      process.exit(0);
    }
    if (trimmed === '/help') {
      console.log('Commands:');
      console.log('  /quit        Exit HAG');
      console.log('  /memory      Show stored memories');
      console.log('  /clear       Clear conversation history');
      console.log('  /model       Show current model');
      console.log('  /workspace   Show workspace path');
      rl.prompt();
      return;
    }
    if (trimmed === '/memory') {
      const { memories, profile } = memory.getAllMemory();
      console.log('\n--- User Profile ---');
      profile.forEach(m => console.log(`  [${m.id}] ${m.content}`));
      console.log('\n--- Memories ---');
      memories.forEach(m => console.log(`  [${m.id}] ${m.content}`));
      console.log('');
      rl.prompt();
      return;
    }
    if (trimmed === '/model') {
      console.log(`Model: ${config.model}`);
      console.log(`Base URL: ${config.baseUrl}`);
      rl.prompt();
      return;
    }
    if (trimmed === '/workspace') {
      console.log(`Workspace: ${WORKSPACE}`);
      rl.prompt();
      return;
    }
    if (trimmed === '/clear') {
      sessionMessages = [];
      console.log('Conversation cleared.');
      rl.prompt();
      return;
    }

    // Send to agent
    try {
      const result = await agent.run(trimmed, sessionMessages.length ? sessionMessages : undefined);
      // Update session messages for continuation
      // (In a full implementation, we'd track this from the agent)
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    memory.close();
    process.exit(0);
  });
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});