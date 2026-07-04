// ============================================================
// HAG — Test Suite
// ============================================================

import { MemoryStore } from '../src/core/memory.js';
import { buildSystemPrompt, loadSkills, toolsToSchemas } from '../src/core/prompt_builder.js';
import { createDefaultTools, dispatchTool } from '../src/tools/registry.js';
import { quickjsEval } from '../src/tools/quickjs.js';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { Agent } from '../src/core/agent.js';

const TEST_DIR = join(process.env.HOME || '/tmp', '.hag-test');
const TEST_DB = join(TEST_DIR, 'test.db');
const TEST_WORKSPACE = join(TEST_DIR, 'workspace');

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function runTests() {
  console.log('\n🧪 HAG Test Suite\n');

  // Clean test dir
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_WORKSPACE, { recursive: true });
  mkdirSync(join(TEST_WORKSPACE, 'skills'), { recursive: true });

  // --- Test 1: Memory Store ---
  console.log('\n📁 Memory Store:');
  const mem = new MemoryStore(TEST_DB);

  mem.saveMemory('User prefers concise responses', 'user');
  mem.saveMemory('Project uses TypeScript', 'memory');
  mem.saveMemory('Mac Studio is backend at 192.168.x.x', 'memory');

  const { memories, profile } = mem.getAllMemory();
  assert(memories.length === 2, `Loaded 2 memories (got ${memories.length})`);
  assert(profile.length === 1, `Loaded 1 profile entry (got ${profile.length})`);
  assert(profile[0].content.includes('concise'), 'Profile content correct');

  // Session save/load
  mem.saveSession({
    id: 'test1',
    title: 'Test session',
    messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const loaded = mem.getSession('test1');
  assert(loaded !== null, 'Session loaded');
  assert(loaded?.messages.length === 2, 'Session has 2 messages');
  assert(loaded?.title === 'Test session', 'Session title correct');

  const sessions = mem.listSessions();
  assert(sessions.length === 1, 'Session list has 1 entry');

  mem.close();

  // --- Test 2: Prompt Builder ---
  console.log('\n📝 Prompt Builder:');
  const skills = loadSkills(join(TEST_WORKSPACE, 'skills'));
  assert(skills.length === 0, 'No skills in empty dir');

  // Write a skill and reload
  writeFileSync(join(TEST_WORKSPACE, 'skills', 'test.md'),
    '---\nname: test-skill\ndescription: A test skill\ntrigger: ["test"]\n---\n\n# Test Skill\n\nThis is a test.');
  const skills2 = loadSkills(join(TEST_WORKSPACE, 'skills'));
  assert(skills2.length === 1, 'Loaded 1 skill');
  assert(skills2[0].name === 'test-skill', 'Skill name parsed from frontmatter');
  assert(skills2[0].trigger?.includes('test'), 'Skill trigger parsed');

  const tools = createDefaultTools();
  const prompt = buildSystemPrompt({
    workspace: TEST_WORKSPACE,
    memories: [{ id: 1, content: 'Test memory', category: 'memory', created_at: 'now' }],
    profile: [{ id: 2, content: 'Test user', category: 'user', created_at: 'now' }],
    skills: skills2,
    tools,
  });
  assert(prompt.includes('HAG'), 'Prompt contains identity');
  assert(prompt.includes('Test memory'), 'Prompt contains memory');
  assert(prompt.includes('Test user'), 'Prompt contains user profile');
  assert(prompt.includes('test-skill'), 'Prompt contains skill');
  assert(prompt.includes('read_file'), 'Prompt contains tool list');
  assert(prompt.includes('render_view'), 'Prompt contains render_view tool');

  // --- Test 3: Tool Schemas ---
  console.log('\n🔧 Tool Registry:');
  const schemas = toolsToSchemas(tools);
  assert(schemas.length === 7, `7 tool schemas (got ${schemas.length})`);
  assert(schemas.some(s => s.function.name === 'render_view'), 'render_view schema present');
  assert(schemas.some(s => s.function.name === 'memory_save'), 'memory_save schema present');
  assert(schemas.some(s => s.function.name === 'run_code'), 'run_code schema present');

  // --- Test 4: File Tools ---
  console.log('\n📂 File Tools:');

  const ctx = {
    workspace: TEST_WORKSPACE,
    emit: (event: string, data: any) => {},
    env: {},
  };

  // write_file
  const writeResult = await dispatchTool('write_file', {
    path: 'test.txt',
    content: 'Hello HAG!',
  }, ctx, tools);
  assert(writeResult.includes('Wrote'), 'write_file succeeded');

  // read_file
  const readResult = await dispatchTool('read_file', { path: 'test.txt' }, ctx, tools);
  assert(readResult === 'Hello HAG!', 'read_file returns correct content');

  // search_files (by name)
  const searchResult = await dispatchTool('search_files', { pattern: 'test', target: 'files' }, ctx, tools);
  assert(searchResult.includes('test.txt'), 'search_files finds test.txt');

  // search_files (by content)
  const contentResult = await dispatchTool('search_files', { pattern: 'Hello', target: 'content' }, ctx, tools);
  assert(contentResult.includes('Hello HAG'), 'search_files content search works');

  // Path traversal protection
  const traversalResult = await dispatchTool('read_file', { path: '../../../etc/passwd' }, ctx, tools);
  assert(traversalResult.includes('Error'), 'Path traversal blocked');

  // --- Test 5: QuickJS Sandbox ---
  console.log('\n⚡ QuickJS Sandbox:');
  const codeResult = await quickjsEval('1 + 2 * 3', { workspace: TEST_WORKSPACE, env: {} });
  assert(codeResult.includes('7'), 'QuickJS math: 1 + 2 * 3 = 7');

  const logResult = await quickjsEval('log("hello"); log("world"); "done"', { workspace: TEST_WORKSPACE, env: {} });
  assert(logResult.includes('hello'), 'QuickJS captures log output');
  assert(logResult.includes('world'), 'QuickJS captures second log');
  assert(logResult.includes('done'), 'QuickJS returns final value');

  const errorResult = await quickjsEval('throw new Error("boom")', { workspace: TEST_WORKSPACE, env: {} });
  assert(errorResult.includes('boom'), 'QuickJS captures thrown errors');

  // --- Test 6: render_view Tool ---
  console.log('\n📊 Render View:');
  let renderEvent: any = null;
  const renderCtx = {
    workspace: TEST_WORKSPACE,
    emit: (event: string, data: any) => { renderEvent = data; },
    env: {},
  };

  // Write an HTML file first, then render by path
  await dispatchTool('write_file', {
    path: 'dashboard/index.html',
    content: '<html><body><h1>Dashboard</h1></body></html>',
  }, renderCtx, tools);

  const renderResult = await dispatchTool('render_view', {
    title: 'My Dashboard',
    path: 'dashboard/index.html',
  }, renderCtx, tools);

  assert(renderResult.includes('Rendered'), 'render_view by path succeeded');
  assert(renderEvent?.title === 'My Dashboard', 'render_view event has title');
  assert(renderEvent?.html.includes('Dashboard'), 'render_view event has HTML content');

  // render_view with inline HTML
  const renderResult2 = await dispatchTool('render_view', {
    title: 'Inline View',
    html: '<html><body><p>Inline</p></body></html>',
  }, renderCtx, tools);
  assert(renderResult2.includes('Rendered'), 'render_view with inline HTML succeeded');
  assert(renderEvent?.html.includes('Inline'), 'render_view event has inline HTML');

  // --- Test 7: memory_save Tool ---
  console.log('\n🧠 Memory Save Tool:');
  const mem2 = new MemoryStore(TEST_DB);
  const memCtx = {
    workspace: TEST_WORKSPACE,
    emit: () => {},
    env: {
      __memorySave: (content: string, category: 'memory' | 'user') => mem2.saveMemory(content, category),
    },
  };

  const saveResult = await dispatchTool('memory_save', {
    content: 'Test: user likes dark mode',
    category: 'user',
  }, memCtx, tools);
  assert(saveResult.includes('Saved'), 'memory_save tool returns success');
  assert(saveResult.includes('user'), 'memory_save reports category');

  const { profile: p2 } = mem2.getAllMemory();
  assert(p2.some(m => m.content.includes('dark mode')), 'Memory was persisted to SQLite');
  mem2.close();

  // --- Summary ---
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`✅ ${passed} passed | ❌ ${failed} failed`);
  console.log(`${'─'.repeat(40)}\n`);

  // Cleanup
  rmSync(TEST_DIR, { recursive: true, force: true });

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});