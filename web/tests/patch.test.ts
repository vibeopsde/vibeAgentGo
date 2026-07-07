import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultTools } from '../src/core/tools.js';
import { MemoryStore } from '../src/core/memory.js';

const makeCtx = (mem: MemoryStore) => ({
  workspace: '/workspace',
  env: { memoryStore: mem },
  emit: () => {},
});

describe('patch tool', () => {
  let mem: MemoryStore;
  let tools: ReturnType<typeof createDefaultTools>;
  let patch: ReturnType<typeof createDefaultTools>[number];

  beforeEach(() => {
    mem = new MemoryStore();
    tools = createDefaultTools();
    patch = tools.find((t) => t.name === 'patch')!;
  });

  it('replaces a unique string', async () => {
    await mem.writeFile('test.txt', 'hello world');
    const res = await patch.handler(
      { mode: 'replace', path: 'test.txt', old_string: 'world', new_string: 'vibeAgentGo' },
      makeCtx(mem)
    );
    expect(res).toContain('Replaced 1 occurrence(s)');
    expect(await mem.readFile('test.txt')).toBe('hello vibeAgentGo');
  });

  it('refuses to replace non-unique string without replace_all', async () => {
    await mem.writeFile('test.txt', 'a a a');
    const res = await patch.handler(
      { mode: 'replace', path: 'test.txt', old_string: 'a', new_string: 'b' },
      makeCtx(mem)
    );
    expect(res).toContain('not unique');
    expect(await mem.readFile('test.txt')).toBe('a a a');
  });

  it('replaces all with replace_all', async () => {
    await mem.writeFile('test.txt', 'a a a');
    const res = await patch.handler(
      { mode: 'replace', path: 'test.txt', old_string: 'a', new_string: 'b', replace_all: true },
      makeCtx(mem)
    );
    expect(res).toContain('Replaced 3 occurrence(s)');
    expect(await mem.readFile('test.txt')).toBe('b b b');
  });

  it('applies a V4A patch block', async () => {
    await mem.writeFile('a.txt', 'line1\nline2\nline3');
    const patchText = [
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@ context @@',
      'line1',
      '-line2',
      '+line2-changed',
      '*** End Patch',
    ].join('\n');
    const res = await patch.handler({ mode: 'patch', patch: patchText }, makeCtx(mem));
    expect(res).toContain('a.txt: patched');
    expect(await mem.readFile('a.txt')).toBe('line1\nline2-changed\nline3');
  });

  it('validates JSON syntax in replace mode', async () => {
    await mem.writeFile('data.json', '{"ok": true}');
    const res = await patch.handler(
      { mode: 'replace', path: 'data.json', old_string: '{"ok": true}', new_string: '{"ok": true' },
      makeCtx(mem)
    );
    expect(res).toContain('JSON syntax error');
    expect(await mem.readFile('data.json')).toBe('{"ok": true}');
  });
});
