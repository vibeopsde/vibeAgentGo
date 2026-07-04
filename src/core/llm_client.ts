// ============================================================
// HAG — LLM Client (OpenAI-compatible)
// ============================================================

import type { Message, ToolSchema, LLMResponse, ToolCall } from '../types/index.js';

let callCount = 0;

export async function llmChat(opts: {
  messages: Message[];
  tools?: ToolSchema[];
  model: string;
  baseUrl: string;
  apiKey: string;
}): Promise<LLMResponse> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
  callCount++;

  const body: any = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
  };

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }

  if (process.env.HAG_DEBUG) {
    console.error(`[LLM] #${callCount} → ${opts.model} (${opts.messages.length} msgs, ${opts.tools?.length || 0} tools)`);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('LLM returned no choices');
  }

  const msg = choice.message;
  const tool_calls: ToolCall[] | undefined = msg.tool_calls?.map((tc: any) => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));

  return {
    content: msg.content || '',
    tool_calls: tool_calls?.length ? tool_calls : undefined,
    finish_reason: choice.finish_reason || 'stop',
  };
}