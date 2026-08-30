// ============================================================
// vibeAgentGo — Tool shared helpers
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { ToolContext } from '../../types/index.js';
import { MemoryStore } from '../memory.js';

// --- Helpers ---

export const getMemoryStore = (ctx: ToolContext): MemoryStore => ctx.env.memoryStore!;

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v)) : [];
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : [];
}

// --- Path safety (defense against path traversal in workspace I/O) ---
// The workspace is a key-value store keyed by a relative path string; any
// path that escapes the set of normalised relative segments (e.g. `..`,
// absolute paths, backslashes, control/bidi chars) can point outside the
// intended location. All tool handlers that read/write files derived from
// external or LLM-controlled input MUST validate through these helpers.

// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI_RE = /[\x00-\x1f\x7f\u202a-\u202e]/;

/**
 * True if `path` is a safe relative workspace path:
 * non-empty, no control/bidi characters, no backslash separators,
 * not absolute (POSIX leading `/` or Windows drive `C:\`), and no
 * `..` / `.` / empty path segments (which would enable traversal or
 * malformed keys). Legit paths like `apps/tools/xyz/index.html` pass.
 */
export function isSafeRelPath(path: unknown): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (CONTROL_OR_BIDI_RE.test(path)) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split('/');
  if (segments.length === 0) return false;
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}

/** Strict whitelist for app ids (lowercase alphanumeric segments). */
export const APP_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export function isValidAppId(id: unknown): boolean {
  return typeof id === 'string' && APP_ID_RE.test(id);
}

/** Allowed vAG-App Store categories (single source of truth). */
export const ALLOWED_APP_CATEGORIES = ['Productivity', 'Utilities', 'Development', 'Creative', 'Games', 'System'];

export function isValidAppCategory(category: unknown): boolean {
  if (typeof category !== 'string' || category.length === 0) return false;
  if (CONTROL_OR_BIDI_RE.test(category)) return false;
  return ALLOWED_APP_CATEGORIES.includes(category);
}

/** A bare repository-root folder name: no separators, no traversal. */
export function isValidRepoRoot(root: unknown): boolean {
  if (typeof root !== 'string' || root.length === 0) return false;
  if (CONTROL_OR_BIDI_RE.test(root)) return false;
  if (root === '.' || root === '..') return false;
  return /^[a-zA-Z0-9._-]+$/.test(root);
}

// --- File Tools (IndexedDB workspace) ---
