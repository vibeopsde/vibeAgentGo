// ============================================================
// vibeAgentGo — LLM Client tests (browser/jsdom, mocked ReadableStream)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llmChatStream, testConnection } from '../src/core/llm_client.js';

describe('llmChatStream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function buildSSEStream(lines: string[]) {
    const encoder = new TextEncoder();
    const chunks = lines.map((l) => l + '\n');
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[i++]));
      },
    });
  }

  it('returns final content and emits deltas', async () => {
    const deltas: string[] = [];
    const stream = buildSSEStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]);

    (fetch as any).mockResolvedValue({
      ok: true,
      body: stream,
    });

    const res = await llmChatStream({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      onDelta: (d) => deltas.push(d),
    });

    expect(res.content).toBe('Hello world');
    expect(res.finish_reason).toBe('stop');
    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('aggregates tool_calls across chunks', async () => {
    const stream = buildSSEStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"memory_save"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"content\\":\\"fact\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ]);

    (fetch as any).mockResolvedValue({
      ok: true,
      body: stream,
    });

    const res = await llmChatStream({
      messages: [{ role: 'user', content: 'remember this' }],
      tools: [
        {
          type: 'function',
          function: { name: 'memory_save', description: 'save', parameters: { type: 'object', properties: {} } },
        },
      ],
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
    });

    expect(res.tool_calls).toHaveLength(1);
    expect(res.tool_calls![0].id).toBe('call_1');
    expect(res.tool_calls![0].function.name).toBe('memory_save');
    expect(res.tool_calls![0].function.arguments).toBe('{"content":"fact"}');
  });

  it('throws on HTTP error', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      llmChatStream({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'test-model',
        baseUrl: 'https://example.com/v1',
        apiKey: 'bad-key',
      })
    ).rejects.toThrow('LLM API error 401');
  });

  it('aborts when signal is triggered', async () => {
    const controller = new AbortController();
    let fetchStarted = false;

    (fetch as any).mockImplementation((_: string, opts?: any) => {
      fetchStarted = true;
      return new Promise((resolve, reject) => {
        const checkAbort = () => {
          if (opts?.signal?.aborted) {
            opts.signal.removeEventListener('abort', checkAbort);
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
        };
        opts?.signal?.addEventListener('abort', checkAbort);
        checkAbort();
      });
    });

    const promise = llmChatStream({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
      apiKey: 'key',
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow(/abort/i);
  });
});

describe('testConnection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns model list on success', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'm1' }, { id: 'm2' }] }),
    });

    const res = await testConnection({ baseUrl: 'https://example.com/v1', apiKey: 'k' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.models).toEqual(['m1', 'm2']);
    }
  });

  it('sorts models alphabetically and limits to 50', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `model-${String(i).padStart(2, '0')}`);
    const shuffled = [...ids].reverse();
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: shuffled.map((id) => ({ id })) }),
    });

    const res = await testConnection({ baseUrl: 'https://example.com/v1', apiKey: 'x' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.models).toHaveLength(50);
      expect(res.models).toEqual(ids.sort((a, b) => a.localeCompare(b)).slice(0, 50));
    }
  });

  it('returns error on failure', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const res = await testConnection({ baseUrl: 'https://example.com/v1', apiKey: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('HTTP 403');
    }
  });
});
