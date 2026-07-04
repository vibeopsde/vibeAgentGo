// ============================================================
// HAG — Agent Loop
// ============================================================

import type { Message, Tool, ToolContext, AgentConfig, LLMResponse } from '../types/index.js';
import { llmChat } from './llm_client.js';
import { buildSystemPrompt, toolsToSchemas, loadSkills, type PromptContext } from './prompt_builder.js';
import type { MemoryStore } from './memory.js';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface AgentEventMap {
  'message': { role: string; content: string };
  'tool_call': { name: string; args: any };
  'tool_result': { name: string; result: string };
  'render_view': { title: string; html: string };
  'error': { message: string };
  'turn': { turn: number; total: number };
}

type EventHandler<K extends keyof AgentEventMap> = (data: AgentEventMap[K]) => void;

export class Agent {
  private config: AgentConfig;
  private tools: Tool[];
  private memory: MemoryStore;
  private listeners: { [K in keyof AgentEventMap]?: EventHandler<K>[] } = {};

  constructor(config: AgentConfig, tools: Tool[], memory: MemoryStore) {
    this.config = config;
    this.tools = tools;
    this.memory = memory;
  }

  on<K extends keyof AgentEventMap>(event: K, handler: EventHandler<K>): void {
    if (!this.listeners[event]) this.listeners[event] = [] as any;
    (this.listeners[event] as any[]).push(handler);
  }

  private emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
    const handlers = this.listeners[event];
    if (handlers) handlers.forEach(h => h(data));
  }

  private buildToolContext(): ToolContext {
    return {
      workspace: this.config.workspace,
      emit: (event, data) => this.emit(event as any, data as any),
      env: {
        __memorySave: (content: string, category: 'memory' | 'user'): number =>
          this.memory.saveMemory(content, category),
      } as any,
    };
  }

  async run(userMessage: string, sessionMessages?: Message[]): Promise<string> {
    // Load memory and skills
    const { memories, profile } = this.memory.getAllMemory();
    const skills = loadSkills(join(this.config.workspace, 'skills'));

    // Build system prompt
    const promptCtx: PromptContext = {
      workspace: this.config.workspace,
      memories,
      profile,
      skills,
      tools: this.tools,
      extra: this.config.systemPromptExtra,
    };
    const systemPrompt = buildSystemPrompt(promptCtx);

    // Build message history
    const history: Message[] = sessionMessages || [];
    if (history.length === 0 || history[0].role !== 'system') {
      history.unshift({ role: 'system', content: systemPrompt });
    } else {
      // Update system prompt if it exists
      history[0] = { role: 'system', content: systemPrompt };
    }
    history.push({ role: 'user', content: userMessage });

    const toolSchemas = toolsToSchemas(this.tools);
    const ctx = this.buildToolContext();

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      this.emit('turn', { turn: turn + 1, total: this.config.maxTurns });

      let response: LLMResponse;
      try {
        response = await llmChat({
          messages: history,
          tools: toolSchemas,
          model: this.config.model,
          baseUrl: this.config.baseUrl,
          apiKey: this.config.apiKey,
        });
      } catch (e: any) {
        this.emit('error', { message: e.message });
        throw e;
      }

      // If tool calls, dispatch and continue
      if (response.tool_calls && response.tool_calls.length > 0) {
        const assistantMsg: Message = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        };
        history.push(assistantMsg);
        this.emit('message', { role: 'assistant', content: response.content || '(calling tools...)' });

        // Dispatch each tool call
        for (const tc of response.tool_calls) {
          const toolName = tc.function.name;
          let args: any;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }

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
            name: toolName,
            content: result,
          });
        }

        continue; // Next turn — LLM sees tool results
      }

      // No tool calls — final response
      this.emit('message', { role: 'assistant', content: response.content });

      // Save session
      this.saveSession(history);

      return response.content;
    }

    const msg = `Max turns (${this.config.maxTurns}) exceeded`;
    this.emit('error', { message: msg });
    this.saveSession(history);
    return msg;
  }

  private async dispatchToolByName(name: string, args: any, ctx: ToolContext): Promise<string> {
    const tool = this.tools.find(t => t.name === name);
    if (!tool) return `Unknown tool: ${name}`;
    return tool.handler(args, ctx);
  }

  private saveSession(messages: Message[]) {
    const id = randomUUID().slice(0, 8);
    const title = messages.find(m => m.role === 'user')?.content?.slice(0, 50) || 'Untitled';
    this.memory.saveSession({
      id,
      title,
      messages,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}