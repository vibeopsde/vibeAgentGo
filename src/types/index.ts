// ============================================================
// HAG — Hermes Agent Go — Core Types
// ============================================================

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface Message {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // for role: 'tool'
  name?: string; // tool name for role: 'tool'
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  finish_reason: 'stop' | 'tool_calls' | 'length';
}

export interface AgentConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  maxTurns: number;
  workspace: string;
  systemPromptExtra?: string;
}

export interface ToolContext {
  workspace: string;
  emit: (event: string, data: any) => void;
  env: Record<string, string>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolSchema['function']['parameters'];
  handler: (args: any, ctx: ToolContext) => Promise<string>;
}

// --- Memory ---

export interface MemoryEntry {
  id: number;
  content: string;
  category: 'memory' | 'user';
  created_at: string;
}

// --- Render View ---

export interface RenderViewEvent {
  title: string;
  html: string;
}

// --- Session ---

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

// --- Skills ---

export interface Skill {
  name: string;
  description: string;
  content: string;
  trigger?: string[];
}