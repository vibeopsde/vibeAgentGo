// ============================================================
// vibeAgentGo — Sandbox tests (browser-only; jsdom cannot load iframe srcdoc)
// ============================================================

import { describe, it, expect } from 'vitest';
import { runInSandbox } from '../src/utils/sandbox.js';

const isJsdom = typeof window !== 'undefined' && window.navigator?.userAgent?.toLowerCase().includes('jsdom');

describe.skipIf(isJsdom)('runInSandbox', () => {
  it('executes code and returns result', async () => {
    const res = await runInSandbox('return 2 + 2');
    expect(res.error).toBeUndefined();
    expect(res.result).toBe('4');
  });

  it('captures console logs', async () => {
    const res = await runInSandbox('console.log("hello"); log("world")');
    expect(res.logs.map((l) => l.message)).toContain('hello');
    expect(res.logs.map((l) => l.message)).toContain('world');
  });

  it('returns errors for thrown exceptions', async () => {
    const res = await runInSandbox('throw new Error("boom")');
    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('boom');
  });

  it('does not allow network access via fetch', async () => {
    const res = await runInSandbox('return typeof fetch');
    expect(res.result).toBe('undefined');
  });

  it('does not allow WebSocket access', async () => {
    const res = await runInSandbox('return typeof WebSocket');
    expect(res.result).toBe('undefined');
  });

  it('does not allow XMLHttpRequest access', async () => {
    const res = await runInSandbox('return typeof XMLHttpRequest');
    expect(res.result).toBe('undefined');
  });

  it('does not allow localStorage access', async () => {
    const res = await runInSandbox('return typeof localStorage');
    expect(res.result).toBe('undefined');
  });

  it('does not allow indexedDB access', async () => {
    const res = await runInSandbox('return typeof indexedDB');
    expect(res.result).toBe('undefined');
  });

  it('does not allow dynamic import', async () => {
    const res = await runInSandbox('return typeof import');
    // In the sandbox scope, import is a reserved keyword and not available as a function.
    expect(res.result).toBe('undefined');
  });

  it('times out long-running code', async () => {
    const res = await runInSandbox('while(true){}', 100);
    expect(res.error?.message).toContain('timed out');
  });
});
