// ============================================================
// vibeAgentGo — LLM Client (browser-side, direct fetch + SSE streaming)
// No server proxy — browser calls LLM API directly via CORS
// ============================================================

import type { Message, ToolSchema, LLMResponse, ToolCall } from '../types/index.js';
import { logger } from './logger.js';

const DEFAULT_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('network') || msg.includes('fetch') || msg.includes('timeout');
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
        .sort((a: string, b: string) => a.localeCompare(b))
        .slice(0, 50) || [];
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
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

  logger.debug('llm.request', `Request ${requestId} starting`, {
    model: opts.model,
    baseUrl: opts.baseUrl,
    messageCount: opts.messages.length,
  });

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
    logger.error('llm.request', `Request ${requestId} failed: ${err.message}`, {
      model: opts.model,
      baseUrl: opts.baseUrl,
      status,
    });
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
  let malformedChunks = 0;

  try {
    while (true) {
      let done = false;
      let value: Uint8Array | undefined;
      try {
        const readResult = await reader.read();
        done = readResult.done;
        value = readResult.value;
      } catch (streamErr) {
        const err = streamErr instanceof Error ? streamErr : new Error(String(streamErr));
        logger.error('llm.stream', `Stream read failed for ${requestId}: ${err.message}`, {
          model: opts.model,
        });
        throw new Error(`Stream read failed: ${err.message}`);
      }

      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // SSE lines can have multiple `data:` prefixes in malformed streams
        const dataParts: string[] = [];
        if (trimmed.startsWith('data: ')) {
          dataParts.push(trimmed.slice(6));
        } else if (trimmed.startsWith('data:')) {
          dataParts.push(trimmed.slice(5).trimStart());
        } else if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
          continue;
        } else {
          // Non-data lines (e.g. retry, event) are ignored
          continue;
        }

        for (const data of dataParts) {
          if (data === '[DONE]') continue;
          if (!data) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch (parseErr) {
            malformedChunks++;
            if (malformedChunks <= 3) {
              logger.warn('llm.stream', `Malformed SSE chunk for ${requestId}`, {
                chunk: data.slice(0, 200),
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
              });
            }
            continue;
          }

          const choice = parsed.choices?.[0];
          if (!choice) {
            // Some providers send empty keep-alive chunks; ignore silently
            continue;
          }

          const delta = choice.delta;
          if (!delta) continue;

          if (typeof delta.content === 'string') {
            // Guard against literal 'undefined' or malformed deltas from the provider.
            const text = delta.content === 'undefined' ? '' : delta.content;
            fullContent += text;
            if (text) opts.onDelta?.(text);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallMap.get(idx);
              if (existing) {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.function.name += tc.function.name;
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
            // A tool-calls stream may not set finish_reason on every chunk
            if (choice.finish_reason === 'tool_calls') {
              finishReason = 'tool_calls';
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          // Provider-specific error inside the stream
          if (parsed.error) {
            const errMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
            logger.error('llm.stream', `Provider error in stream for ${requestId}: ${errMsg}`, {
              model: opts.model,
            });
            throw new Error(`Provider error: ${errMsg}`);
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  logger.debug('llm.stream', `Request ${requestId} completed`, {
    model: opts.model,
    contentLength: fullContent.length,
    toolCallCount: toolCallMap.size,
    finishReason,
  });

  const toolCalls: ToolCall[] | undefined =
    toolCallMap.size > 0
      ? Array.from(toolCallMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, tc]) => {
            // Ensure arguments is always valid JSON. Some providers (Ollama
            // with smaller models) emit bare strings or empty arguments.
            let args = tc.function.arguments || '';
            try {
              JSON.parse(args);
            } catch {
              // Try to salvage: if it's a bare string, wrap it as {"value": "..."}
              // Otherwise default to empty object.
              if (args.trim() && !args.startsWith('{') && !args.startsWith('[')) {
                args = JSON.stringify({ value: args.trim() });
              } else {
                args = '{}';
              }
            }
            return {
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: args },
            };
          })
      : undefined;

  return {
    content: fullContent,
    tool_calls: toolCalls?.length ? toolCalls : undefined,
    finish_reason: finishReason as LLMResponse['finish_reason'],
  };
}
