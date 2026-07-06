// ============================================================
// vibeAgentGo — Agent Worker (rich execution sandbox)
// Runs in a Web Worker: no DOM, no localStorage, no IndexedDB.
// Can importScripts() from CDN (sql.js, csv parsers, etc.).
// Workspace I/O via postMessage bridge to main thread.
// ============================================================

self.__workerSandbox = true;

// --- Console capture ---
const logs = [];
const capture = (level) => (...args) => {
  const message = args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') {
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  logs.push({ level, message });
};

const console = {
  log: capture('log'),
  error: capture('error'),
  warn: capture('warn'),
  info: capture('info'),
  debug: capture('log'),
  trace: capture('log'),
};

// --- Workspace I/O bridge ---
// These are async — they postMessage to main thread and wait for response.
const pendingRequests = new Map();
let requestCounter = 0;

function sendRequest(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++requestCounter;
    pendingRequests.set(id, { resolve, reject });
    self.postMessage({ __workerSandbox: true, type, id, ...payload });
  });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.__workerSandbox !== true) return;

  // Response to our I/O request
  if (data.type === 'readFileResult' || data.type === 'writeFileResult' || data.type === 'listFilesResult') {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if (data.type === 'readFileResult') {
      pending.resolve(data.content);
    } else if (data.type === 'writeFileResult') {
      pending.resolve(data.ok);
    } else if (data.type === 'listFilesResult') {
      pending.resolve(data.files || []);
    }
    return;
  }

  // Run code request
  if (data.type === 'run') {
    runCode(data.code);
  }
});

// Workspace I/O API exposed to user code
const fs = {
  readFile: (path) => sendRequest('readFile', { path }),
  writeFile: (path, content) => sendRequest('writeFile', { path, content }),
  listFiles: () => sendRequest('listFiles', {}),
};

// Render API: display HTML in the Render Panel (same path as render_view used)
function render(title, html) {
  self.postMessage({ __workerSandbox: true, type: 'render', title, html });
}

// --- Code execution ---
function runCode(code) {
  let result = undefined;
  let error = null;

  try {
    // Wrap user code in an async function so `await` works at the top level.
    // This lets the user write `const sql = await initSqlJs(...)` directly.
    // Any returned Promise is then caught by the instanceof check below.
    const fn = new Function('fs', 'console', 'importScripts', 'render', `return (async () => {\n${code}\n})()`);
    result = fn(fs, console, importScripts, render);
  } catch (e) {
    error = {
      message: e.message || String(e),
      name: e.name || 'Error',
      stack: e.stack || '',
    };
  }

  // If result is a Promise, wait for it
  if (result instanceof Promise) {
    result
      .then((val) => {
        finish(val, null);
      })
      .catch((e) => {
        finish(undefined, {
          message: e.message || String(e),
          name: e.name || 'Error',
          stack: e.stack || '',
        });
      });
  } else {
    finish(result, error);
  }
}

function finish(result, error) {
  let resultStr;
  if (result === undefined) {
    resultStr = 'undefined';
  } else if (result === null) {
    resultStr = 'null';
  } else if (typeof result === 'object') {
    try {
      resultStr = JSON.stringify(result, null, 2);
    } catch {
      resultStr = String(result);
    }
  } else {
    resultStr = String(result);
  }

  self.postMessage({
    __workerSandbox: true,
    type: 'done',
    logs,
    result: resultStr,
    error,
  });
}