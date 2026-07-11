// ============================================================
// vibeAgentGo — Browser Agent Loop (no server, direct LLM calls)
// ============================================================

import type { Message, Tool, ToolContext, LLMResponse, AgentConfig, ChatAttachment } from '../types/index.js';
import { isTextContentPart } from '../types/index.js';
import { llmChatStream } from './llm_client.js';
import { buildSystemPrompt, toolsToSchemas, loadSkills, type PromptContext } from './prompt_builder.js';
import { MemoryStore } from './memory.js';
import { randomUUID } from './uuid.js';
import { filterSkillsByTrigger } from './skill_parser.js';
import { validateArgs } from '../utils/schema_validate.js';
import { logger, readLogs } from './logger.js';
import { captureFunctionError } from './global_errors.js';

export interface AgentEventMap {
  message: { role: string; content: string };
  stream_delta: { delta: string };
  tool_call: { name: string; args: Record<string, unknown> };
  tool_result: { name: string; result: string };
  render_view: { title: string; html: string };
  error: { message: string };
  turn: { turn: number; total: number };
  done: { sessionId: string };
  session_saved: { sessionId: string };
  abort: Record<string, never>;
}

type EventHandler<K extends keyof AgentEventMap> = (data: AgentEventMap[K]) => void;

export interface AgentOptions {
  onRenderView?: (event: { title: string; html: string }) => void;
  extraEnv?: Record<string, unknown>;
}

export class Agent {
  private tools: Tool[];
  private memory: MemoryStore;
  private extraEnv: Record<string, any>;
  private onRenderView?: (event: { title: string; html: string }) => void;
  private sessionId: string | null = null;
  private listeners: Partial<Record<keyof AgentEventMap, ((data: unknown) => void)[]>> = {};
  private abortController: AbortController | null = null;
  private currentHistory: Message[] = [];
  private currentRunSessionId: string | null = null;

  constructor(tools: Tool[], memory: MemoryStore, opts: AgentOptions = {}) {
    this.tools = tools;
    this.memory = memory;
    this.extraEnv = opts.extraEnv ?? {};
    this.onRenderView = opts.onRenderView;
    if (this.onRenderView) {
      this.on('render_view', (event) => this.onRenderView!(event));
    }
  }

