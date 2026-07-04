// ============================================================
// vibeAgentGo — Agent loop tests (mocked LLM client)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../src/core/agent.js';
import { MemoryStore } from '../src/core/memory.js';
import type { Message, Tool } from '../src/types/index.js';

// Mock the LLM client so no real network calls are made
vi.mock('../src/core/llm_client.js', async () => {
  const original = await vi.importActual('../src/core/llm_client.js');
  return {
    ...original,
    llmChatStream: vi.fn(),
  };
});

import { llmChatStream } from '../src/core/llm_client.js';

const mockConfig = {
  model: 'test-model',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  maxTurns: 5,
  maxTokens: 1024,
};

function echoTool(): Tool {
  return {
    name: 'echo',
    description: 'echo a message',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    handler: async (args) => `echo: ${args.message}`,
  };
}

describe('Agent', () => {
  let memory: MemoryStore;
  let agent: Agent;

  beforeEach(() => {
    memory = new MemoryStore();
    agent = new Agent([echoTool()], memory);
    (llmChatStream as any).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executes a tool call and continues to final answer', async () => {
    const toolCalls: { name: string; args: any }[] = [];
    const toolResults: { name: string; result: string }[] = [];
    agent.on('tool_call', (e) => toolCalls.push(e));
    agent.on('tool_result', (e) => toolResults.push(e));

    (llmChatStream as any)
      .mockResolvedValueOnce({
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'echo', arguments: '{"message":"world"}' },
          },
        ],
        finish_reason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: 'Result received',
        finish_reason: 'stop',
      });

    const result = await agent.run('call echo', mockConfig);

    expect(result).toBe('Result received');
    expect(toolCalls).toContainEqual({ name: 'echo', args: { message: 'world' } });
    expect(toolResults).toContainEqual({ name: 'echo', result: 'echo: world' });
  });

  it('runs a single-turn assistant response', async () => {
    (llmChatStream as any).mockResolvedValue({
      content: 'Hello!',
      finish_reason: 'stop',
    });

    const result = await agent.run('hi', mockConfig);

    expect(result).toBe('Hello!');
    expect(agent.getLastSessionId()).not.toBeNull();
  });

  it('handles unknown tool gracefully', async () => {
    (llmChatStream as any)
      .mockResolvedValueOnce({
        content: '',
        tool_calls: [
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'nonexistent', arguments: '{}' },
          },
        ],
        finish_reason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: 'Tool not found',
        finish_reason: 'stop',
      });

    const result = await agent.run('bad tool', mockConfig);
    expect(result).toBe('Tool not found');
  });

  it('resumes a session and preserves history', async () => {
    (llmChatStream as any).mockResolvedValue({
      content: 'Follow-up',
      finish_reason: 'stop',
    });

    const sessionId = 'sess-123';
    const existingMessages: Message[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
    ];

    await memory.saveSession({
      id: sessionId,
      title: 'Test session',
      messages: existingMessages,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await agent.run('second question', mockConfig, sessionId);

    expect(result).toBe('Follow-up');
    expect(agent.getLastSessionId()).toBe(sessionId);

    const saved = await memory.getSession(sessionId);
    // System prompt gets refreshed, so we have system + 2 user + 2 assistant messages
    expect(saved?.messages.length).toBeGreaterThanOrEqual(4);
  });

  it('respects max turns limit', async () => {
    (llmChatStream as any).mockResolvedValue({
      content: '',
      tool_calls: [
        {
          id: 'call_x',
          type: 'function',
          function: { name: 'echo', arguments: '{"message":"loop"}' },
        },
      ],
      finish_reason: 'tool_calls',
    });

    const result = await agent.run('loop forever', { ...mockConfig, maxTurns: 2 });

    expect(result).toContain('Max turns');
  });

  it('emits abort event and stops early', async () => {
    const controller = new AbortController();
    (llmChatStream as any).mockImplementation(async (opts: any) => {
      if (opts.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          opts.signal?.removeEventListener?.('abort', onAbort);
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        };
        opts.signal?.addEventListener?.('abort', onAbort);
      });
    });

    const runPromise = agent.run('hang', mockConfig);
    agent.abort();

    await expect(runPromise).resolves.toContain('Aborted');
  });
});
