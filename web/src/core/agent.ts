// ============================================================
// HAG — Browser Agent Loop (no server, direct LLM calls)
// ============================================================

import type { Message, Tool, ToolContext, LLMResponse, AgentConfig } from '../types/index.js';
import { llmChatStream } from './llm_client.js';
import { buildSystemPrompt, toolsToSchemas, loadSkills, type PromptContext } from './prompt_builder.js';
import type { MemoryStore } from './memory.js';
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
}

type EventHandler<K extends keyof AgentEventMap> = (data: AgentEventMap[K]) => void;

export class Agent {
  private tools: Tool[];
  private memory: MemoryStore;
  private sessionId: string | null = null;
  private listeners: { [K in keyof AgentEventMap]?: EventHandler<K>[] } = {};
  private abortController: AbortController | null = null;

  constructor(tools: Tool[], memory: MemoryStore) {
    this.tools = tools;
    this.memory = memory;
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
    }
  }

  private buildToolContext(): ToolContext {
    return {
      workspace: 'indexeddb://workspace',
      emit: (event, data) => this.emit(event as any, data as any),
      env: {
        __memoryStore: this.memory as any,
      } as any,
    };
  }

  async run(
    userMessage: string,
    config: AgentConfig,
    sessionMessages?: Message[],
    sessionId?: string
  ): Promise<string> {
    this.sessionId = sessionId || null;
    this.abortController = new AbortController();

    // Load memory and skills
    const { memories, profile } = await this.memory.getAllMemory();
    const skills = await loadSkills();

    // Build system prompt
    const promptCtx: PromptContext = {
      memories,
      profile,
      skills,
      tools: this.tools,
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
        this.emit('message', { role: 'assistant', content: response.content || '(calling tools...)' });

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
      this.emit('message', { role: 'assistant', content: response.content || '' });
      history.push({ role: 'assistant', content: response.content });

      // Save session
      const id = this.sessionId || randomUUID().slice(0, 8);
      this.sessionId = id;
      await this.memory.saveSession({
        id,
        title: history.find(m => m.role === 'user')?.content?.slice(0, 50) || 'Untitled',
        messages: history,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      this.emit('done', { sessionId: id });
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
}