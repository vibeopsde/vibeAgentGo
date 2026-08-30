[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m
[0m$ [0mls /root/vibeAgentGo/web/src /root/vibeAgentGo/web/src/apps 2>/dev/null; grep -rn "closeWindow" /root/vibeAgentGo/web/src --include=*.ts -l
/root/vibeAgentGo/web/src:
apps
components
core
i18n
main.ts
styles
types
utils
version.ts

/root/vibeAgentGo/web/src/apps:
AppStoreApp.ts
ChatApp.ts
ExplorerApp.ts
ProgramApp.ts
SettingsApp.ts
TextEditorApp.ts
/root/vibeAgentGo/web/src/core/AppController.ts
/root/vibeAgentGo/web/src/core/window_manager.ts
[0m
[0m✱ [0mGrep "interface App|type App"[90m in web/src/types · 3 matches[0m
[0m✱ [0mGrep "closeWindow|element|app\."[90m in web/src/core/window_manager.ts · 100 matches[0m
[0m→ [0mRead web/src/types/index.ts[90m [offset=155, limit=55][0m
[0m→ [0mRead web/src/core/window_manager.ts[90m [offset=280, limit=30][0m
Now I have the full picture. Let me check the explorer styles so the status line fits in.
[0m✱ [0mGrep "explorer-empty"[90m in web/src/styles · 1 match[0m
Now I'll implement the fixes. First, the App interface (optional, backward-compatible):
[0m
[0m← [0mEdit web/src/types/index.ts
Index: /root/vibeAgentGo/web/src/types/index.ts
===================================================================
--- /root/vibeAgentGo/web/src/types/index.ts
+++ /root/vibeAgentGo/web/src/types/index.ts
@@ -174,8 +174,10 @@
   /** Optional: called when the app's window loses focus. */
   onBlur?(): void;
   /** Optional: called when the window is closed. Return false to prevent closing. */
   onClose?(): boolean | Promise<boolean>;
+  /** Optional: called after the window is closed, to release global listeners/resources. */
+  unmount?(): void;
   /** Optional: called when new data is pushed to the window (e.g. open a file in an editor). */
   setData?(data: Record<string, unknown>): void;
 }
 

[0m
[0m← [0mEdit web/src/core/window_manager.ts
Index: /root/vibeAgentGo/web/src/core/window_manager.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/window_manager.ts
+++ /root/vibeAgentGo/web/src/core/window_manager.ts
@@ -296,8 +296,9 @@
 }
 
 app?.element?.remove();
 win.element.remove();
+app?.unmount?.();
 this.windows.delete(id);
 this.instances.delete(id);
 this.windowData.delete(id);
 

[0m
Now ExplorerApp — Fix 1 (listerner-refs + unmount):
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -32,8 +32,10 @@
 private expandedFolders = new Set<string>();
 private activePath: string | null = null;
 private contextMenu: HTMLElement | null = null;
 private searchQuery = '';
+private onDocClick: ((e: Event) => void) | null = null;
+private onDocKeydown: ((e: KeyboardEvent) => void) | null = null;
 
 constructor() {
   this.element = document.createElement('div');
   this.element.className = 'explorer-app';

[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=22, limit=65][0m
[0m→ [0mRead web/src/styles/app.css[90m [offset=2425, limit=25][0m
[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -75,14 +75,28 @@
     this.render();
   });
 
   this.setupDragDrop();
-  document.addEventListener('click', () => this.closeContextMenu());
-  document.addEventListener('keydown', (e) => {
+  this.onDocClick = () => this.closeContextMenu();
+  this.onDocKeydown = (e: KeyboardEvent) => {
     if (e.key === 'Escape') this.closeContextMenu();
-  });
+  };
+  document.addEventListener('click', this.onDocClick);
+  document.addEventListener('keydown', this.onDocKeydown);
 }
 
+unmount(): void {
+  if (this.onDocClick) {
+    document.removeEventListener('click', this.onDocClick);
+    this.onDocClick = null;
+  }
+  if (this.onDocKeydown) {
+    document.removeEventListener('keydown', this.onDocKeydown);
+    this.onDocKeydown = null;
+  }
+  this.closeContextMenu();
+}
+
 private setupDragDrop() {
   this.listEl.addEventListener('dragover', (e) => {
     e.preventDefault();
     this.listEl.classList.add('drag-over');

[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -34,8 +34,9 @@
 private contextMenu: HTMLElement | null = null;
 private searchQuery = '';
 private onDocClick: ((e: Event) => void) | null = null;
 private onDocKeydown: ((e: KeyboardEvent) => void) | null = null;
+private statusTimer: number | null = null;
 
 constructor() {
   this.element = document.createElement('div');
   this.element.className = 'explorer-app';

[0m
Now Fix 2 — the validation helper and status feedback:
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -93,11 +93,46 @@
   if (this.onDocKeydown) {
     document.removeEventListener('keydown', this.onDocKeydown);
     this.onDocKeydown = null;
   }
+  if (this.statusTimer !== null) {
+    window.clearTimeout(this.statusTimer);
+    this.statusTimer = null;
+  }
   this.closeContextMenu();
 }
 
+private showStatus(message: string) {
+  let el = this.element.querySelector('.explorer-status') as HTMLElement | null;
+  if (!el) {
+    el = document.createElement('div');
+    el.className = 'explorer-status';
+    const list = this.element.querySelector('.explorer-list') as HTMLElement;
+    list.parentElement?.insertBefore(el, list);
+  }
+  el.textContent = message;
+  if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
+  this.statusTimer = window.setTimeout(() => {
+    el?.remove();
+    this.statusTimer = null;
+  }, 5000);
+}
+
+/** Validates a user-supplied path; returns the cleaned path or null (with UI feedback). */
+private assertSafePath(raw: string): string | null {
+  const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
+  if (!path || nameHasControlChars(path) || path.includes('\\')) {
+    this.showStatus(t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters');
+    return null;
+  }
+  const segments = path.split('/');
+  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
+    this.showStatus(t('explorer.invalidPath') || 'Invalid path: ".." and empty segments are not allowed');
+    return null;
+  }
+  return path;
+}
+
 private setupDragDrop() {
   this.listEl.addEventListener('dragover', (e) => {
     e.preventDefault();
     this.listEl.classList.add('drag-over');

[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -119,9 +119,9 @@
 
 /** Validates a user-supplied path; returns the cleaned path or null (with UI feedback). */
 private assertSafePath(raw: string): string | null {
   const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
-  if (!path || nameHasControlChars(path) || path.includes('\\')) {
+  if (!path || /\x00/.test(path) || /[\x01-\x1f\x7f]/.test(path) || path.includes('\\')) {
     this.showStatus(t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters');
     return null;
   }
   const segments = path.split('/');

[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -661,9 +661,9 @@
 
 private async createFolder() {
   const name = window.prompt(t('explorer.newFolderPrompt') || 'New folder name (e.g. my-project):');
   if (!name) return;
-  const folderPath = name.trim().replace(/^\/+/, '').replace(/\/+$/, '');
+  const folderPath = this.assertSafePath(name);
   if (!folderPath) return;
   const path = `${folderPath}/.keep`;
 
   const existing = this.files.find(

[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -684,9 +684,9 @@
 
 private async createFile() {
   const name = window.prompt(t('explorer.newFilePrompt') || 'New file name (e.g. notes.md or my-folder/notes.md):');
   if (!name) return;
-  const path = name.trim().replace(/^\/+/, '');
+  const path = this.assertSafePath(name);
   if (!path) return;
 
   const existing = this.files.find((f) => f.path === path);
   if (existing) {

[0m
[0m→ [0mRead web/src/i18n/index.ts[90m [limit=40][0m
[0m✱ [0mGrep ""explorer\.""[90m in web/src/i18n · 0 matches[0m
[0m
[0m$ [0mgrep -rn "explorer.title" /root/vibeAgentGo/web/src/i18n | head; grep -n "^const en" /root/vibeAgentGo/web/src/i18n/index.ts
/root/vibeAgentGo/web/src/i18n/index.ts:127:  'explorer.title': 'Explorer',
/root/vibeAgentGo/web/src/i18n/index.ts:332:  'explorer.title': 'Explorer',
215:const en: Translations = {
[0m
[0m→ [0mRead web/src/i18n/index.ts[90m [offset=120, limit=40][0m
[0m→ [0mRead web/src/i18n/index.ts[90m [offset=325, limit=20][0m
[0m
[0m← [0mEdit web/src/i18n/index.ts
Index: /root/vibeAgentGo/web/src/i18n/index.ts
===================================================================
--- /root/vibeAgentGo/web/src/i18n/index.ts
+++ /root/vibeAgentGo/web/src/i18n/index.ts
@@ -141,8 +141,9 @@
 'explorer.renamePrompt': 'Datei umbenennen:',
 'explorer.renameFolderPrompt': 'Ordner umbenennen:',
 'explorer.empty': 'Noch keine Dateien.',
 'explorer.refresh': 'Aktualisieren',
+'explorer.invalidPath': 'Ungültiger Pfad: verwende relative Namen ohne "..", Backslash oder Steuerzeichen.',
 
 // Editor
 'editor.untitled': 'Unbenannt',
 'editor.save': 'Speichern',

[0m
[0m← [0mEdit web/src/i18n/index.ts
Index: /root/vibeAgentGo/web/src/i18n/index.ts
===================================================================
--- /root/vibeAgentGo/web/src/i18n/index.ts
+++ /root/vibeAgentGo/web/src/i18n/index.ts
@@ -342,8 +342,9 @@
 'explorer.newFolderPrompt': 'New folder name (e.g. my-folder):',
 'explorer.fileExists': 'File already exists.',
 'explorer.folderExists': 'Folder already exists.',
 'explorer.confirmDelete': 'Delete {path}?',
+'explorer.invalidPath': 'Invalid path: use relative names without "..", backslashes or control characters.',
 'explorer.confirmDeleteFolder': 'Delete folder {path} and all its contents?',
 'explorer.renamePrompt': 'Rename file:',
 'explorer.renameFolderPrompt': 'Rename folder:',
 'explorer.empty': 'No files yet.',

[0m
[0m→ [0mRead web/src/i18n/index.ts[90m [offset=342, limit=10][0m
[0m
[0m← [0mEdit web/src/styles/app.css
Index: /root/vibeAgentGo/web/src/styles/app.css
===================================================================
--- /root/vibeAgentGo/web/src/styles/app.css
+++ /root/vibeAgentGo/web/src/styles/app.css
@@ -2436,8 +2436,19 @@
   text-align: center;
   font-size: 13px;
 }
 
+.explorer-status {
+  padding: 6px 10px;
+  color: var(--danger, #ef4444);
+  background: rgba(239, 68, 68, 0.08);
+  border: 1px solid rgba(239, 68, 68, 0.25);
+  border-radius: 6px;
+  margin: 8px 10px 0;
+  font-size: 12px;
+  word-break: break-word;
+}
+
 .explorer-item {
   display: flex;
   align-items: center;
   gap: 8px;

[0m
[0m$ [0mcat web/package.json | grep -A10 '"scripts"'; ls web
dist
dist-dev
index.html
node_modules
package-lock.json
package.json
public
src
tests
tsconfig.json
[0m
Now verify: typecheck/build.
[0m$ [0mgrep -n "scripts" -A8 /root/vibeAgentGo/web/package.json; ls /root/vibeAgentGo | head -20; grep -n "scripts" -A8 /root/vibeAgentGo/package.json 2>/dev/null
LICENSE
LICENSE-THIRD-PARTY.md
README.md
dist
docs
eslint.config.mjs
node_modules
package-lock.json
package.json
review-2026-07-07.md
server
tsconfig.json
vite.config.ts
web
7:  "scripts": {
8-    "dev": "vite",
9-    "build": "vite build && tsc -p web/tsconfig.json --noEmit",
10-    "build:dev": "DEPLOY_TARGET=dev vite build --mode dev-deploy && tsc -p web/tsconfig.json --noEmit",
11-    "preview": "vite preview",
12-    "preview:dev": "vite preview --outDir web/dist-dev",
13-    "test": "vitest run",
14-    "test:watch": "vitest",
15-    "lint": "eslint web/src --ext .ts,.js",
[0m
[0m$ [0mnpx tsc -p web/tsconfig.json --noEmit 2>&1 | head -50; echo "EXIT: $?"
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
EXIT: 0
[0m
Typecheck passes. Quick lint + tests:
[0m$ [0mnpx eslint web/src/apps/ExplorerApp.ts web/src/core/window_manager.ts web/src/types/index.ts 2>&1 | tail -20; echo "EXIT: $?"
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'eslint' web/src/apps/ExplorerApp.ts web/src/core/window_manager.ts web/src/types/index.ts

/root/vibeAgentGo/web/src/apps/ExplorerApp.ts
  123:18  error  Unexpected control character(s) in regular expression: \x00                                                                                                                                                                                         no-control-regex
  123:39  error  Unexpected control character(s) in regular expression: \x01, \x1f                                                                                                                                                                                   no-control-regex
  124:23  error  Replace `t('explorer.invalidPath')·||·'Invalid·path:·use·relative·names·without·"..",·"\\"·or·control·characters'` with `⏎········t('explorer.invalidPath')·||·'Invalid·path:·use·relative·names·without·"..",·"\\"·or·control·characters'⏎······`  prettier/prettier

/root/vibeAgentGo/web/src/types/index.ts
  40:34  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 4 problems (3 errors, 1 warning)
  1 error and 0 warnings potentially fixable with the `--fix` option.

EXIT: 0
[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -119,9 +119,9 @@
 
 /** Validates a user-supplied path; returns the cleaned path or null (with UI feedback). */
 private assertSafePath(raw: string): string | null {
   const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
-  if (!path || /\x00/.test(path) || /[\x01-\x1f\x7f]/.test(path) || path.includes('\\')) {
+  if (!path || path.includes('\\') || this.hasControlChars(path)) {
     this.showStatus(t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters');
     return null;
   }
   const segments = path.split('/');

[0m
Avoid the lint error by checking char codes instead of a control-char regex:
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -131,8 +131,16 @@
   }
   return path;
 }
 
+private hasControlChars(s: string): boolean {
+  for (let i = 0; i < s.length; i++) {
+    const code = s.charCodeAt(i);
+    if (code < 32 || code === 127) return true;
+  }
+  return false;
+}
+
 private setupDragDrop() {
   this.listEl.addEventListener('dragover', (e) => {
     e.preventDefault();
     this.listEl.classList.add('drag-over');

[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [limit=55, offset=95][0m
[0m
[0m$ [0mnpx eslint web/src/apps/ExplorerApp.ts 2>&1 | tail -10; echo "LINT EXIT"; npx tsc -p web/tsconfig.json --noEmit 2>&1 | tail -5; echo "TSC EXIT"
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'eslint' web/src/apps/ExplorerApp.ts

/root/vibeAgentGo/web/src/apps/ExplorerApp.ts
  124:23  error  Replace `t('explorer.invalidPath')·||·'Invalid·path:·use·relative·names·without·"..",·"\\"·or·control·characters'` with `⏎········t('explorer.invalidPath')·||·'Invalid·path:·use·relative·names·without·"..",·"\\"·or·control·characters'⏎······`  prettier/prettier

✖ 1 problem (1 error, 0 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.

LINT EXIT
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
TSC EXIT
[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -120,9 +120,11 @@
 /** Validates a user-supplied path; returns the cleaned path or null (with UI feedback). */
 private assertSafePath(raw: string): string | null {
   const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
   if (!path || path.includes('\\') || this.hasControlChars(path)) {
-    this.showStatus(t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters');
+    this.showStatus(
+      t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters'
+    );
     return null;
   }
   const segments = path.split('/');
   if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {

[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -127,9 +127,11 @@
     return null;
   }
   const segments = path.split('/');
   if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
-    this.showStatus(t('explorer.invalidPath') || 'Invalid path: ".." and empty segments are not allowed');
+    this.showStatus(
+      t('explorer.invalidPath') || 'Invalid path: ".." and empty segments are not allowed'
+    );
     return null;
   }
   return path;
 }

[0m
[0m$ [0mnpx eslint web/src/apps/ExplorerApp.ts web/src/core/window_manager.ts web/src/i18n/index.ts 2>&1 | tail -10 && npx tsc -p web/tsconfig.json --noEmit && echo ALLOK
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'eslint' web/src/apps/ExplorerApp.ts web/src/core/window_manager.ts web/src/i18n/index.ts

/root/vibeAgentGo/web/src/apps/ExplorerApp.ts
  131:23  error  Replace `⏎········t('explorer.invalidPath')·||·'Invalid·path:·".."·and·empty·segments·are·not·allowed'⏎······` with `t('explorer.invalidPath')·||·'Invalid·path:·".."·and·empty·segments·are·not·allowed'`  prettier/prettier

✖ 1 problem (1 error, 0 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.

npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
ALLOK
[0m
[0m$ [0mnpx eslint --fix web/src/apps/ExplorerApp.ts && npx eslint web/src/apps/ExplorerApp.ts web/src/core/window_manager.ts web/src/types/index.ts web/src/i18n/index.ts 2>&1 | tail -6 && npx tsc -p web/tsconfig.json --noEmit && echo ALLDONE
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'eslint' --fix web/src/apps/ExplorerApp.ts

/root/vibeAgentGo/web/src/types/index.ts
  40:34  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 1 problem (0 errors, 1 warning)

npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
ALLDONE
[0m
Lint clean (the remaining warning is pre-existing), tsc passes. Running the test suite:
[0m$ [0mnpx vitest run 2>&1 | tail -15
[vibeAgentGo] DB upgraded from v5 to v6

 ✓ tests/patch.test.ts (5 tests) 20ms
stdout | tests/memory_store.test.ts > MemoryStore > writes and reads binary files
[vibeAgentGo] DB upgraded from v5 to v6

 ✓ tests/memory_store.test.ts (3 tests) 17ms
 ✓ tests/memory.test.ts (4 tests) 11ms
 ✓ tests/schema_validate.test.ts (5 tests) 15ms

 Test Files  11 passed (11)
      Tests  64 passed (64)
   Start at  07:33:14
   Duration  1.87s (transform 713ms, setup 402ms, collect 1.47s, tests 697ms, environment 5.06s, prepare 1.24s)
[0m
All 64 tests pass. Let me verify the final state of the key sections:
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [limit=72, offset=78][0m
[0m
[0m$ [0mgit status --short
M web/src/apps/ExplorerApp.ts
 M web/src/core/window_manager.ts
 M web/src/i18n/index.ts
 M web/src/styles/app.css
 M web/src/types/index.ts
?? docs/llm-benchmarks/results/qwen3.8-27b-fixes/ap2-apps.md
?? docs/llm-benchmarks/results/qwen3.8-27b-fixes/timing.jsonl
[0m
Alle Fixes umgesetzt, Typecheck, Lint und 64 Tests grün.

**Geänderte Dateien:**

1. `web/src/apps/ExplorerApp.ts` — Dokument-Listener werden nun in Instanzfeldern (`onDocClick`/`onDocKeydown`) gehalten und in neuer `unmount()`-Methode per `removeEventListener` entfernt; zusätzlich zentrale Pfad-Validierung `assertSafePath()` (verwirft `..`-Segmente, Backslashes, Steuerzeichen/Nullbytes, absolute Pfade) mit sichtbarem Status-Feedback statt Bridge-Anfrage bei ungültigem Namen; `createFolder()`/`createFile()` nutzen den neuen Helper.
2. `web/src/core/window_manager.ts` — `closeWindow()` ruft nach dem Entfernen der Elemente die optionale `app?.unmount?.()` auf, damit App-Instanzen Global-Listener aufräumen können.
3. `web/src/types/index.ts` — Rückwärtskompatible optionale Methode `unmount?(): void` in der `App`-Schnittstelle ergänzt.
4. `web/src/i18n/index.ts` — Neuer i18n-Key `explorer.invalidPath` (DE + EN) für das Nutzer-Feedback bei ungültigen Pfaden.
5. `web/src/styles/app.css` — Neue `.explorer-status`-Stilregel für die sichtbare Statusmeldung im Explorer-UI.
