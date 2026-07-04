import { describe, it, expect } from 'vitest';
import { createDefaultTools } from '../src/core/tools.js';
import type { ToolContext } from '../src/types/index.js';

describe('tools', () => {
  it('creates 7 default tools', () => {
    const tools = createDefaultTools();
    const names = tools.map(t => t.name);
    expect(tools).toHaveLength(7);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('search_files');
    expect(names).toContain('run_code');
    expect(names).toContain('web_search');
    expect(names).toContain('memory_save');
    expect(names).toContain('render_view');
  });

  it('run_code evaluates sandboxed JS', async () => {
    const tools = createDefaultTools();
    const run_code = tools.find(t => t.name === 'run_code')!;
    const ctx = { workspace: '', emit: () => {}, env: {} } as ToolContext;
    const result = await run_code.handler({ code: 'return 1 + 2 * 3;' }, ctx);
    expect(result).toContain('7');
  });

  it('run_code captures logs', async () => {
    const tools = createDefaultTools();
    const run_code = tools.find(t => t.name === 'run_code')!;
    const ctx = { workspace: '', emit: () => {}, env: {} } as ToolContext;
    const result = await run_code.handler({ code: 'log("hello"); return "done";' }, ctx);
    expect(result).toContain('hello');
    expect(result).toContain('done');
  });
});
