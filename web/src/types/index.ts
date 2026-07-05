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

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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

// --- Project State ---

export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  depends_on?: string[];
  notes?: string;
}

export interface ProjectIssue {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'closed';
  notes?: string;
}

export interface ProjectLesson {
  id: string;
  note: string;
  created_at: string;
}

export interface ProjectState {
  goal: string;
  current_phase: string;
  tasks: ProjectTask[];
  open_issues: ProjectIssue[];
  lessons_learned: ProjectLesson[];
  files: string[];
  updated_at: string;
}

export const DEFAULT_PROJECT_STATE: ProjectState = {
  goal: '',
  current_phase: 'planning',
  tasks: [],
  open_issues: [],
  lessons_learned: [],
  files: [],
  updated_at: new Date().toISOString(),
};

export const STATE_FILE_PATH = 'agent_state.json';
