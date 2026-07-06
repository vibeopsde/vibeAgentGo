// ============================================================
// vibeAgentGo — Agent Worker (rich execution sandbox)
// Runs in a Web Worker: no DOM, no localStorage, no IndexedDB.
// Can importScripts() from CDN (Pyodide, sql.js, csv parsers, etc.).
// Workspace I/O via postMessage bridge to main thread.
// Supports: JavaScript (native) and Python (via Pyodide WASM).
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
    const lang = data.lang || 'javascript';
    if (lang === 'python') {
      runPython(data.code);
    } else {
      runCode(data.code);
    }
  }
});

// Workspace I/O API exposed to user code
const fs = {
  readFile: (path) => sendRequest('readFile', { path }),
  writeFile: (path, content) => sendRequest('writeFile', { path, content }),
  listFiles: () => sendRequest('listFiles', {}),
};

// Render API: display HTML in the Render Panel
function render(title, html) {
  self.postMessage({ __workerSandbox: true, type: 'render', title, html });
}

// --- JavaScript execution ---
function runCode(code) {
  let result = undefined;
  let error = null;

  try {
    const fn = new Function('fs', 'console', 'importScripts', 'render', `return (async () => {\n${code}\n})()`);
    result = fn(fs, console, importScripts, render);
  } catch (e) {
    error = {
      message: e.message || String(e),
      name: e.name || 'Error',
      stack: e.stack || '',
    };
  }

  if (result instanceof Promise) {
    result
      .then((val) => finish(val, null))
      .catch((e) => finish(undefined, {
        message: e.message || String(e),
        name: e.name || 'Error',
        stack: e.stack || '',
      }));
  } else {
    finish(result, error);
  }
}

// --- Python execution (via Pyodide) ---
let pyodidePromise = null;

async function getPyodide() {
  if (pyodidePromise) return pyodidePromise;

  pyodidePromise = (async () => {
    // Load Pyodide from CDN
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js');
    const pyodide = await loadPyodide();

    // Redirect stdout/stderr to our console capture
    pyodide.setStdout({ batched: (text) => console.log(text) });
    pyodide.setStderr({ batched: (text) => console.error(text) });

    // Expose fs and render to Python
    pyodide.globals.set('_fs_readFile', (path) => {
      // Pyodide JS proxy returns a Promise — pyodide awaits it
      return fs.readFile(path);
    });
    pyodide.globals.set('_fs_writeFile', (path, content) => {
      return fs.writeFile(path, content);
    });
    pyodide.globals.set('_fs_listFiles', () => {
      return fs.listFiles();
    });
    pyodide.globals.set('_render', (title, html) => {
      render(title, html);
    });

    // Inject Python helpers that bridge to JS
    pyodide.runPython(`
import js
import pathlib
import builtins

class _FS:
    @staticmethod
    def read_file(path):
        """Read a file from the browser workspace (IndexedDB). Returns str or None."""
        return _fs_readFile(path)

    @staticmethod
    def write_file(path, content):
        """Write a file to the browser workspace (IndexedDB)."""
        return _fs_writeFile(path, content)

    @staticmethod
    def list_files():
        """List all files in the browser workspace."""
        return _fs_listFiles()

def render(title, html):
    """Render HTML in the Render Panel."""
    _render(title, html)

fs = _FS
`);

    return pyodide;
  })();

  return pyodidePromise;
}

async function runPython(code) {
  try {
    const pyodide = await getPyodide();
    const result = pyodide.runPythonAsync(code);
    finish(result, null);
  } catch (e) {
    finish(undefined, {
      message: e.message || String(e),
      name: e.name || 'PythonError',
      stack: e.stack || '',
    });
  }
}

// --- Finish ---
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