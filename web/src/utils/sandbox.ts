// ============================================================
// HAG — Lightweight Browser Code Sandbox (iframe srcdoc)
// Runs untrusted JS in a separate browsing context with no
// access to the parent window, document, or IndexedDB.
// ============================================================

export interface SandboxResult {
  logs: string[];
  result: string;
  error?: string;
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
            const logFn = (...args) => {
              logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
            };

            const sandbox = {
              log: logFn,
              console: { log: logFn, error: logFn, warn: logFn, info: logFn },
              Math, JSON, Date, Array, Object, String, Number, Boolean, Map, Set, Promise,
              parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
              RegExp, Error, Symbol, Intl, ArrayBuffer, DataView, Uint8Array, Int8Array,
              Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
              URL, URLSearchParams, TextEncoder, TextDecoder, Blob, FileReader
            };

            let result;
            let error;
            try {
              const fn = new Function(...Object.keys(sandbox), '"use strict";\n' + ${JSON.stringify(code)});
              result = fn(...Object.values(sandbox));
            } catch (e) {
              error = e.message || String(e);
            }

            const resultStr = result === undefined ? 'undefined' : typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);

            parent.postMessage({
              hagSandboxResult: true,
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
      resolve({ logs: [], result: '', error: `Execution timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.hagSandboxResult !== true) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      cleanup();
      resolve({ logs: data.logs || [], result: data.result || '', error: data.error });
    };

    window.addEventListener('message', handler);

    iframe.addEventListener('load', () => {
      // If iframe fails to produce a result within timeout, the timer will catch it
    });

    document.body.appendChild(iframe);
    iframe.src = blobUrl;
  });
}
