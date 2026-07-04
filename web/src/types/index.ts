// ============================================================
// HAG — Shared TypeScript Types (browser PWA)
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
}

export interface ToolContext {
  workspace: string;
  emit: (event: string, data: any) => void;
  env: Record<string, any>; // tools may receive memoryStore or other runtime deps
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
