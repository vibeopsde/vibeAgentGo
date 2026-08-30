[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m✱ [0mGrep "RenderPanel"[90m in web/src · 5 matches[0m
[0m✱ [0mGrep "dispose|removeEventListener|closeWindow|close\("[90m in web/src · 27 matches[0m
[0m→ [0mRead web/src/apps/ProgramApp.ts
[0m→ [0mRead web/src/core/window_manager.ts[90m [offset=260, limit=80][0m
[0m✱ [0mGrep "RenderPanel|render-panel"[90m in . · 49 matches[0m
[0m✱ [0mGrep "onBridgeRequest|vibeAgentGoBridge"[90m in web/src · 42 matches[0m
[0m✱ [0mGrep "BridgeRequest"[90m in web/src/types/index.ts · 1 match[0m
[0m✱ [0mGrep "type: 'readFile'|case 'readFile'|req\.type|request\.type"[90m in web/src/core · 3 matches[0m
[0m→ [0mRead web/src/types/index.ts[90m [offset=140, limit=20][0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=160, limit=80][0m
All three problems confirmed. Now implementing the fixes.
[0m
[0m← [0mEdit web/src/components/RenderPanel.ts
Index: /root/vibeAgentGo/web/src/components/RenderPanel.ts
===================================================================
--- /root/vibeAgentGo/web/src/components/RenderPanel.ts
+++ /root/vibeAgentGo/web/src/components/RenderPanel.ts
@@ -41,8 +41,9 @@
 private emptyEl: HTMLElement;
 private views: ViewTab[] = [];
 private activeTitle: string | null = null;
 private onBridgeRequest?: BridgeHandler;
+private messageHandler: ((event: MessageEvent) => void) | null = null;
 
 constructor(options: RenderPanelOptions = {}) {
   this.onBridgeRequest = options.onBridgeRequest;
 

[0m
Now the bridge hijack + listener reference (fix 2 & 3). I'll rewrite `attachMessageListener` to store the handler, check `event.source`, and validate requests.
[0m← [0mEdit web/src/components/RenderPanel.ts
Index: /root/vibeAgentGo/web/src/components/RenderPanel.ts
===================================================================
--- /root/vibeAgentGo/web/src/components/RenderPanel.ts
+++ /root/vibeAgentGo/web/src/components/RenderPanel.ts
@@ -78,12 +78,15 @@
   this.attachMessageListener();
 }
 
 private attachMessageListener() {
-  window.addEventListener('message', (event: MessageEvent) => {
+  this.messageHandler = (event: MessageEvent) => {
     const data = event.data;
     if (!data || typeof data !== 'object') return;
 
+    // Only trust messages coming from our own sandboxed iframe.
+    if (event.source !== this.iframe.contentWindow) return;
+
     // Log capture from the iframe
     if (data.vibeAgentGoViewLog === true) {
       if (data.title && typeof data.title === 'string') {
         this.appendLog(data.title, {
@@ -97,13 +100,48 @@
     }
 
     // Bridge request from the iframe
     if (data.vibeAgentGoBridgeRequest === true) {
-      this.handleBridgeRequest(data.id as number, data.request as BridgeRequest, event.source as WindowProxy);
+      const id = data.id as number;
+      const request = data.request as BridgeRequest;
+      if (!this.isAllowedBridgeRequest(request)) return;
+      this.handleBridgeRequest(id, request, event.source as WindowProxy);
     }
-  });
+  };
+  window.addEventListener('message', this.messageHandler);
 }
 
+private isAllowedBridgeRequest(request: BridgeRequest): boolean {
+  if (!request || typeof request !== 'object') return false;
+  const type = (request as { type: unknown }).type;
+  const str = (v: unknown): v is string => typeof v === 'string';
+  switch (type) {
+    case 'readFile':
+      return str((request as { path?: unknown }).path);
+    case 'writeFile':
+      return str((request as { path?: unknown }).path) && str((request as { content?: unknown }).content);
+    case 'listFiles':
+      return true;
+    case 'getMemory':
+      return str((request as { query?: unknown }).query);
+    case 'getConfig':
+      return true;
+    case 'sendMessage':
+      return str((request as { text?: unknown }).text);
+    default:
+      return false;
+  }
+}
+
+dispose() {
+  if (this.messageHandler) {
+    window.removeEventListener('message', this.messageHandler);
+    this.messageHandler = null;
+  }
+  this.iframe.remove();
+  this.element.remove();
+}
+
 private async handleBridgeRequest(id: number, request: BridgeRequest, source: WindowProxy) {
   if (!this.onBridgeRequest) {
     source.postMessage(
       { vibeAgentGoBridgeResponse: true, id, response: { ok: false, error: 'Bridge not configured' } },

[0m
Now fix 1 — the script injection in `setupLogCapture`.
[0m← [0mEdit web/src/components/RenderPanel.ts
Index: /root/vibeAgentGo/web/src/components/RenderPanel.ts
===================================================================
--- /root/vibeAgentGo/web/src/components/RenderPanel.ts
+++ /root/vibeAgentGo/web/src/components/RenderPanel.ts
@@ -236,8 +236,12 @@
   }
 
   private setupLogCapture(html: string, title: string): string {
     const bridgeScript = this.bridgeProxyScript();
+    // JSON.stringify escapes quotes/control chars but not the `</` sequence,
+    // which would close the surrounding <script> element. Escape it to a
+    // unicode escape so a crafted title cannot break out into a new script.
+    const safeTitle = JSON.stringify(title).replace(/</g, '\\u003c');
     const captureScript = `
 <script>
 (function() {
   const send = (level, args) => {

[0m
[0m← [0mEdit web/src/components/RenderPanel.ts
Index: /root/vibeAgentGo/web/src/components/RenderPanel.ts
===================================================================
--- /root/vibeAgentGo/web/src/components/RenderPanel.ts
+++ /root/vibeAgentGo/web/src/components/RenderPanel.ts
@@ -249,9 +249,9 @@
     if (a instanceof Error) return a.stack || a.message;
     return typeof a === 'object' ? JSON.stringify(a) : String(a);
   }).join(' ');
   const stack = args.find(a => a instanceof Error)?.stack || undefined;
-  parent.postMessage({ vibeAgentGoViewLog: true, title: ${JSON.stringify(title)}, level, message, stack, timestamp: new Date().toISOString() }, '*');
+  parent.postMessage({ vibeAgentGoViewLog: true, title: ${safeTitle}, level, message, stack, timestamp: new Date().toISOString() }, '*');
 };
 const levels = ['log','error','warn','info','debug','trace'];
 levels.forEach(level => {
   const orig = console[level] || console.log;

[0m
Now let me verify the changes compile. Let me check the build setup.
[0m$ [0mcd /root/vibeAgentGo/web && ls && cat package.json 2>/dev/null | grep -A15 '"scripts"'
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
[0m→ [0mRead web/package.json
[0m
[0m$ [0mcd /root/vibeAgentGo/web && npx tsc --noEmit 2>&1 | head -30
npm notice run npx
npm notice run 'tsc' --noEmit
[0m
Typecheck passes. Let me verify the final file state.
[0m→ [0mRead web/src/components/RenderPanel.ts[90m [offset=79, limit=80][0m
[0m→ [0mRead web/src/components/RenderPanel.ts[90m [limit=35, offset=237][0m
All three fixes are implemented and typecheck passes (`tsc --noEmit` clean).

Note: `RenderPanel` is no longer instantiated by the window manager (ProgramApp replaced it), so there is no live call site to wire `dispose()` into — it is implemented following the `onClose`/`unmount` removal pattern (ProgramApp.ts:186-192) so any disposal path can call it.

**Geänderte Dateien:**

- `web/src/components/RenderPanel.ts` — (1) `setupLogCapture` escape-t jetzt `<` zu `\u003c` im interpolierten `title` (`safeTitle`), wodurch `</script>`-Breakout unterbunden wird; (2) `attachMessageListener` prüft zuerst `event.source !== this.iframe.contentWindow` und validiert Bridge-Requests über neue `isAllowedBridgeRequest()`-Whitelist (Typ + Feldtypen) und verwirft ungültige; (3) Listener-Referenz wird in `messageHandler` gespeichert und neue `dispose()`-Methode entfernt den `message`-Listener gemäß unmount-Muster.
