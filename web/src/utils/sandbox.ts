// ============================================================
// vibeAgentGo — Lightweight Browser Code Sandbox (iframe srcdoc)
// Runs untrusted JS in a separate browsing context with no
// access to the parent window, document, or IndexedDB.
// ============================================================

export interface LogEntry {
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
}

export interface SandboxResult {
  logs: LogEntry[];
  result: string;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export function runInSandbox(code: string, timeoutMs = 5000): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.sandbox = 'allow-scripts';
    iframe.setAttribute('aria-hidden', 'true');

    const blobContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <script>
          (function() {
            'use strict';
            const logs = [];
            const capture = (level) => (...args) => {
              const message = args.map(a => {
                if (a instanceof Error) return a.stack || a.message;
                return typeof a === 'object' ? JSON.stringify(a) : String(a);
              }).join(' ');
              const entry = { level, message };
              if (level === 'error' || level === 'warn') {
                const err = args.find(a => a instanceof Error);
                if (err) entry.stack = err.stack;
              }
              logs.push(entry);
            };

            const timers = new Set();
            const safeSetTimeout = (fn, delay, ...args) => {
              const id = setTimeout(() => {
                timers.delete(id);
                try { fn(...args); } catch (e) { console.error(e); }
              }, delay);
              timers.add(id);
              return id;
            };
            const safeSetInterval = (fn, delay, ...args) => {
              const id = setInterval(() => {
                try { fn(...args); } catch (e) { console.error(e); }
              }, delay);
              timers.add(id);
              return id;
            };
            const safeClearTimeout = (id) => { clearTimeout(id); timers.delete(id); };
            const safeClearInterval = (id) => { clearInterval(id); timers.delete(id); };

            const sandbox = {
              log: capture('log'),
              console: {
                log: capture('log'),
                error: capture('error'),
                warn: capture('warn'),
                info: capture('info'),
                debug: capture('log'),
                trace: capture('log'),
              },
              setTimeout: safeSetTimeout,
              setInterval: safeSetInterval,
              clearTimeout: safeClearTimeout,
              clearInterval: safeClearInterval,
              Math, JSON, Date, Array, Object, String, Number, Boolean, Map, Set, Promise,
              parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
              RegExp, Error, Symbol, Intl, ArrayBuffer, DataView, Uint8Array, Int8Array,
              Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
              URL, URLSearchParams, TextEncoder, TextDecoder, Blob, FileReader, WeakMap, WeakSet
            };

            let result;
            let error = null;
            try {
              const fn = new Function(...Object.keys(sandbox), '"use strict";\n' + ${JSON.stringify(code)});
              result = fn(...Object.values(sandbox));
            } catch (e) {
              error = {
                message: e.message || String(e),
                name: e.name || 'Error',
                stack: e.stack || ''
              };
            }

            const resultStr = result === undefined ? 'undefined' : typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);

            timers.forEach(id => { try { clearTimeout(id); clearInterval(id); } catch {} });

            parent.postMessage({
              vibeAgentGoSandboxResult: true,
              logs,
              result: resultStr,
              error
            }, '*');
          })();
        <\/script>
      </body>
      </html>
    `;

    const blob = new Blob([blobContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(blobUrl);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ logs: [], result: '', error: { message: `Execution timed out after ${timeoutMs}ms` } });
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.vibeAgentGoSandboxResult !== true) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      cleanup();
      const error = data.error ? {
        message: data.error.message || String(data.error),
        stack: data.error.stack || '',
        name: data.error.name || 'Error'
      } : undefined;
      resolve({ logs: data.logs || [], result: data.result || '', error });
    };

    window.addEventListener('message', handler);

    iframe.addEventListener('load', () => {
      // If iframe fails to produce a result within timeout, the timer will catch it
    });

    document.body.appendChild(iframe);
    iframe.src = blobUrl;
  });
}
