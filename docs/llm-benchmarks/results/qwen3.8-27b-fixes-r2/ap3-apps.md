[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=100, limit=80][0m
Ich lese zuerst die relevante Datei und prüfe die genannte Validierung `assertSafePath`.
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=700, limit=120][0m
[0m✱ [0mGrep "prompt|moveFileIntoFolder"[90m in web/src/apps/ExplorerApp.ts · 11 matches[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=440, limit=60][0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=660, limit=45][0m
[0m→ [0mRead web/src/apps/TextEditorApp.ts[90m [offset=405, limit=70][0m
[0m✱ [0mGrep "setStatus|private statusEl|hasControlChars"[90m in web/src/apps/TextEditorApp.ts · 11 matches[0m
Ich prüfe noch den setStatus-Context in TextEditorApp (gleicher Fehler dort):
[0m→ [0mRead web/src/apps/TextEditorApp.ts[90m [offset=550, limit=24][0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=820, limit=55][0m
Mir ist auch `TextEditorApp.ts` aufgefallen (gleicher `window.prompt` → Bridge-Pfad-Muster). Ich überprüfe jetzt noch weitere Apps auf ähnlichen Code:
[0m✱ [0mGrep "window\.prompt"[90m in web/src · 5 matches[0m
[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -725,17 +725,18 @@
   const newName = window.prompt(t('explorer.renamePrompt') || 'Rename file:', oldName);
   if (!newName || newName.trim() === oldName.trim()) return;
   const cleanName = newName.trim().replace(/^\/+/, '');
   if (!cleanName) return;
-  const newPath = oldPath.split('/').slice(0, -1).concat(cleanName).join('/');
-  if (this.files.some((f) => f.path === newPath)) {
+  const safePath = this.assertSafePath(oldPath.split('/').slice(0, -1).concat(cleanName).join('/'));
+  if (!safePath) return;
+  if (this.files.some((f) => f.path === safePath)) {
     window.alert(t('explorer.fileExists') || 'A file already exists with that name');
     return;
   }
   const content = this.files.find((f) => f.path === oldPath)?.content ?? '';
-  await this.onBridgeRequest?.({ type: 'writeFile', path: newPath, content });
+  await this.onBridgeRequest?.({ type: 'writeFile', path: safePath, content });
   await this.onBridgeRequest?.({ type: 'deleteFile', path: oldPath });
-  if (this.activePath === oldPath) this.activePath = newPath;
+  if (this.activePath === oldPath) this.activePath = safePath;
   await this.refresh();
 }
 
 private async deleteFolder(path: string) {

[0m
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -763,28 +763,30 @@
   const cleanName = newName.trim().replace(/^\/+/, '').replace(/\/+$/, '');
   if (!cleanName) return;
   const parentPath = oldPath.split('/').slice(0, -1).join('/');
   const newPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;
+  const safePath = this.assertSafePath(newPath);
+  if (!safePath) return;
 
-  if (this.files.some((f) => f.path === newPath || f.path.startsWith(`${newPath}/`))) {
+  if (this.files.some((f) => f.path === safePath || f.path.startsWith(`${safePath}/`))) {
     window.alert(t('explorer.folderExists') || 'A folder already exists with that name');
     return;
   }
 
   const affected = this.files.filter((f) => f.path === oldPath || f.path.startsWith(`${oldPath}/`));
   for (const file of affected) {
-    const newFilePath = file.path.replace(oldPath, newPath);
+    const newFilePath = file.path.replace(oldPath, safePath);
     await this.onBridgeRequest?.({ type: 'writeFile', path: newFilePath, content: file.content });
   }
   for (const file of affected) {
     await this.onBridgeRequest?.({ type: 'deleteFile', path: file.path });
   }
   if (this.activePath && this.activePath.startsWith(`${oldPath}/`)) {
-    this.activePath = this.activePath.replace(oldPath, newPath);
+    this.activePath = this.activePath.replace(oldPath, safePath);
   }
   if (this.expandedFolders.has(oldPath)) {
     this.expandedFolders.delete(oldPath);
-    this.expandedFolders.add(newPath);
+    this.expandedFolders.add(safePath);
   }
   await this.refresh();
 }
 

[0m
Alle relevanten Stellen sind identifiziert. Jetzt setze ich die Fixes um:
[0m← [0mEdit web/src/apps/ExplorerApp.ts
Index: /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
+++ /root/vibeAgentGo/web/src/apps/ExplorerApp.ts
@@ -460,16 +460,17 @@
 private async moveFileIntoFolder(filePath: string, folderPath: string) {
   const file = this.files.find((f) => f.path === filePath);
   if (!file) return;
   const name = filePath.split('/').pop() || filePath;
-  const newPath = `${folderPath}/${name}`;
-  if (this.files.some((f) => f.path === newPath)) {
+  const safePath = this.assertSafePath(`${folderPath}/${name}`);
+  if (!safePath) return;
+  if (this.files.some((f) => f.path === safePath)) {
     window.alert(t('explorer.fileExists') || 'A file already exists in that folder');
     return;
   }
-  await this.onBridgeRequest?.({ type: 'writeFile', path: newPath, content: file.content });
+  await this.onBridgeRequest?.({ type: 'writeFile', path: safePath, content: file.content });
   await this.onBridgeRequest?.({ type: 'deleteFile', path: filePath });
-  if (this.activePath === filePath) this.activePath = newPath;
+  if (this.activePath === filePath) this.activePath = safePath;
   this.expandedFolders.add(folderPath);
   await this.refresh();
 }
 

[0m
[0m← [0mEdit web/src/apps/TextEditorApp.ts
Index: /root/vibeAgentGo/web/src/apps/TextEditorApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/TextEditorApp.ts
+++ /root/vibeAgentGo/web/src/apps/TextEditorApp.ts
@@ -418,12 +418,34 @@
   if (this.currentPath) return this.currentPath;
   return this.promptForPath(t('editor.saveAsPrompt') || 'File name?');
 }
 
+private assertSafePath(raw: string): string | null {
+  const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
+  if (
+    !path ||
+    path.includes('\\') ||
+    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') ||
+    this.hasControlChars(path)
+  ) {
+    this.setStatus(t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters', true);
+    return null;
+  }
+  return path;
+}
+
+private hasControlChars(s: string): boolean {
+  for (let i = 0; i < s.length; i++) {
+    const code = s.charCodeAt(i);
+    if (code < 32 || code === 127) return true;
+  }
+  return false;
+}
+
 private async promptForPath(message: string): Promise<string | null> {
   const input = window.prompt(message, this.currentPath || 'untitled.txt');
   if (!input) return null;
-  const path = input.trim().replace(/^\/+|\/+$/g, '');
+  const path = this.assertSafePath(input);
   if (!path) return null;
   return path;
 }
 

[0m
Jetzt verifiziere ich mit Typecheck:
[0m$ [0mcat package.json web/package.json 2>/dev/null | grep -A8 '"scripts"'
"scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p web/tsconfig.json --noEmit",
    "build:dev": "DEPLOY_TARGET=dev vite build --mode dev-deploy && tsc -p web/tsconfig.json --noEmit",
    "preview": "vite preview",
    "preview:dev": "vite preview --outDir web/dist-dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint web/src --ext .ts,.js",
[0m
[0m$ [0mnpx tsc -p web/tsconfig.json --noEmit && npx eslint web/src/apps/ExplorerApp.ts web/src/apps/TextEditorApp.ts
npm notice run vibeagentgo@2608.3.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
npm notice run vibeagentgo@2608.3.0 npx
npm notice run 'eslint' web/src/apps/ExplorerApp.ts web/src/apps/TextEditorApp.ts

/root/vibeAgentGo/web/src/apps/TextEditorApp.ts
  430:22  error  Replace `t('explorer.invalidPath')·||·'Invalid·path:·use·relative·names·without·"..",·"\\"·or·control·characters',·true` with `⏎········t('explorer.invalidPath')·||·'Invalid·path:·use·relative·names·without·"..",·"\\"·or·control·characters',⏎········true⏎······`  prettier/prettier

✖ 1 problem (1 error, 0 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.
[0m
[0m← [0mEdit web/src/apps/TextEditorApp.ts
Index: /root/vibeAgentGo/web/src/apps/TextEditorApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/TextEditorApp.ts
+++ /root/vibeAgentGo/web/src/apps/TextEditorApp.ts
@@ -426,9 +426,12 @@
     path.includes('\\') ||
     path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') ||
     this.hasControlChars(path)
   ) {
-    this.setStatus(t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters', true);
+    this.setStatus(
+      t('explorer.invalidPath') || 'Invalid path: use relative names without "..", "\\" or control characters',
+      true
+    );
     return null;
   }
   return path;
 }

[0m
Typecheck ist grün, nur ein Prettier-Formatierungsfehler – fixe ich:
[0m$ [0mnpx tsc -p web/tsconfig.json --noEmit && npx eslint web/src/apps/ExplorerApp.ts web/src/apps/TextEditorApp.ts && npx vitest run --reporter=basic 2>&1 | tail -15
npm notice run vibeagentgo@2608.3.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
npm notice run vibeagentgo@2608.3.0 npx
npm notice run 'eslint' web/src/apps/ExplorerApp.ts web/src/apps/TextEditorApp.ts
[vibeAgentGo] DB upgraded from v5 to v6

 ✓ tests/memory_store.test.ts (3 tests) 18ms
stdout | tests/patch.test.ts > patch tool > replaces a unique string
[vibeAgentGo] DB upgraded from v5 to v6

 ✓ tests/patch.test.ts (5 tests) 21ms
 ✓ tests/memory.test.ts (4 tests) 14ms


 Test Files  11 passed (11)
      Tests  64 passed (64)
   Start at  12:07:25
   Duration  2.22s (transform 951ms, setup 414ms, collect 1.78s, tests 864ms, environment 5.96s, prepare 1.37s)
[0m
Alle Checks grün (tsc, eslint, 64 Tests). **Änderungsliste:**

1. `ExplorerApp.ts` – `renameFile()`: neuer Ziel-Pfad wird vor Bridge-Nutzung mit `assertSafePath` validiert; bei ungültigem Namen sichtbares `showStatus`-Feedback statt stiller Ausführung.
2. `ExplorerApp.ts` – `renameFolder()`: identische `assertSafePath`-Validierung auf den neuen Folder-Pfad; alle Folge-Aufrufe (writeFile/activePath/expandedFolders) nutzen den validierten Pfad.
3. `ExplorerApp.ts` – `moveFileIntoFolder()`: Ziel-Pfad `${folderPath}/${name}` vor Bridge-Nutzung mit `assertSafePath` abgesichert.
4. `TextEditorApp.ts` – `assertSafePath()` + `hasControlChars()` hinzugezogen (identische Regeln wie Explorer) und in `promptForPath()` eingebunden, sodass New/SaveAs-Pfade aus `window.prompt` mit Fehler-Feedback über `setStatus()` validiert werden.
5. `createFile()`/`createFolder()` und `handleUpload()` wurden als bereits validiert gecheckt – keine Änderung nötig.
