// ============================================================
// vibeAgentGo — Shared TypeScript Types (browser PWA)
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
  content: string | MessageContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string; // for role: 'tool'
}

export type MessageContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatAttachment {
  name: string;
  type: 'image' | 'text' | 'pdf' | 'binary';
  content: string; // base64 data URL for images/pdf; text for text files
  size: number;
  mime: string;
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
  language: 'de' | 'en';
}

export interface ToolContext {
  workspace: string;
  emit: (event: string, data: Record<string, unknown>) => void;
  env: {
    memoryStore?: MemoryStore;
    isDark?: boolean;
    [key: string]: unknown;
  };
}

export interface MemoryStore {
  saveMemory(content: string, category?: string): Promise<number>;
  getMemories(limit?: number): Promise<MemoryEntry[]>;
  getUserProfile(): Promise<MemoryEntry[]>;
  getAllMemory(limit?: number): Promise<{ memories: MemoryEntry[]; profile: MemoryEntry[] }>;
  searchAllMemory(limit?: number): Promise<MemoryEntry[]>;
  deleteMemory(id: number): Promise<boolean>;
  saveSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  listSessions(): Promise<{ id: string; title: string; created_at: string; updated_at: string }[]>;
  deleteSession(id: string): Promise<boolean>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  listFiles(): Promise<{ path: string; content: string }[]>;
  deleteFile(path: string): Promise<boolean>;
  searchFiles(pattern: string, target?: 'files' | 'content'): Promise<string[]>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolSchema['function']['parameters'];
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export function isTextContentPart(part: MessageContentPart): part is { type: 'text'; text: string } {
  return part.type === 'text' && typeof (part as { text?: string }).text === 'string';
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

// --- Project State ---
// Removed: agent_state.json scratchpad was dropped to keep workspace simple.
