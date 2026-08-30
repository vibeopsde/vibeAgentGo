[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/agent.ts
I'll implement the three fixes. Let me start with the field declarations and the emit fix.
[0m
[0m← [0mEdit web/src/core/agent.ts
Index: /root/vibeAgentGo/web/src/core/agent.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/agent.ts
+++ /root/vibeAgentGo/web/src/core/agent.ts
@@ -41,8 +41,10 @@
 private listeners: Partial<Record<keyof AgentEventMap, ((data: unknown) => void)[]>> = {};
 private abortController: AbortController | null = null;
 private currentHistory: Message[] = [];
 private currentRunSessionId: string | null = null;
+private running = false;
+private doneEmitted = false;
 
 constructor(tools: Tool[], memory: MemoryStore, opts: AgentOptions = {}) {
   this.tools = tools;
   this.memory = memory;

[0m
[0m← [0mEdit web/src/core/agent.ts
Index: /root/vibeAgentGo/web/src/core/agent.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/agent.ts
+++ /root/vibeAgentGo/web/src/core/agent.ts
@@ -68,9 +68,20 @@
 }
 
 private emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
   const handlers = this.listeners[event];
-  if (handlers) handlers.forEach((h) => (h as EventHandler<K>)(data));
+  if (!handlers) return;
+  const snapshot = handlers.slice();
+  for (const h of snapshot) {
+    try {
+      (h as EventHandler<K>)(data);
+    } catch (e) {
+      logger.error('agent.emit', `Handler for "${String(event)}" threw`, {
+        event: String(event),
+        error: e instanceof Error ? e.message : String(e),
+      });
+    }
+  }
 }
 
 abort() {
   if (this.abortController) {

[0m
Now the race-condition guard and centralized idempotent done-emission:
[0m← [0mEdit web/src/core/agent.ts
Index: /root/vibeAgentGo/web/src/core/agent.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/agent.ts
+++ /root/vibeAgentGo/web/src/core/agent.ts
@@ -106,14 +106,30 @@
     },
   };
 }
 
+private emitDoneOnce(sessionId: string | null): void {
+  if (this.doneEmitted) return;
+  this.doneEmitted = true;
+  this.emit('done', { sessionId: sessionId || 'unknown' });
+}
+
 async run(
   userMessage: string,
   config: AgentConfig,
   sessionId?: string,
   attachments: ChatAttachment[] = []
 ): Promise<string> {
+  if (this.running) {
+    const err = new Error('Agent is already running — wait for the current run to finish before starting a new one');
+    logger.warn('agent.run', 'Rejected concurrent run()', { activeSessionId: this.sessionId });
+    this.emit('error', { message: err.message });
+    this.emitDoneOnce(null);
+    throw err;
+  }
+
+  this.running = true;
+  this.doneEmitted = false;
   this.sessionId = sessionId || this.sessionId || null;
   this.abortController = new AbortController();
   const runSessionId = this.sessionId;
   const controller = this.abortController;
@@ -137,11 +153,13 @@
       model: config.model,
       baseUrl: config.baseUrl,
     });
     this.emit('error', { message: friendly });
-    // Ensure UI is unlocked even when the run failed hard
-    this.emit('done', { sessionId: runSessionId || 'unknown' });
     return `Error: ${friendly}`;
+  } finally {
+    // Guarantee done is emitted exactly once for UI unlock, regardless of path
+    this.emitDoneOnce(runSessionId);
+    this.running = false;
   }
 }
 
 private async _runInner(

[0m
Now let me verify the project's typecheck setup and run it.
[0m→ [0mRead web/package.json
[0m→ [0mRead package.json
[0m✱ [0mGlob "**/tsconfig*.json"[90m 2 matches[0m
[0m
[0m$ [0mnpx tsc -p web/tsconfig.json --noEmit 2>&1 | head -50
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
[0m
[0m✱ [0mGrep "\.run\("[90m in web/src · 2 matches[0m
[0m
[0m$ [0mnpx eslint web/src/core/agent.ts 2>&1 | tail -30
npm notice run vibeagentgo@2608.2.0 npx
npm notice run 'eslint' web/src/core/agent.ts

/root/vibeAgentGo/web/src/core/agent.ts
   38:36  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  637:19  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 2 problems (0 errors, 2 warnings)
[0m
Typecheck passed. Let me run lint on the changed file and check for existing agent tests/callsites that might rely on the `run()` return-on-rejection behavior.
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=225, limit=25][0m
Lint shows only pre-existing warnings (unchanged code). Let me verify the callsites handle the promise properly so a rejected `run()` doesn't become an unhandled rejection.
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=468, limit=25][0m
[0m✱ [0mGlob "**/{test,tests,__tests__,spec}/**/*agent*"[90m 1 match[0m
[0m✱ [0mGrep "\b(agent\.)?run\("[90m in web · 8 matches[0m
Both callsites already wrap `await this.agent.run(...)` in try/catch, so the rejection on a concurrent call is handled (no unhandled rejection, no new signature breakage). Let me check existing tests for agent to ensure nothing asserts on the old behavior.
[0m→ [0mRead web/tests/agent.test.ts[90m [offset=180, limit=60][0m
Let me check the test file, especially the abort test (line 189) and the "boom" test (line 225), since my changes touch run() and done-emission.
Let me run the agent tests to confirm nothing breaks.
[0m
[0m$ [0mnpx vitest run web/tests/agent.test.ts 2>&1 | tail -40
stderr | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.tool.dispatch] Tool boom failed {
  sessionId: [1mnull[22m,
  tool: [32m'boom'[39m,
  error: [32m'tool exploded'[39m,
  stack: [32m'Error: tool exploded\n'[39m +
    [32m'    at Object.handler (/root/vibeAgentGo/web/tests/agent.test.ts:213:15)\n'[39m +
    [32m'    at Agent.dispatchToolByName (/root/vibeAgentGo/web/src/core/agent.ts:576:17)\n'[39m +
    [32m'    at Agent._runInnerCore (/root/vibeAgentGo/web/src/core/agent.ts:452:33)\n'[39m +
    [32m'    at Agent._runInner (/root/vibeAgentGo/web/src/core/agent.ts:176:14)\n'[39m +
    [32m'    at Agent.run (/root/vibeAgentGo/web/src/core/agent.ts:146:14)\n'[39m +
    [32m'    at /root/vibeAgentGo/web/tests/agent.test.ts:225:20\n'[39m +
    [32m'    at file:///root/vibeAgentGo/node_modules/@vitest/runner/dist/chunk-hooks.js:752:20'[39m
}

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.tool.result] ← boom (6ms) {
  sessionId: [1mnull[22m,
  tool: [32m'boom'[39m,
  durationMs: [33m6[39m,
  result: [32m'Tool error: tool exploded'[39m,
  ok: [33mfalse[39m
}

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.session] Saved session 7a1a3b7b (4 messages) { sessionId: [32m'7a1a3b7b'[39m }

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.turn] Turn 2/5 { sessionId: [1mnull[22m }

stdout | tests/agent.test.ts > Agent > logs tool dispatch errors and continues the conversation
[agent.session] Saved session 7a1a3b7b (5 messages) { sessionId: [32m'7a1a3b7b'[39m }

 ✓ tests/agent.test.ts (8 tests) 63ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  07:21:05
   Duration  1.02s (transform 195ms, setup 58ms, collect 191ms, tests 63ms, environment 392ms, prepare 67ms)
[0m
All 8 tests pass. Let me do a final review of the changed section to confirm coherence.
[0m→ [0mRead web/src/core/agent.ts[90m [offset=68, limit=20][0m
Let me verify the full `run()` block reads coherently.
[0m→ [0mRead web/src/core/agent.ts[90m [limit=60, offset=108][0m
Alle drei Fixes sind umgesetzt. Typecheck (`tsc --noEmit`) fehlerfrei, ESLint nur 2 vorbestehende `any`-Warnings, alle 8 Agent-Tests gruen. Signatur von `run()` unverändert — CallSites in `AppController.ts` (Zeile 233, 475) haben bereits try/catch, daher keine Anpassung nötig.

**Geänderte Dateien:**
- `web/src/core/agent.ts` — Race-Guard via neuem `running`-Flag (paralleler `run()` wird abgewiesen und wirft; Flag + `doneEmitted` als Instanzfelder ergänzt), zentrale idempotente `done`-Emission über `emitDoneOnce()` im `finally` von `run()`, sowie isolierte Handler-Aufrufe in `emit()` mit try/catch pro Handler auf Snapshot-Kopie des Arrays.
