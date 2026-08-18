// ============================================================
// vibeAgentGo — File tools
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import type { MemoryStore } from '../memory.js';
import { getMemoryStore, asString, asNumber, asBoolean } from './shared.js';
import { corsFetch } from '../cors_fetch.js';

export const read_file: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a text file from the browser workspace (IndexedDB). Returns the file content as a string. Use offset (1-indexed line number to start from) and limit (max lines to read) for large files. Lines are prefixed with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
      offset: { type: 'number', description: 'Line number to start reading from (1-indexed). Default: 1' },
      limit: { type: 'number', description: 'Maximum number of lines to read. Default: all lines' },
    },
    required: ['path'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const path = asString(args.path);
    const content = await mem.readFile(path);
    if (content === null) return `File not found: ${path}`;

    const MAX_CHARS = 8000;
    const DEFAULT_LIMIT = 200;
    const offset = Math.max(1, asNumber(args.offset, 1));
    const limit = asNumber(args.limit, 0);
    const effectiveLimit = limit > 0 ? limit : DEFAULT_LIMIT;

    const lines = content.split('\n');
    const totalLines = lines.length;
    const start = Math.max(0, offset - 1);
    const requestedEnd = start + effectiveLimit;
    const slice = lines.slice(start, requestedEnd);

    let numbered = slice.map((line, i) => `${start + i + 1}|${line}`).join('\n');

    // Truncate at character level if still too large for a single LLM message.
    let truncated = false;
    if (numbered.length > MAX_CHARS) {
      numbered = numbered.slice(0, MAX_CHARS) + '\n... (truncated)';
      truncated = true;
    }

    const shownTo = Math.min(requestedEnd, totalLines);
    const shownFrom = start + 1;
    const truncationNote = truncated ? ' — truncated to fit model context' : '';
    return `${numbered}\n\n(shown ${shownFrom}-${shownTo} of ${totalLines} lines${truncationNote})`;
  },
};