  on<K extends keyof AgentEventMap>(event: K, handler: EventHandler<K>): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event]!.push(handler as (data: unknown) => void);
  }

  off<K extends keyof AgentEventMap>(event: K, handler: EventHandler<K>): void {
    const handlers = this.listeners[event];
    if (handlers) {
      this.listeners[event] = handlers.filter((h) => h !== (handler as (data: unknown) => void));
    }
  }

  private emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
    const handlers = this.listeners[event];
    if (handlers) handlers.forEach((h) => (h as EventHandler<K>)(data));
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.emit('abort', {});
    }
  }

  getLastSessionId(): string | null {
    return this.sessionId;
  }

  private buildToolContext(): ToolContext {
    return {
      workspace: 'indexeddb://workspace',
      emit: (event, data) => this.emit(event as keyof AgentEventMap, data as AgentEventMap[keyof AgentEventMap]),
      env: {
        memoryStore: this.memory,
        isDark: document.documentElement.getAttribute('data-theme') !== 'light',
        ...this.extraEnv,
      },
    };
  }

  async run(
    userMessage: string,
    config: AgentConfig,
    sessionId?: string,
    attachments: ChatAttachment[] = []
  ): Promise<string> {
    this.sessionId = sessionId || this.sessionId || null;
    this.abortController = new AbortController();
    const runSessionId = this.sessionId;
    const controller = this.abortController;

    logger.info('agent.run', 'Starting agent run', {
      sessionId: runSessionId,
      hasSession: !!sessionId,
      model: config.model,
      baseUrl: config.baseUrl,
      attachmentCount: attachments.length,
    });

    try {
      return await this._runInner(userMessage, config, runSessionId, attachments, controller);
    } catch (e) {
      const friendly =
        e instanceof Error && e.name === 'AbortError' ? 'Request aborted' : e instanceof Error ? e.message : String(e);

      captureFunctionError('agent.run', e, {
        sessionId: runSessionId,
        model: config.model,
        baseUrl: config.baseUrl,
      });
      this.emit('error', { message: friendly });
      // Ensure UI is unlocked even when the run failed hard
      this.emit('done', { sessionId: runSessionId || 'unknown' });
      return `Error: ${friendly}`;
    }
  }

  private async _runInner(
    userMessage: string,
    config: AgentConfig,
    runSessionId: string | null,
    attachments: ChatAttachment[],
    controller: AbortController
  ): Promise<string> {
    this.currentRunSessionId = runSessionId;
    this.currentHistory = [];

    try {
      return await this._runInnerCore(userMessage, config, runSessionId, attachments, controller);
    } finally {
      this.currentRunSessionId = null;
      this.currentHistory = [];
    }
  }

  private async _runInnerCore(
    userMessage: string,
    config: AgentConfig,
    runSessionId: string | null,
    attachments: ChatAttachment[],
    controller: AbortController
  ): Promise<string> {
    // Save text files and PDFs into workspace so the agent can read them with read_file / read_pdf
    for (const a of attachments) {
      if (a.type === 'text' || a.type === 'pdf') {
        try {
          await this.memory.writeFile(a.name, a.content);
          logger.info('agent.workspace', `Saved attachment ${a.name}`, {
            sessionId: runSessionId,
            type: a.type,
          });
        } catch (e) {
          logger.warn('agent.workspace', `Failed to save attachment ${a.name}`, {
            sessionId: runSessionId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // Load existing session messages if resuming
    let sessionMessages: Message[] | undefined;
    if (this.sessionId) {
      try {
        const existing = await this.memory.getSession(this.sessionId);
        if (existing) {
          sessionMessages = existing.messages;
          logger.info('agent.resume', `Loaded ${existing.messages.length} messages`, {
            sessionId: this.sessionId,
          });
        } else {
          logger.warn('agent.resume', `Session ${this.sessionId} not found — starting with empty history`, {
            sessionId: this.sessionId,
          });
        }
      } catch (e) {
        logger.error('agent.resume', `Failed to load session ${this.sessionId}`, {
          error: e instanceof Error ? e.message : String(e),
        });
        // Continue with a fresh history rather than failing
      }
    }

    // Load memory and skills
    let memories: import('../types/index.js').MemoryEntry[] = [];
    let profile: import('../types/index.js').MemoryEntry[] = [];
    try {
      const all = await this.memory.getAllMemory();
      memories = all.memories;
      profile = all.profile;
    } catch (e) {
      logger.error('agent.memory', 'Failed to load memory for run', {
        sessionId: runSessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    let skills: import('../types/index.js').Skill[] = [];
    try {
      const allSkills = await loadSkills();
      skills = filterSkillsByTrigger(allSkills, userMessage, true);
    } catch (e) {
      logger.error('agent.skills', 'Failed to load skills', {
        sessionId: runSessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Build the user message content parts
    const userContentParts: Message['content'] = [];
    if (userMessage.trim()) {
      userContentParts.push({ type: 'text', text: userMessage.trim() });
    }
    if (attachments.length > 0) {
      const fileParts = attachments
        .filter((a) => a.type === 'text' || a.type === 'pdf')
        .map((a) => `File attached: ${a.name} (saved to workspace). Use read_file or read_pdf to read it.`);
      if (fileParts.length) {
        userContentParts.push({ type: 'text', text: fileParts.join('\n') });
      }
      const imageParts = attachments
        .filter((a) => a.type === 'image')
        .map((a) => ({ type: 'image_url' as const, image_url: { url: a.content } }));
      userContentParts.push(...imageParts);
    }
    const finalUserContent =
      userContentParts.length === 1 && userContentParts[0].type === 'text'
        ? userContentParts[0].text
        : userContentParts;

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
    history.push({ role: 'user', content: finalUserContent });
    this.currentHistory = history;

    const toolSchemas = toolsToSchemas(this.tools);
    const ctx = this.buildToolContext();

    for (let turn = 0; turn < config.maxTurns; turn++) {
      this.emit('turn', { turn: turn + 1, total: config.maxTurns });
      logger.debug('agent.turn', `Turn ${turn + 1}/${config.maxTurns}`, { sessionId: runSessionId });

      let response: LLMResponse;
      try {
        response = await llmChatStream({
          messages: history,
          tools: toolSchemas,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          onDelta: (delta) => this.emit('stream_delta', { delta }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          this.emit('error', { message: 'Request aborted' });
          return 'Aborted';
        }
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error('agent.llm', `LLM request failed on turn ${turn + 1}: ${errMsg}`, {
          sessionId: runSessionId,
          turn: turn + 1,
          model: config.model,
          baseUrl: config.baseUrl,
        });
        this.emit('error', { message: errMsg });
        // Save what we have so the user can inspect / retry in the same session
        await this.saveCurrentSession(history, runSessionId);
        return `Error during LLM request: ${errMsg}`;
      }

      // Tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Sanitize tool_call arguments before pushing to history.
        // Some models (e.g. Ollama Minimax M3) generate non-JSON arguments
        // (e.g. bare strings like "path" or empty strings). If we push those
        // into history as-is, the provider rejects its own history on the
        // next turn with HTTP 400 "invalid tool call arguments".
        const sanitizedToolCalls = response.tool_calls.map((tc) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }
          return {
            ...tc,
            function: {
              ...tc.function,
              arguments: JSON.stringify(args), // always valid JSON in history
            },
          };
        });

        const assistantMsg: Message = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: sanitizedToolCalls,
        };
        history.push(assistantMsg);
        this.currentHistory = history;

        for (const tc of sanitizedToolCalls) {
          const toolName = tc.function.name;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch (parseErr) {
            logger.error('agent.tool.parse', `Failed to parse args for ${toolName}`, {
              sessionId: runSessionId,
              arguments: tc.function.arguments,
              error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            });
            args = {};
          }

          this.emit('tool_call', { name: toolName, args });

          // Audit log: record the tool call BEFORE execution, so if the tool
          // crashes the tab, error_log shows exactly what was called with
          // what args — even if the result is never written back.
          logger.info('agent.tool.call', `→ ${toolName}`, {
            sessionId: runSessionId,
            tool: toolName,
            args: JSON.stringify(args).slice(0, 500),
          });

          // Checkpoint: save the session before executing the tool, so if the
          // tool crashes the browser tab (e.g. infinite loop in a Worker), the
          // conversation history is already persisted and can be resumed.
          await this.saveCurrentSession(history, runSessionId);

          let result: string;
          const toolStart = Date.now();
          try {
            result = await this.dispatchToolByName(toolName, args, ctx);
          } catch (e) {
            result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
            logger.error('agent.tool.dispatch', `Tool ${toolName} failed`, {
              sessionId: runSessionId,
              tool: toolName,
              error: e instanceof Error ? e.message : String(e),
              stack: e instanceof Error ? e.stack : undefined,
            });
          }

          // Audit log: record the tool result AFTER execution, with duration.
          // Truncate to 500 chars to avoid flooding the log with large outputs.
          const durationMs = Date.now() - toolStart;
          logger.info('agent.tool.result', `← ${toolName} (${durationMs}ms)`, {
            sessionId: runSessionId,
            tool: toolName,
            durationMs,
            result: result.slice(0, 500),
            ok: !result.startsWith('Tool error:'),
          });

          this.emit('tool_result', { name: toolName, result });

          history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
          this.currentHistory = history;
          // Checkpoint immediately after each tool result so the result survives a tab crash
          await this.saveCurrentSession(history, runSessionId);
        }

        continue;
      }

      // Final response
      const finalContent = response.content || '';
      this.emit('message', { role: 'assistant', content: finalContent });
      history.push({ role: 'assistant', content: finalContent });
      this.currentHistory = history;

      await this.saveCurrentSession(history, runSessionId);

      this.emit('done', { sessionId: this.sessionId! });

      // Extract durable memories asynchronously for future sessions
      this.extractMemoryFromConversation(history, config).catch(() => {});

      return response.content;
    }

    const msg = `Max turns (${config.maxTurns}) exceeded`;
    logger.warn('agent.maxTurns', msg, { sessionId: runSessionId });
    this.emit('error', { message: msg });
    await this.saveCurrentSession(history, runSessionId);
    return msg;
  }

  private async saveCurrentSession(history: Message[], runSessionId: string | null): Promise<void> {
    try {
      // runSessionId is a const from run() and stays null on the first run.
      // this.sessionId is set after the first save — reuse it so repeated
      // checkpoints within the same run don't create duplicate sessions.
      const id = runSessionId || this.sessionId || randomUUID().slice(0, 8);
      this.sessionId = id;
      const existing = await this.memory.getSession(id);
      const existingTitle = existing?.title;
      const firstUser = history.find((m) => m.role === 'user')?.content;
      const firstUserText =
        typeof firstUser === 'string'
          ? firstUser
          : firstUser
              ?.filter((c) => c.type === 'text')
              .map((c) => (isTextContentPart(c) ? c.text : ''))
              .join(' ');
      await this.memory.saveSession({
        id,
        title: existingTitle || firstUserText?.slice(0, 50) || 'Untitled',
        messages: history,
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      logger.info('agent.session', `Saved session ${id} (${history.length} messages)`, {
        sessionId: id,
      });
      // Notify main.ts immediately so currentSessionId is set before done,
      // preventing a new agent/session from being created on error/abort.
      this.emit('session_saved', { sessionId: id });
    } catch (e) {
      logger.error('agent.session', 'Failed to save session', {
        sessionId: runSessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  getRecentErrors(limit = 20): Promise<import('./logger.js').LogEntry[]> {
    return readLogs({ levels: ['error', 'fatal', 'warn'], limit, sessionId: this.sessionId });
  }

  // Public checkpoint that can be triggered from AppController on page lifecycle events
  // (visibilitychange / pagehide) so the latest tool result is not lost if the tab is
  // background-terminated.
  async saveCheckpoint(): Promise<void> {
    const sessionId = this.currentRunSessionId || this.sessionId;
    const history = this.currentHistory;
    if (!sessionId || history.length === 0) return;
    try {
      logger.debug('agent.checkpoint', 'Lifecycle checkpoint save', { sessionId });
      await this.saveCurrentSession(history, sessionId);
    } catch {
      /* ignore */
    }
  }

  private async dispatchToolByName(name: string, args: unknown, ctx: ToolContext): Promise<string> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) return `Unknown tool: ${name}`;
    const errors = validateArgs(tool.parameters, args);
    if (errors.length > 0) {
      return `Invalid arguments for tool "${name}":\n${errors.map((e) => `- ${e.path}: ${e.message}`).join('\n')}`;
    }
    return tool.handler(args as Record<string, unknown>, ctx);
  }

  private async extractMemoryFromConversation(history: Message[], config: AgentConfig): Promise<void> {
    if (history.length < 2) return;

    const existing = await this.memory.getAllMemory(200);
    const existingEntries = [...existing.memories, ...existing.profile];

    const memoryContext =
      existingEntries.length > 0
        ? `Existing memory (do NOT duplicate these):\n${existingEntries.map((m) => `- ${m.content}`).join('\n')}\n\n`
        : '';

    const extractionMessages: Message[] = [
      {
        role: 'system',
        content: `You are a memory extraction assistant. Your only job is to identify NEW durable facts about the user, their preferences, their environment, or their ongoing work from the conversation below.

${memoryContext}Output JSON only. No markdown, no explanation, no code fences. Use this exact shape:

{"memories": [{"category": "memory" or "user", "content": "declarative fact"}]}

Rules:
- Save facts that would be useful across future sessions and are NOT already in the existing memory above.
- Use "user" category only for facts about the user's identity, role, preferences, or style.
- Use "memory" category for environment facts, conventions, project details, workflows.
- Do NOT save temporary task state, single-session context, or completed work logs.
- Do NOT save generic filler like greetings or the user asking for help.
- If there are no new durable facts, return {"memories": []}.
- Each memory entry should be 1 concise sentence, not longer than 200 characters.`,
      },
      {
        role: 'user',
        content:
          'Conversation:\n\n' +
          history
            .map((m) => {
              const text =
                typeof m.content === 'string'
                  ? m.content
                  : m.content
                      .filter((c) => c.type === 'text')
                      .map((c) => (isTextContentPart(c) ? c.text : ''))
                      .join(' ');
              return `${m.role}: ${text}`;
            })
            .join('\n\n'),
      },
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

        const lower = content
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .trim();
        if (!lower) continue;

        // Reject exact or near-exact duplicates only; avoid substring false positives
        const isDuplicate = existingEntries.some((e) => {
          const existingLower = e.content
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .trim();
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
