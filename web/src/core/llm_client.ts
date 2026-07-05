// ============================================================
// vibeAgentGo — LLM Client (browser-side, direct fetch + SSE streaming)
// No server proxy — browser calls LLM API directly via CORS
// ============================================================

import type { Message, ToolSchema, LLMResponse, ToolCall } from '../types/index.js';

const DEFAULT_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort') === false
    );
  }
  return false;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = DEFAULT_RETRIES,
  backoffMs = INITIAL_BACKOFF_MS
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) {
        return res;
      }
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      lastError = new Error(`HTTP ${res.status}: ${text}`);
      if (!isRetryableStatus(res.status) || attempt === retries) {
        throw lastError;
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw e;
      }
      const err = e instanceof Error ? e : new Error(String(e));
      if (lastError === undefined) {
        lastError = err;
      }
      if (!isRetryableError(err) || attempt === retries) {
        throw lastError;
      }
    }
    const jitter = Math.floor(Math.random() * 100);
    await sleep(backoffMs * 2 ** attempt + jitter);
  }
  throw lastError || new Error('LLM request failed after retries');
}

export async function testConnection(config: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const url = `${config.baseUrl.trim().replace(/\/$/, '')}/models`;
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  try {
    const res = await fetchWithRetry(url, { headers });
    const data = await res.json();
    const models =
      data.data
        ?.map((m: { id?: string }) => m.id)
        .filter((id: string | undefined): id is string => typeof id === 'string')
        .slice(0, 20) || [];
    return { ok: true, models };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { ok: false, error: err.message || String(e) };
  }
}

export async function llmChatStream(opts: {
  messages: Message[];
  tools?: ToolSchema[];
  model: string;
  baseUrl: string;
  apiKey: string;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<LLMResponse> {
  const url = `${opts.baseUrl.trim().replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages.map((m) => ({
      ...m,
      // Some providers accept null, but OpenAI-compatible servers generally prefer empty string
      content: typeof m.content === 'string' && !m.content ? '' : m.content,
    })),
    stream: true,
  };

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  }).catch((e) => {
    const err = e instanceof Error ? e : new Error(String(e));
    const statusMatch = /HTTP (\d+)/.exec(err.message);
    const status = statusMatch ? statusMatch[1] : 'unknown';
    throw new Error(`LLM API error ${status}: ${err.message}`);
  });

  if (!res.body) {
    throw new Error('No response body for streaming');
  }

  // Parse SSE stream in browser
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let finishReason = 'stop';
  const toolCallMap = new Map<number, { id: string; function: { name: string; arguments: string } }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (typeof delta?.content === 'string') {
            // Guard against literal 'undefined' or malformed deltas from the provider.
            const text = delta.content === 'undefined' ? '' : delta.content;
            fullContent += text;
            if (text) opts.onDelta?.(text);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallMap.get(idx);
              if (existing) {
                if (tc.function?.arguments) {
                  existing.function.arguments += tc.function.arguments;
                }
              } else {
                toolCallMap.set(idx, {
                  id: tc.id || `call_${idx}_${Date.now()}`,
                  function: {
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  },
                });
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        } catch {
          /* skip */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ToolCall[] | undefined =
    toolCallMap.size > 0
      ? Array.from(toolCallMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, tc]) => ({
            id: tc.id,
            type: 'function' as const,
            function: tc.function,
          }))
      : undefined;

  return {
    content: fullContent,
    tool_calls: toolCalls?.length ? toolCalls : undefined,
    finish_reason: finishReason as LLMResponse['finish_reason'],
  };
}