export const read_pdf: Tool = {
  name: 'read_pdf',
  description:
    'Extract text content from a PDF file in the browser workspace (IndexedDB). Returns the extracted text. If the PDF is a scanned image, text extraction may be limited.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the PDF file within the workspace' },
    },
    required: ['path'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const path = asString(args.path);
    const content = await mem.readFile(path);
    if (content === null) return `File not found: ${path}`;
    try {
      const pdfjs = await import('pdfjs-dist');
      const pdfjsLib = pdfjs.default || pdfjs;
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
      }
      const base64 = content.startsWith('data:') ? content.split(',')[1] : content;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const contentItems = await page.getTextContent();
        const pageText = contentItems.items.map((item) => (item as { str: string }).str).join(' ');
        text += `\n\n--- Page ${i} ---\n\n${pageText}`;
      }
      return text.trim() || 'No text found in PDF.';
    } catch (e) {
      return `PDF extraction error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

export const write_file: Tool = {
  name: 'write_file',
  description: 'Write content to a file in the browser workspace (IndexedDB). Overwrites existing files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
      content: { type: 'string', description: 'The content to write' },
    },
    required: ['path', 'content'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    await mem.writeFile(asString(args.path), asString(args.content));
    return `Wrote ${asString(args.content).length} bytes to ${asString(args.path)}`;
  },
};

export const search_files: Tool = {
  name: 'search_files',
  description:
    'Search for files by name or content within the browser workspace. Returns matching file paths or lines containing the pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (filename or text to search for)' },
      target: {
        type: 'string',
        enum: ['files', 'content'],
        description: 'Search filenames (files) or file contents (content). Default: files',
      },
    },
    required: ['pattern'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const target = asString(args.target, 'files');
    const results = await mem.searchFiles(asString(args.pattern), target as 'files' | 'content');
    const MAX_RESULTS = 50;
    const shown = results.slice(0, MAX_RESULTS);
    const more = results.length > MAX_RESULTS ? `\n... and ${results.length - MAX_RESULTS} more matches` : '';
    return results.length > 0 ? shown.join('\n') + more : 'No matches found';
  },
};

// --- Patch helpers ---

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function applyReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): { content: string; replacements: number } {
  const occurrences = countOccurrences(content, oldString);
  if (occurrences === 0) {
    throw new Error(`old_string not found in file.`);
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error(
      `old_string is not unique (${occurrences} matches). Use replace_all: true to replace all occurrences, or provide more context to make it unique.`
    );
  }
  const next = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
  return { content: next, replacements: replaceAll ? occurrences : 1 };
}

function tryValidateFileSyntax(path: string, content: string): { ok: boolean; error?: string } {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) {
    try {
      JSON.parse(content);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `JSON syntax error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (lower.endsWith('.js') || lower.endsWith('.ts')) {
    try {
      // Lightweight syntax check: parse as a module-like function body. This catches many but not all TS-specific issues.
      new Function(content);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `JS/TS syntax error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { ok: true };
}

interface PatchHunk {
  context: string[];
  removals: string[];
  additions: string[];
}

interface PatchFile {
  path: string;
  hunks: PatchHunk[];
}

function parseV4APatch(patchText: string): PatchFile[] {
  const files: PatchFile[] = [];
  const blocks = patchText.split('*** Begin Patch').slice(1);
  for (const block of blocks) {
    const endIdx = block.indexOf('*** End Patch');
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const fileMatch = body.match(/\*\*\* Update File:\s*(.+)/);
    if (!fileMatch) continue;
    const path = fileMatch[1].trim();
    const hunks: PatchHunk[] = [];
    const lines = body.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const hunk: PatchHunk = { context: [], removals: [], additions: [] };
        i++;
        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('***')) {
          const l = lines[i];
          if (l.startsWith('-')) hunk.removals.push(l.slice(1));
          else if (l.startsWith('+')) hunk.additions.push(l.slice(1));
          else if (l.length > 0) hunk.context.push(l);
          i++;
        }
        hunks.push(hunk);
      } else {
        i++;
      }
    }
    files.push({ path, hunks });
  }
  return files;
}

function findContextIndex(lines: string[], context: string[], removals: string[]): number {
  const searchLines =
    context.length > 0 && removals.length > 0 ? context.concat(removals) : context.length > 0 ? context : removals;
  if (searchLines.length === 0) return -1;
  for (let i = 0; i <= lines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (lines[i + j] !== searchLines[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function applyHunk(lines: string[], hunk: PatchHunk): string[] {
  const startIdx = findContextIndex(lines, hunk.context, hunk.removals);
  if (startIdx < 0) {
    throw new Error(`Could not find patch context. Expected:\n${hunk.context.concat(hunk.removals).join('\n')}`);
  }
  // The context is kept; only the removal lines are replaced by the additions.
  const removalStartIdx = startIdx + hunk.context.length;
  const removeCount = hunk.removals.length > 0 ? hunk.removals.length : 0;
  const before = lines.slice(0, removalStartIdx);
  const after = lines.slice(removalStartIdx + removeCount);
  return before.concat(hunk.additions).concat(after);
}

async function applyV4APatch(
  mem: MemoryStore,
  patchText: string
): Promise<{ path: string; status: string; error?: string }[]> {
  const files = parseV4APatch(patchText);
  const results: { path: string; status: string; error?: string }[] = [];
  for (const file of files) {
    let content = await mem.readFile(file.path);
    if (content === null) {
      content = '';
    }
    const lines = content.split('\n');
    let nextLines = lines;
    try {
      for (const hunk of file.hunks) {
        nextLines = applyHunk(nextLines, hunk);
      }
      const newContent = nextLines.join('\n');
      await mem.writeFile(file.path, newContent);
      results.push({ path: file.path, status: 'patched' });
    } catch (e) {
      results.push({
        path: file.path,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

export const patch: Tool = {
  name: 'patch',
  description:
    'Apply targeted edits to text files in the browser workspace (IndexedDB). Two modes: replace (find old_string and replace with new_string) or patch (apply a V4A multi-file patch block). For replace, old_string must be unique unless replace_all is true. For patch, use V4A format: *** Begin Patch / *** Update File: path / @@ context @@ / -old / +new / *** End Patch.',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['replace', 'patch'],
        description: 'replace = single find/replace in one file; patch = multi-file V4A patch block',
      },
      path: {
        type: 'string',
        description: 'Relative path to the file for mode=replace (required for replace)',
      },
      old_string: {
        type: 'string',
        description: 'Exact text to find for mode=replace',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text for mode=replace',
      },
      replace_all: {
        type: 'boolean',
        description: 'If true, replace all occurrences of old_string in mode=replace. Default false.',
      },
      patch: {
        type: 'string',
        description: 'V4A multi-file patch text for mode=patch',
      },
    },
    required: ['mode'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const mode = asString(args.mode);
    if (mode === 'replace') {
      const path = asString(args.path);
      const oldString = asString(args.old_string);
      const newString = asString(args.new_string);
      const replaceAll = asBoolean(args.replace_all);
      if (!path) return 'Error: path is required for mode=replace';
      if (!oldString) return 'Error: old_string is required for mode=replace';
      const content = await mem.readFile(path);
      if (content === null) return `File not found: ${path}`;
      try {
        const { content: updated, replacements } = applyReplace(content, oldString, newString, replaceAll);
        const validation = tryValidateFileSyntax(path, updated);
        if (!validation.ok) {
          return `Error: ${validation.error}\nNo changes were written to ${path}.`;
        }
        await mem.writeFile(path, updated);
        return `Replaced ${replacements} occurrence(s) in ${path}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (mode === 'patch') {
      const patchText = asString(args.patch);
      if (!patchText) return 'Error: patch is required for mode=patch';
      const results = await applyV4APatch(mem, patchText);
      const lines = results.map((r) => {
        if (r.status === 'patched') return `${r.path}: patched`;
        return `${r.path}: error — ${r.error}`;
      });
      const ok = results.every((r) => r.status === 'patched');
      return ok ? lines.join('\n') : `Some files failed:\n${lines.join('\n')}`;
    }
    return `Error: unknown mode ${mode}`;
  },
};
