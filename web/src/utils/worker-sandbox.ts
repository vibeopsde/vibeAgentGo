// ============================================================
// vibeAgentGo — Web Worker Sandbox (rich execution environment)
// Runs JS in a Web Worker with importScripts() for CDN libs,
// postMessage bridge for workspace I/O, 30s timeout.
// No DOM, no localStorage, no IndexedDB — fully isolated.
// ============================================================

export interface WorkerSandboxResult {
  logs: { level: string; message: string }[];
  result: string;
  error?: { message: string; name: string; stack?: string };
  files?: { path: string; content: string }[];
}

export interface WorkerSandboxOptions {
  /** Workspace I/O bridge — called when worker requests file read/write */
  readFile?: (path: string) => Promise<string | null>;
  writeFile?: (path: string, content: string) => Promise<void>;
  listFiles?: () => Promise<{ path: string; content: string }[]>;
  /** Called when worker calls render(title, html) — displays in Render Panel */
  onRender?: (title: string, html: string) => void;
  /** Language: "javascript" (default) or "python" */
  lang?: 'javascript' | 'python';
  /** Timeout in ms (default: 30000, max: 60000) */
  timeoutMs?: number;
}

export function runInWorkerSandbox(
  code: string,
  options: WorkerSandboxOptions = {}
): Promise<WorkerSandboxResult> {
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 30000, 60000));
  const lang = options.lang || 'javascript';

  return new Promise((resolve) => {
    let settled = false;

    const worker = new Worker('./agent-worker.js');

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve({
        logs: [],
        result: '',
        error: { message: `Execution timed out after ${timeoutMs}ms`, name: 'TimeoutError' },
      });
    }, timeoutMs);

    // Track file writes from the worker
    const writtenFiles: { path: string; content: string }[] = [];

    worker.onmessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.__workerSandbox !== true) return;

      // Workspace I/O requests from the worker
      if (data.type === 'readFile') {
        try {
          const content = options.readFile
            ? await options.readFile(data.path)
            : null;
          worker.postMessage({ __workerSandbox: true, type: 'readFileResult', id: data.id, content });
        } catch (e) {
          worker.postMessage({
            __workerSandbox: true,
            type: 'readFileResult',
            id: data.id,
            content: null,
            error: String(e),
          });
        }
        return;
      }

      if (data.type === 'writeFile') {
        try {
          if (options.writeFile) await options.writeFile(data.path, data.content);
          writtenFiles.push({ path: data.path, content: data.content });
          worker.postMessage({ __workerSandbox: true, type: 'writeFileResult', id: data.id, ok: true });
        } catch (e) {
          worker.postMessage({
            __workerSandbox: true,
            type: 'writeFileResult',
            id: data.id,
            ok: false,
            error: String(e),
          });
        }
        return;
      }

      if (data.type === 'listFiles') {
        try {
          const files = options.listFiles ? await options.listFiles() : [];
          worker.postMessage({ __workerSandbox: true, type: 'listFilesResult', id: data.id, files });
        } catch (e) {
          worker.postMessage({
            __workerSandbox: true,
            type: 'listFilesResult',
            id: data.id,
            files: [],
            error: String(e),
          });
        }
        return;
      }

      // Render request from worker — display HTML in the Render Panel
      if (data.type === 'render') {
        if (options.onRender) options.onRender(data.title, data.html);
        return;
      }

      // Final result
      if (data.type === 'done') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve({
          logs: data.logs || [],
          result: data.result || '',
          error: data.error
            ? { message: data.error.message, name: data.error.name, stack: data.error.stack }
            : undefined,
          files: writtenFiles,
        });
      }
    };

    worker.onerror = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve({
        logs: [],
        result: '',
        error: { message: e.message || 'Worker error', name: 'WorkerError', stack: undefined },
      });
    };

    // Send the code to the worker
    worker.postMessage({ __workerSandbox: true, type: 'run', code, lang, timeoutMs });
  });
}