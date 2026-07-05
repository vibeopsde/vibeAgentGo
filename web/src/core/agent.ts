// ============================================================
// vibeAgentGo — Browser Agent Loop (no server, direct LLM calls)
// ============================================================

import type { Message, Tool, ToolContext, LLMResponse, AgentConfig } from '../types/index.js';
import { llmChatStream } from './llm_client.js';
import { buildSystemPrompt, toolsToSchemas, loadSkills, type PromptContext } from './prompt_builder.js';
import { MemoryStore } from './memory.js';
import { randomUUID } from './uuid.js';

export interface AgentEventMap {
  'message': { role: string; content: string };
  'stream_delta': { delta: string };
  'tool_call': { name: string; args: any };
  'tool_result': { name: string; result: string };
  'render_view': { title: string; html: string };
  'error': { message: string };
  'turn': { turn: number; total: number };
  'done': { sessionId: string };
  'abort': {};
}

type EventHandler<K extends keyof AgentEventMap> = (data: AgentEventMap[K]) => void;

export class Agent {
  private tools: Tool[];
  private memory: MemoryStore;
  private extraEnv: Record<string, any>;
  private sessionId: string | null = null;
  private listeners: { [K in keyof AgentEventMap]?: EventHandler<K>[] } = {};
  private abortController: AbortController | null = null;

  constructor(tools: Tool[], memory: MemoryStore, extraEnv: Record<string, any> = {}) {
    this.tools = tools;
    this.memory = memory;
    this.extraEnv = extraEnv;
  }

  on<K extends keyof AgentEventMap>(event: K, handler: EventHandler<K>): void {
    if (!this.listeners[event]) this.listeners[event] = [] as any;
    (this.listeners[event] as any[]).push(handler);
  }

  off<K extends keyof AgentEventMap>(event: K, handler: EventHandler<K>): void {
    const handlers = this.listeners[event];
    if (handlers) {
      this.listeners[event] = handlers.filter(h => h !== handler) as any;
    }
  }

