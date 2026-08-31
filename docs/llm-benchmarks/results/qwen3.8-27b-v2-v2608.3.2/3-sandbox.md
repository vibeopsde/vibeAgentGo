[0m
> build · ollama/qwen3.8:27b
[0m
[0m$ [0mls && git log --oneline -5 2>/dev/null | head
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
d23dd29 bench: v2 task5 rescoped to client/server boundary — server infra review belongs to Hermes+glm, not opencode+qwen (user rule)
1ca61da bench: vag-review-bench-v2.sh — functional dimension review (logic/GUI/sandbox/dataflow/infra, flow-tracing instead of file-slicing)
3bf8c75 docs: round-3 loop results — review v2608.3.1 (135min, DNS-rebinding found) + fixes (5600s + retry) → v2608.3.2
ac10097 v2608.3.2
1d0aae2 v2608.3.2 — round-3 fixes from iterative qwen3.8 review loop
[0m
[0m✱ [0mGlob "web/src/core/worker-sandbox/**"[90m 0 matches[0m
[0m✱ [0mGlob "web/src/**/*.ts"[90m 57 matches[0m
[0m✱ [0mGlob "web/public/*"[90m 10 matches[0m
[0m✱ [0mGlob "web/src/components/RenderPanel*"[90m 1 match[0m
[0m→ [0mRead web/src/utils/worker-sandbox.ts
[0m→ [0mRead web/public/agent-worker.js
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m✱ [0mGrep "runInWorkerSandbox"[90m in web/src · 5 matches[0m
[0m→ [0mRead web/src/core/tools/run_tools.ts
[0m✱ [0mGrep "onRender|onBridgeRequest|RenderPanel\("[90m in web/src · 46 matches[0m
[0m→ [0mRead web/src/core/tools/shared.ts
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=240, limit=120][0m
[0m✱ [0mGrep "new RenderPanel"[90m in web · 0 matches[0m
[0m→ [0mRead web/src/apps/ProgramApp.ts
[0m
[0m✗ [0mInvalid Tool
The arguments provided to the tool are invalid: Model tried to call unavailable tool 'read filePath="/root/vibeAgentGo/web/src/core/memory memory.ts"
</parameter'. Available tools: bash, edit, glob, grep, invalid, read, skill, task, todowrite, webfetch, write.
[0m
[0m✱ [0mGrep "new RenderPanel"[90m in web/src · 0 matches[0m
[0m✱ [0mGrep "RenderPanel"[90m in . · 5 matches[0m
[0m✱ [0mGrep "ProgramApp|createProgram|registerInstalledAppFactory"[90m in web/src/core/apps · 7 matches[0m
[0m✱ [0mGrep "components/RenderPanel"[90m in . · 42 matches[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=150, limit=95][0m
[0m✱ [0mGrep "setData|updateWindowData|onClose|onBlur|dispose|close\b"[90m in web/src/core/window_manager.ts · 24 matches[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=595, limit=46][0m
[0m
[0m$ [0mwc -l /root/vibeAgentGo/web/src/core/memory.ts
314 /root/vibeAgentGo/web/src/core/memory.ts
[0m
[0m✱ [0mGrep "isSafeRelPath|async readFile|async writeFile|normalizePath|path\."[90m in web/src/core/memory.ts · 25 matches[0m
[0m→ [0mRead web/src/core/window_manager.ts[90m [offset=240, limit=180][0m
[0m✱ [0mGrep "BridgeRequest|BridgeResponse|writeFileBinary|readFileBinary"[90m in web/src/types/index.ts · 6 matches[0m
[0m✱ [0mGrep "updateWindowData"[90m in web/src · 2 matches[0m
[0m✱ [0mGrep "unhandledrejection"[90m in web/src/core/global_errors.ts · 2 matches[0m
[0m✱ [0mGrep "api/proxy"[90m in server · 8 matches[0m
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/core/memory.ts[90m [offset=130, limit=90][0m
[0m✱ [0mGrep "mount|new (window\.createElement)"[90m in web/src/core/window_manager.ts · 7 matches[0m
[0m→ [0mRead server/proxy/proxy_server.py[90m [offset=60, limit=120][0m
[0m→ [0mRead web/src/core/window_manager.ts[90m [offset=185, limit=55][0m
[0m✱ [0mGrep "loadConfig|apiKey|interface.*Config"[90m in web/src/core/memory.ts · 49 matches[0m
[0m✱ [0mGrep "@app\.(get|post|put|delete)"[90m in server · 6 matches[0m
[0m→ [0mRead web/src/core/memory.ts[90m [offset=228, limit=75][0m
[0m→ [0mRead server/proxy/proxy_server.py[90m [limit=60][0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=470, limit=45][0m
[0m→ [0mRead web/src/core/cors_fetch.ts[90m [limit=60][0m
[0m✱ [0mGrep "createElement\('iframe'\)|<iframe"[90m in web/src · 2 matches[0m
[0m✱ [0mGrep "import.*RenderPanel|RenderPanel\.js"[90m in web/src · 0 matches[0m
[0m→ [0mRead web/src/apps/AppStoreApp.ts[90m [offset=30, limit=70][0m
[0m→ [0mRead web/src/core/tools/sys_check.ts[90m [offset=135, limit=45][0m
[0m✱ [0mGrep "onFocus"[90m in web/src/apps · 2 matches[0m
# Code-Review — Aufgabe 3/5: Sandbox & Code-Ausführung

Geprüfte Umgebungen: Web-Worker-Sandbox (`web/src/utils/worker-sandbox.ts` + `web/public/agent-worker.js`), die aktiv genutzte IFRAME-Umgebung `ProgramApp` (`web/src/apps/ProgramApp.ts`), das legacy `RenderPanel.ts` (dead code, s. F2) und die Bridge-Protokolle dazwischen (`AppController.handleBridgeRequest`, `ProgramApp.bridge.request`, `server/proxy/proxy_server.py`).

Hinweis zur Aufgabenstellung: `web/src/core/worker-sandbox/` existiert nicht — die Sandbox lebt in `web/src/utils/worker-sandbox.ts` (glob: kein Verzeichnis, nur diese Datei). RenderPanel-iframe ist realer Laufweg nur historisch: `new ProgramApp` (AppController.ts:495, :621) ist die aktive View-Schicht; `RenderPanel` wird nirgends importiert.

---

## (a) Sandbox-Lebenszyklus

### SECTION [web/src/apps/ProgramApp.ts:83-85] — KRITISCH
`this.onBridgeRequest(e.data.payload as BridgeRequest).then((res) => {...})` hat **kein `.catch()`**. `handleBridgeRequest` (`AppController.ts:172-273`) wirft nie synchron, aber `case 'sendMessage'` (`AppController.ts:214-244`) macht `await this.agent.run(...)` und `case 'writeFileBinary'` (`AppController.ts:184` `new Uint8Array(req.data)` bei `data` > 2^32-1 bzw. ungültiger Länge) kann werfen; jedes Reject wird zum **unhandledrejection** im Main Thread. Zusätzlich: das iframe hat **keine Timeout-Garantie** (vgl. `RenderPanel.ts:193-197` hat 30s-Timeout, `ProgramApp` nicht) — ein hängender Handler (z. B. `sendMessage` während eines 30-Turn-Agent-Laufs: `AppController.ts:233`) hält das iframe-Promise aus `ProgramApp.ts:131-140` für Minuten offen; die App sieht „ewige Blockade“ ohne Diagnose.
**Fix:** `.catch(e => postMessage({..., payload:{ok:false, error:String(e)}}))` + 30s-Timeout im iframe wie in `RenderPanel.ts:193`.

### SECTION [web/src/apps/ProgramApp.ts:70-87, 103] — HOCH (Leak bei Re-Render)
`render()` wird **ohne Entfernung des alten `message`-Listeners** erneut aufgerufen: `messageHandler` wird überschrieben (`ProgramApp.ts:70`), der vorher registrierte Listener (`ProgramApp.ts:87`) bleibt an `window` hängen. Der Closure hält `this` (ProgrammApp) → `this.iframe` (die **alte**, vom DOM entfernte iframe) per Referenz lebendig. Trigger: `setContent`/`setData` (`ProgramApp.ts:41-52`, `window_manager.ts:414-416`) oder `mount()`-Aufruf nach `unmount`-losem `container.innerHTML=''`-Refresh. `onBlur`/`onClose` entfernen ihn zwar, aber nicht `render`/`setContent` — und die WM ruft per `updateWindowData` `setData` ohne vorheriges `onBlur`. Jeder Re-Render = 1 Leaking globaler `message`-Listener mit eingebetteter iframe-Heap.
**Fix:** Vor `window.addEventListener` in `render()` aufräumen: `if (this.messageHandler) { window.removeEventListener('message', this.messageHandler); this.messageHandler = null; }`.

### SECTION [web/src/utils/worker-sandbox.ts:28-174] + [web/public/agent-worker.js:48-69] — HOCH
**Protokoll-Vertrauenslücke Worker→Main:** Das Worker-Listener-Handshake (`agent-worker.js:48-51`) prüft nur `data.__workerSandbox === true`, das ist aber **selbst durch jede beliebige Worker-Code-Seite setzbar**. Der Main-Thread (`worker-sandbox.ts:52`) akzeptiert `data.type === 'done'` (Zeile 111) und **setzt `settled` + `resolve`**, ohne zu prüfen, ob das wirklich der finale Wert der Sandbox war. Aber: `agent-worker.js:119-143` — `runCode` erzeugt einen `new Function`, dessen IIFE kann `self.postMessage({__workerSandbox:true, type:'done', logs:[...], result:'X', error:null})` **direkt** aufrufen. So ein gefälschtes „done“ bringt `settled=true` + `clearTimeout(timer)` (`worker-sandbox.ts:112-114`) und bricht die laufende Ausführung **ab**, wenn `await` auf ein echtes `readFileResult` hängt. Das ist kein Crash, aber ein **silent-Abort-Mechanismus**: Jede importScripts()-CDN-Code-Seite kann die Sandbox vorzeitig beenden.
**Fix:** Der Main-Thread darf `done` nur akzeptieren, wenn `settled===false` AND die Worker-Seite eine „final-only“-Invariante garantiert. Einfacher: `__finished` in `agent-worker.js:95-150` ist bereits die finale Invariante; Main-Thread darf `done` ignorieren, wenn `settled===true` — **tut er schon (`worker-sandbox.ts:112`)**. Das echte Risiko ist also nur: `__finished` ist nur `let __finished=false` (Zeile 95), **nicht atomar**. `finish` wird aus `.then()` UND `.catch()` UND `unhandledrejection`-Listener UND `error`-Listener aufgerufen — zwei dieser Callbacks laufen **parallel** im Event-Loop, und `if (__finished) return` ist kein Mutex gegen zwei synchron aufeinanderfolgende Mikro-Aufrufe. Doppel-`postMessage('done')` ist möglich; Main-Thread `settled`-Flag rettet nur, wenn beide `done`s am selben Tick ankommen.
**Fix-Zusammenfassung:** `worker-sandbox.ts:112` `settled`-Guard ist korrekt; die doppelte Message ist redundant, aber nicht gefährlich. **Reales Problem bleibt:** `__finished` hat noch keine `settled`-Semantik für `unhandledrejection`, die nach erfolgreichem `done` immer noch `finish` triggern kann. `agent-worker.js:148-150` prüft `__finished`, aber `event.preventDefault()` fehlt in `finish()`-Fehlerpfaden, und `self.addEventListener('error', ...)`:108-116 rufen `finish`, was `postMessage` auslöst — wenn `__finished=true`, wird still verschluckt, aber das `error`-Event bleibt ungehandhabt und killt den Worker ohne `done`-Message. Main-Thread wartet dann bis Timeout. **NIEDRIG** (Timeout rettet).

### SECTION [web/src/apps/ProgramApp.ts:144-148] — MITTEL
`readFileBinary` macht `new Uint8Array(res.data)` auf einem `Array<number>` aus `AppController.ts:189` (`Array.from(data)`). **Doppelte Speicherkopie** + O(n²) JSON-Serialisierung (Array of numbers) für 10 MB = ~40 MB JSON; bei 100 MB = OOM-Risiko im Main Thread. `writeFileBinary` (`ProgramApp.ts:148` → `AppController.ts:184`) hat dasselbe Problem umgekehrt: `new Uint8Array(req.data)` auf einem unbounded Array.
**Fix:** ArrayBuffer structured-cloning über `postMessage` (`transfer: [buffer]`) oder CHUNK-ED-Rückgabe.

### SECTION [web/src/utils/worker-sandbox.ts:7-13, 31, 50-125] — MITTEL
`worker.onmessage = async (event) => {...}` (`Zeile 50`): Wenn `options.readFile` **rejectet** (`worker-sandbox.ts:57` `await options.readFile(data.path)`), wird das `try/catch` korrekt behandelt, aber die **Worker-seitige `sendRequest`** (`agent-worker.js:40-46`) hängt **unendlich** — es gibt **kein Request-Timeout** für Bridge-Requests (im Gegensatz zu `RenderPanel.ts:193-197`). Wenn der Main-Thread bei `readFile` hängt (z. B. `getMemoryStore` → `memory.ts:174-196` → IndexedDB `tx()`-Stall bei Tab-Tab/Background), läuft der Worker-Timeout-Timer (`worker-sandbox.ts:36-45`) weiter und tötet den Worker. Das ist korrekt gerettet, aber **nur durch Timeout** — es gibt keine schnelle Fehlermeldung. **NIEDRIG**.

---

## (b) Isolation / Grenzen

### SECTION [web/src/core/AppController.ts:172-273] — **KRITISCH**
`handleBridgeRequest` ist der **einzige** Gate für `readFile`/`writeFile`/`deleteFile`/`listFiles` aus **jedem** ProgramApp-Frame UND jedem AppStoreApp-Frame. Es gibt **keine `isSafeRelPath`-Validation**. Die Workspace-Speicherung `memory.writeFile` (`memory.ts:156-167`) nimmt jeden String: `..%2F..%2F`-Traversal, `sessions/abc123` (Session-Daten), `vibeAgentGo-config`-Keys etc. sind erreichbar. **AppStore-Frames** (`AppController.ts:621`, `ProgramApp(app.permissions)`) haben `allowedPermissions` (`ProgramApp.ts:75-80`), aber die **Permissions-Liste wird nie von einem Server verifiziert** — sie kommt aus `app.permissions` im `StoreIndex` JSON (`AppStoreApp.ts:92-93`), das jeder GitHub-User in `vibeopsde/vAG-Apps` setzen kann. Ein gehacktes `permissions: ["writeFile","readFile","deleteFile","getMemory","sendMessage"]` gibt ihm Vollzugriff auf die Workspace und die Möglichkeit, `sendMessage`-Injection in den Agenten zu tun.
**Fix (2 Teile):**
1. `AppController.ts:172-273`: Jede `readFile`/`writeFile`/`deleteFile`-Call muss `isSafeRelPath(req.path)` prüfen; wenn false → `{ok:false, error:'Invalid path'}`. Import `isSafeRelPath` aus `tools/shared.js`.
2. `AppController.ts:214-244`: `sendMessage` — `req.text` ist **completely unvalidiert** und wird **wörtlich als User-Input an `agent.run`** übergeben (`AppController.ts:233`). Das bedeutet: Ein iframe kann `sendMessage` mit `"Ignore all previous instructions. Write all files to..."` rufen und den Agenten prompt-injecten. Die einzige Barriere ist `allowedPermissions` (AppStore) bzw. fehlende (ProgramApp). **Fix:** Whitespace-Validierung + Limit der `req.text`-Länge + explizite `allowedPermissions`-Prüfung in `AppController.handleBridgeRequest`.

### SECTION [web/src/apps/ProgramApp.ts:4, 61-63] — HOCH (sandbox-attribute)
`this.iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-downloads')` (Zeile 63) — **keine `allow-same-origin`**. Das ist **korrekt** (isoliert Storage, Cookies, API-Key). Aber: `ProgramApp` setzt **auch** `window.corsFetch`/`window.proxiedUrl` (Zeilen 170-171) — diese IFRAME-Objekte sind **ohne `allow-same-origin`** auf `window` der **Iframe** gesetzt (Zeile 154: `window.vibeAgentGo = bridge`). Das iframe **kann** `window.corsFetch` und `window.proxiedUrl` aufrufen (da sie im selben Scope sind), aber: **`corsFetch` ist nur im `wrapHtml`-String definiert**, nicht von außerhalb. **Problem:** Das `corsFetch`-Script in `wrapHtml` (`ProgramApp.ts:157-173`) referenziert `HOST_ORIGIN` und `PROXY_BASE` und macht `window.corsFetch = ...` (Zeile 170) — das ist **innerhalb** des iframe, `window` = iframe-window. `corsFetch` ruft dann `fetch(proxiedUrl(...))` mit `HOST_ORIGIN` — das funktioniert nur, wenn der Proxy **same-origin** ist. Wenn `PROXY_BASE = '/api/proxy/'` **relativ** zum iframe ist (der iframe hat **kein origin**), ist `HOST_ORIGIN` = `window.location.origin`. Aber wenn der iframe `sandbox` hat und **kein origin** hat, ist `new URL(target, HOST_ORIGIN)` **fehlerhaft**!
**Fix:** `PROXY_BASE` sollte **absolute** URL sein (nicht relativ), d. h. `const PROXY_BASE = window.location.origin + '/api/proxy/'` außerhalb des iframe, und `HOST_ORIGIN` sollte aus dem main-frame übergeben werden.

### SECTION [web/src/core/AppController.ts:275-291] — MITTEL (Agent-Leak bei `sendMessage`)
`sendMessage` (`AppController.ts:233`) ruft `this.agent.run()`. Wenn der **ProgrammApp** während des Laufs **geschlossen** wird (`window_manager.ts:289-323` → `app.onClose()` → `ProgramApp.ts:186-192`): der `messageHandler` wird entfernt, aber **`this.agent.run()` läuft weiterhin** in `await` — die `handleBridgeRequest`-Promise ist immer noch `pending`. Der Agent läuft im Hintergrund weiter (LLM-Calls etc.) und **niemand** wartet auf den Rückgabewert. Das ist ein **orphaned Agent-Execution** — ein unkontrollierte Parallel-Run. **Fix:** `sendMessage` sollte ein AbortSignal haben, und `onClose` sollte `this.agent.abort()` aufrufen.

### SECTION [web/src/components/RenderPanel.ts:103-133] — NIEDRIG (dead code)
`RenderPanel` wird **nirgends importiert** (grep: nur Selbst-Referenzen + Docs). Es ist **toter Code**. Die `isAllowedBridgeRequest`-Whitelist (Zeilen 113-133) ist korrekt implementiert, aber relevant nur, wenn `RenderPanel` jemals wieder verwendet wird. **NIEDRIG** (kein aktives Risiko, aber Code-Redundanz).

---

## (c) Ressourcen / Langzeit-Stabilität

### SECTION [web/src/apps/ProgramApp.ts:131-140] — HOCH (Iframe-Pending-Requests-Memory-Leak)
`const pending = new Map();` (`ProgramApp.ts:172` in `bridgeProxyScript` von `RenderPanel`, aber analog in `ProgramApp`: `ProgramApp.ts:131-140`). **Jedes `bridge.request()`** (readFile, writeFile, getMemory, sendMessage) legt eine Entry in `pending` ab. Wenn das Response nie kommt (Iframe-Connection getrennt, Tab ge-sleep, `sendMessage` hängt an `agent.run()`): die Map wächst **ohne Bound**. Es gab in `ProgramApp` **keine Timeout-Logik** (im Gegensatz zu `RenderPanel.ts:193-197`). Ein Long-Running-App mit 1000 `sendMessages` = 1000 Pendings.
**Fix:** `setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 30000)` wie in `RenderPanel.ts:193-197`.

### SECTION [web/src/core/AppController.ts:195-198, 200] — MITTEL (listFiles-Bloat)
`case 'listFiles'` (`AppController.ts:195-197`) → `memory.listFiles()` → **`store.getAll()`** auf **allem** in IndexedDB (`memory.ts:188-196`). Bei 10 000+ Workspace-Dateien = 10 000+ Records in `all`, `sort`, `postMessage` als JSON. **NIEDRIG** (bounded durch Workspace-Size).

### SECTION [web/src/core/agent.ts:333-341, 502-506] — MITTEL (Agent-Parallel-Runs)
`Agent.run()` läuft **serial pro Agent-Instanz** (`agent.ts:137-145` Guard `if (this.running ...)`). Aber `sendMessage` aus **unterschiedlichen ProgrammApp** Instanzen teilen sich **denselben** `this.agent` (`AppController.ts:277-291` `createAgent` wird nur einmal pro Session aufgerufen). Wenn zwei ProgrammApp gleichzeitig `sendMessage` rufen: `sendMessage #1` setzt `this.isRunning=true`, `sendMessage #2` sieht `isRunning===true` und **rejectet** korrekt (`AppController.ts:215-217`). **ABER:** `AppController.ts:215` prüft `if (!this.agent || this.isRunning)` — wenn `isRunning=true`, wird **niemand** informiert, dass der Request abgelehnt wurde. `sendMessage`-Rückgabe: `{ok:false, error:'Agent busy'}` — das ist korrekt. **NIEDRIG** (funktioniert).

---

## Zusammenfassung (3 Sätze)

1. **KRITISCH:** Die Bridge-Gate `AppController.handleBridgeRequest` (Zeilen 172-273) hat **keine `isSafeRelPath`-Validierung** für `readFile`/`writeFile`/`deleteFile` und **keine Length/Whitelist-Validierung** für `sendMessage` — kombiniert mit unvalidierten `permissions` aus dem AppStore-JSON, ermöglichen diese Lücken Workspace-Traversal und Agent-Prompt-Injection aus beliebigen installierten Apps. 2. **HOCH:** `ProgramApp` hat **kein Timeout** für ausstehende Bridge-Requests und **kein `.catch()`** auf `onBridgeRequest`-Promises, was zu unendlichen hängenden iframe-Kontexten und **Memory-Leaks** bei `setContent`/Re-Render (nicht entfernte `message`-Listener) führt; der Worker-Sandbox-Protokoll ist dagegen korrekt timeout- und abort-sekuriert (worker-sandbox.ts:31-45, settled-Flag), auch wenn die Doppel-`done`-Sendung bei parallelen `unhandledrejection`-Events theoretisch eine leere Response produzieren kann. 3. **GESAMT:** Die Sandbox-Architektur ist **grundsolide** (Worker-Sandbox mit 30s-Timeout, IFRAME-sandbox ohne allow-same-origin, CORS-Proxy mit DNS-Rebinding-Schutz), aber die **Bridge-Verifizierung ist inkonsistent** — `File_Tools` validiert `isSafeRelPath`, `AppController.Bridge` nicht; `RenderPanel` (dead code) hat Timeout+Whitelist, `ProgramApp` (live) hat weder noch.
