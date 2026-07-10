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
  writeFileBinary(path: string, data: Uint8Array): Promise<void>;
  readFileBinary(path: string): Promise<Uint8Array | null>;
  listFiles(): Promise<{ path: string; content: string }[]>;
  listFilePaths(): Promise<string[]>;
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

// --- Bridge (ProgramApp iframe) ---

export type BridgeRequest =
  | { type: 'readFile'; path: string }
  | { type: 'writeFile'; path: string; content: string }
  | { type: 'readFileBinary'; path: string }
  | { type: 'writeFileBinary'; path: string; data: number[] }
  | { type: 'deleteFile'; path: string }
  | { type: 'listFiles' }
  | { type: 'getMemory'; query: string; category?: string; limit?: number }
  | { type: 'getConfig' }
  | { type: 'sendMessage'; text: string };

export interface BridgeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// --- App / Window Manager ---

export interface App {
  id: string;
  title: string;
  icon: string;
  /** Root element of the app; will be moved into a window/space by the WM. */
  element: HTMLElement;
  /** Called when the app is mounted into a new window/space. */
  mount(container: HTMLElement): void;
  /** Optional: called when the app's window receives focus. */
  onFocus?(): void;
  /** Optional: called when the app's window loses focus. */
  onBlur?(): void;
  /** Optional: called when the window is closed. Return false to prevent closing. */
  onClose?(): boolean | Promise<boolean>;
}

export interface AppWindow {
  id: string;
  appId: string;
  title: string;
  icon: string;
  element: HTMLElement; // the window card / space element
  contentEl: HTMLElement; // the area where the app.element lives
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  restoreBounds?: { x: number; y: number; width: number; height: number };
}

export type AppFactory = () => App;

export interface OpenWindowOptions {
  appId: string;
  title?: string;
  data?: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WindowManagerEventMap {
  'window_opened': { windowId: string; appId: string };
  'window_closed': { windowId: string; appId: string };
  'window_focused': { windowId: string; appId: string };
  'app_launched': { appId: string; windowId: string };
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
