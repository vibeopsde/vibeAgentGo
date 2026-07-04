// ============================================================
// HAG — LLM Client (browser-side, direct fetch + SSE streaming)
// No server proxy — browser calls LLM API directly via CORS
// ============================================================

import type { Message, ToolSchema, LLMResponse, ToolCall } from '../../../src/types/index.js';

export async function llmChatStream(opts: {
  messages: Message[];
  tools?: ToolSchema[];
  model: string;
  baseUrl: string;
  apiKey: string;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<LLMResponse> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body: any = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  };

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

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

          if (delta?.content) {
            fullContent += delta.content;
            opts.onDelta?.(delta.content);
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
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ToolCall[] | undefined = toolCallMap.size > 0
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