  private emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
    const handlers = this.listeners[event];
    if (handlers) handlers.forEach(h => h(data));
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.emit('abort', {});
    }
  }

  private buildToolContext(): ToolContext {
    return {
      workspace: 'indexeddb://workspace',
      emit: (event, data) => this.emit(event as any, data as any),
      env: {
        memoryStore: this.memory,
        ...this.extraEnv,
      },
    };
  }

  async run(
    userMessage: string,
    config: AgentConfig,
    sessionId?: string
  ): Promise<string> {
    this.sessionId = sessionId || this.sessionId || null;
    this.abortController = new AbortController();

    // Load existing session messages if resuming
    let sessionMessages: Message[] | undefined;
    if (this.sessionId) {
      const existing = await this.memory.getSession(this.sessionId);
      if (existing) {
        sessionMessages = existing.messages;
      }
    }

    // Load memory and skills
    const { memories, profile } = await this.memory.getAllMemory();
    const skills = await loadSkills();

    // Build system prompt
    const promptCtx: PromptContext = {
      memories,
      profile,
      skills,
      tools: this.tools,
      language: config.language,
    };
    const systemPrompt = buildSystemPrompt(promptCtx);

    // Build message history
    const history: Message[] = sessionMessages ? [...sessionMessages] : [];
    if (history.length === 0 || history[0].role !== 'system') {
      history.unshift({ role: 'system', content: systemPrompt });
    } else {
      history[0] = { role: 'system', content: systemPrompt };
    }
    history.push({ role: 'user', content: userMessage });

    const toolSchemas = toolsToSchemas(this.tools);
    const ctx = this.buildToolContext();

    for (let turn = 0; turn < config.maxTurns; turn++) {
      this.emit('turn', { turn: turn + 1, total: config.maxTurns });

      let response: LLMResponse;
      try {
        response = await llmChatStream({
          messages: history,
          tools: toolSchemas,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          maxTokens: config.maxTokens,
          onDelta: (delta) => this.emit('stream_delta', { delta }),
          signal: this.abortController.signal,
        });
      } catch (e: any) {
        if (e.name === 'AbortError') {
          this.emit('error', { message: 'Request aborted' });
          return 'Aborted';
        }
        this.emit('error', { message: e.message });
        throw e;
      }

      // Tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        const assistantMsg: Message = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        };
        history.push(assistantMsg);

        for (const tc of response.tool_calls) {
          const toolName = tc.function.name;
          let args: any;
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

          this.emit('tool_call', { name: toolName, args });

          let result: string;
          try {
            result = await this.dispatchToolByName(toolName, args, ctx);
          } catch (e: any) {
            result = `Tool error: ${e.message}`;
          }

          this.emit('tool_result', { name: toolName, result });

          history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        }

        continue;
      }

      // Final response
      const finalContent = response.content || '';
      this.emit('message', { role: 'assistant', content: finalContent });
      history.push({ role: 'assistant', content: finalContent });

      // Save session
      const id = this.sessionId || randomUUID().slice(0, 8);
      this.sessionId = id;
      const existingTitle = (await this.memory.getSession(id))?.title;
      await this.memory.saveSession({
        id,
        title: existingTitle || history.find(m => m.role === 'user')?.content?.slice(0, 50) || 'Untitled',
        messages: history,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      this.emit('done', { sessionId: id });

      // Extract durable memories asynchronously (Hermes-style)
      this.extractMemoryFromConversation(history, config).catch(() => {});

      return response.content;
    }

    const msg = `Max turns (${config.maxTurns}) exceeded`;
    this.emit('error', { message: msg });
    return msg;
  }

  private async dispatchToolByName(name: string, args: any, ctx: ToolContext): Promise<string> {
    const tool = this.tools.find(t => t.name === name);
    if (!tool) return `Unknown tool: ${name}`;
    return tool.handler(args, ctx);
  }

  getLastSessionId(): string | null {
    return this.sessionId;
  }

  private async extractMemoryFromConversation(history: Message[], config: AgentConfig): Promise<void> {
    if (history.length < 2) return;

    const existing = await this.memory.getAllMemory(200);
    const existingEntries = [...existing.memories, ...existing.profile];

    const memoryContext = existingEntries.length > 0
      ? `Existing memory (do NOT duplicate these):\n${existingEntries.map(m => `- ${m.content}`).join('\n')}\n\n`
      : '';

    const extractionMessages: Message[] = [
      { role: 'system', content: `You are a memory extraction assistant. Your only job is to identify NEW durable facts about the user, their preferences, their environment, or their ongoing work from the conversation below.

${memoryContext}Output JSON only. No markdown, no explanation, no code fences. Use this exact shape:

{"memories": [{"category": "memory" or "user", "content": "declarative fact"}]}

Rules:
- Save facts that would be useful across future sessions and are NOT already in the existing memory above.
- Use "user" category only for facts about the user's identity, role, preferences, or style.
- Use "memory" category for environment facts, conventions, project details, workflows.
- Do NOT save temporary task state, single-session context, or completed work logs.
- Do NOT save generic filler like greetings or the user asking for help.
- If there are no new durable facts, return {"memories": []}.
- Each memory entry should be 1 concise sentence, not longer than 200 characters.` },
      { role: 'user', content: 'Conversation:\n\n' + history.map(m => `${m.role}: ${m.content || ''}`).join('\n\n') },
    ];

    try {
      const res = await llmChatStream({
        messages: extractionMessages,
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        onDelta: () => {},
      });

      const raw = res.content?.trim() || '';
      let parsed: any = null;

      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }

      const memories = parsed?.memories;
      if (!Array.isArray(memories) || memories.length === 0) return;

      for (const m of memories) {
        if (!m.content || typeof m.content !== 'string') continue;
        const content = m.content.trim();
        if (content.length < 8 || content.length > 200) continue;

        const lower = content.toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (!lower) continue;

        // Reject exact or near-exact duplicates only; avoid substring false positives
        const isDuplicate = existingEntries.some(e => {
          const existingLower = e.content.toLowerCase().replace(/[^\w\s]/g, '').trim();
          if (!existingLower) return false;
          // Exact match after normalization
          if (existingLower === lower) return true;
          // Avoid adding shorter phrasings of an existing memory
          if (lower.length < existingLower.length && existingLower.includes(lower)) return true;
          // Avoid adding longer rephrasings that add no new information
          const existingWords = existingLower.split(/\s+/).filter(Boolean).sort().join(' ');
          const newWords = lower.split(/\s+/).filter(Boolean).sort().join(' ');
          if (existingWords === newWords) return true;
          return false;
        });

        if (isDuplicate) continue;

        const category = m.category === 'user' ? 'user' : 'memory';
        await this.memory.saveMemory(content, category);
      }
    } catch {
      // Silent: memory extraction should never break the chat flow
    }
  }
}