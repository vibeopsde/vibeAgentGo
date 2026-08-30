[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/agent.ts
Both issues are clear. Let me verify all `emit('done'` occurrences before editing.
[0m✱ [0mGrep "emit\('done'|emitDoneOnce|doneEmitted"[90m in web/src/core/agent.ts · 9 matches[0m
[0m✱ [0mGrep "' done'|addEventListener\('done'|on\('done'|\.on\("done""[90m in web/src · 1 match[0m
All occurrences found. The only non-canonical `emit('done')` (outside `emitDoneOnce`) is line 497 (success path). Let me check how the `done` event's `sessionId` is consumed by the UI, to choose the correct id to pass.
[0m✱ [0mGrep "done"[90m in web/src · 19 matches[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=320, limit=40][0m
[0m✱ [0mGrep "\.run\(|catch\s*\(|\.catch"[90m in web/src/core/AppController.ts · 58 matches[0m
The `done` handler persists `sessionId` (line 336-337), so the success-path `done` must carry the real saved id, not `runSessionId` (null on first run). Let me check how `run()` is called to pick the right reject behavior.
[0m✱ [0mGrep "already running|Agent is already"[90m in web/src · 1 match[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=225, limit=50][0m
Let me see how the two `run()` call sites handle rejection.
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=468, limit=25][0m
[0m
[0m← [0mEdit web/src/core/agent.ts
Index: /root/vibeAgentGo/web/src/core/agent.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/agent.ts
+++ /root/vibeAgentGo/web/src/core/agent.ts
@@ -493,9 +493,9 @@
 this.currentHistory = history;
 
 await this.saveCurrentSession(history, runSessionId);
 
-this.emit('done', { sessionId: this.sessionId! });
+this.emitDoneOnce(this.sessionId);
 
 // Extract durable memories asynchronously for future sessions
 this.extractMemoryFromConversation(history, config).catch(() => {});
 

[0m
Both reject call sites wrap `await this.agent.run()` in try/catch (AppController.ts:232-243 and 474-482), so `throw` is safe and consistent — I only need to stop the reject path from touching the active run's state. And on the success path, `this.sessionId` is already set to the real saved id by `saveCurrentSession` (line 541), so passing it to `emitDoneOnce` preserves the correct `sessionId` the handler persists (AppController.ts:336). Making the two edits:
[0m← [0mEdit web/src/core/agent.ts
Index: /root/vibeAgentGo/web/src/core/agent.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/agent.ts
+++ /root/vibeAgentGo/web/src/core/agent.ts
@@ -122,9 +122,8 @@
 if (this.running) {
   const err = new Error('Agent is already running — wait for the current run to finish before starting a new one');
   logger.warn('agent.run', 'Rejected concurrent run()', { activeSessionId: this.sessionId });
   this.emit('error', { message: err.message });
-  this.emitDoneOnce(null);
   throw err;
 }
 
 this.running = true;

[0m
[0m→ [0mRead web/src/core/agent.ts[90m [offset=116, limit=48][0m
Now let me verify the edits and run the typecheck.
[0m
[0m$ [0mcat /root/vibeAgentGo/web/package.json 2>/dev/null | grep -A20 '"scripts"'
(no output)
[0m
[0m✱ [0mGlob "**/package.json"[90m 2 matches[0m
The `web/package.json` has no scripts — let me find the right typecheck command.
[0m✱ [0mGlob "web/tsconfig*.json"[90m 1 match[0m
[0m
[0m$ [0mgrep -A25 '"scripts"' /root/vibeAgentGo/package.json; echo "---WEB---"; grep -A25 '"scripts"' /root/vibeAgentGo/web/package.json
"scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p web/tsconfig.json --noEmit",
    "build:dev": "DEPLOY_TARGET=dev vite build --mode dev-deploy && tsc -p web/tsconfig.json --noEmit",
    "preview": "vite preview",
    "preview:dev": "vite preview --outDir web/dist-dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint web/src --ext .ts,.js",
    "lint:fix": "eslint web/src --ext .ts,.js --fix",
    "format": "prettier --write \"web/src/**/*.{ts,js,json,md}\" \"*.md\""
  },
  "keywords": [
    "ai-agent",
    "agent",
    "pwa",
    "mobile",
    "ai",
    "typescript",
    "data-sovereignty"
  ],
  "license": "MIT",
  "dependencies": {
    "@types/sql.js": "^1.4.11",
    "dompurify": "^3.2.0",
    "jszip": "^3.10.1",
---WEB---
[0m
Typecheck uses `tsc -p web/tsconfig.json --noEmit`. Running it plus lint on the file:
[0m$ [0mnpx tsc -p web/tsconfig.json --noEmit 2>&1 | head -40; echo "TSC_EXIT=${PIPESTATUS[0]}"
npm notice run vibeagentgo@2608.3.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
TSC_EXIT=0
[0m
Typecheck passes (exit 0). Running the test suite to confirm the done-emission behavior still holds:
[0m$ [0mnpx vitest run 2>&1 | tail -40; echo "EXIT=${PIPESTATUS[0]}"
durationMs: [33m7[39m,
  result: [32m'Tool error: tool exploded'[39m,
  ok: [33mfalse[39m
}

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.session] Saved session 5a27f2aa (4 messages) { sessionId: [32m'5a27f2aa'[39m }

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.turn] Turn 2/5 { sessionId: [1mnull[22m }

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.session] Saved session 5a27f2aa (5 messages) { sessionId: [32m'5a27f2aa'[39m }

 ✓ tests/agent.test.ts (8 tests) 74ms
 ✓ tests/youtube_transcript.test.ts (10 tests) 22ms
stderr | tests/text_editor.test.ts > TextEditorApp > save shows an error status when the bridge throws
Editor save failed Error: IDB exploded
    at TextEditorApp.bridge [as onBridgeRequest] [90m(/root/vibeAgentGo/[39mweb/tests/text_editor.test.ts:181:13[90m)[39m
    at TextEditorApp.save [90m(/root/vibeAgentGo/[39mweb/src/apps/TextEditorApp.ts:523:30[90m)[39m
[90m    at runNextTicks (node:internal/process/task_queues:64:5)[39m
[90m    at processImmediate (node:internal/timers:452:9)[39m

 ✓ tests/text_editor.test.ts (12 tests) 399ms
stdout | tests/patch.test.ts > patch tool > replaces a unique string
[vibeAgentGo] DB upgraded from v5 to v6

 ✓ tests/patch.test.ts (5 tests) 21ms
 ✓ tests/schema_validate.test.ts (5 tests) 17ms
 ✓ tests/memory.test.ts (4 tests) 11ms
stdout | tests/memory_store.test.ts > MemoryStore > writes and reads binary files
[vibeAgentGo] DB upgraded from v5 to v6

 ✓ tests/memory_store.test.ts (3 tests) 15ms

 Test Files  11 passed (11)
      Tests  64 passed (64)
   Start at  11:51:18
   Duration  1.89s (transform 674ms, setup 446ms, collect 1.38s, tests 766ms, environment 5.20s, prepare 1.29s)

EXIT=0
[0m
Beide Fixes umgesetzt. TSC (exit 0) und alle 64 Tests grün.

**Geänderte Stellen:**

1. `agent.ts:497` (Erfolgspfad `_runInnerCore`): Direktes `this.emit('done', …)` durch `this.emitDoneOnce(this.sessionId)` ersetzt — `done` geht nun nur noch über den canonical-Pfad, das `doneEmitted`-Flag wird gesetzt, und der finally-Block emittiert nicht doppelt; `this.sessionId` (nach `saveCurrentSession` bereits der reale, gespeicherte ID) wird an den UI-Handler übergeben.

2. `agent.ts:122-127` (isRunning-Guard in `run()`): `this.emitDoneOnce(null)` entfernt — der Reject-Pfad berührt ab jetzt weder `doneEmitted` noch `running` des aktiven Runs, sondern emittiert nur `this.emit('error', …)` für die UI und wirft dann; so kann der laufende Run sein `done` weiterhin genau einmal emittieren.

Verifiziert: Die einzigen verbleibenden `emit('done')`-Aufrufe sitzen ausschließlich in `emitDoneOnce` (`agent.ts:113`); alle Aufrufstellen (`finally`-Block Zeile 159, Erfolgspfad Zeile 497) laufen nun durch die einmalige Emission.
