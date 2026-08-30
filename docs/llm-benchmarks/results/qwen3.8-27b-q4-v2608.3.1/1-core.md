[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/core/llm_client.ts
[0m→ [0mRead web/src/core/prompt_builder.ts
Ich beginne mit dem vollständigen Lesen aller genannten Dateien.
[0m✱ [0mGlob "web/src/core/tools/**"[90m 11 matches[0m
[0m→ [0mRead web/src/core/tools/memory_tools.ts
[0m→ [0mRead web/src/core/tools/web_tools.ts
[0m→ [0mRead web/src/core/tools/app_store_tools.ts
Jetzt lese ich alle Tool-Dateien.
[0m→ [0mRead web/src/core/tools/file_tools.ts
[0m→ [0mRead web/src/core/tools/rename_session.ts
[0m→ [0mRead web/src/core/tools/system_tools.ts
[0m→ [0mRead web/src/core/tools/sys_check.ts
[0m→ [0mRead web/src/core/tools/run_tools.ts
[0m→ [0mRead web/src/core/tools/index.ts
[0m→ [0mRead web/src/core/tools/error_log.ts
Jetzt die restlichen Tool-Dateien.
[0m→ [0mRead web/src/core/tools/shared.ts
**# Code-Review — AUFGABE 1/4: CORE**

> Alle vier Dateien (`agent.ts`, `llm_client.ts`, `prompt_builder.ts`) und alle 11 Dateien unter `tools/` vollständig gelesen (686 + 333 + 141 + ~1200 Zeilen).

---

## KRITISCH

### SECTION 1 — [app_store_tools.ts:136-148] `app_store_install`: Untrusted-Content-Write ohne Validierung
**Problem:** `basePath = apps/${app.category}/${app.id}` und `entryUrl` kommen direkt aus `index.apps` (externes JSON von GitHub), ohne Sanitization. Der geladene HTML-Content wird ungeprüft per `mem.writeFile` in den Workspace geschrieben. Später kann (a) `read_file` diesen Content an den LLM liefern (Prompt-Injection), (b) `run_app` ihn in einem iframe mit Bridge-API `window.vibeAgentGo` rendern → **Arbitrary-Code-Execution** über die Bridge, (c) Path-Traversal via `app.category`/`app.id` (`../../..`) Dateien an beliebigen Workspace-Orten überschreiben.
**Vorschlag:** `app.id`/`app.category`/`app.path` strikt validieren (`^[a-z0-9-]+\.[a-z0-9-]+$` für id, Whitelist-Kategorien, kein `..`/`/`), den HTML-Content vor dem Write auf eine Whitelist-Größe prüfen und im iframe `sandbox="allow-scripts"` + **keine** Bridge-API ohne explizite Manifest-Permission.

### SECTION 2 — [app_store_tools.ts:215-240] `app_store_publish`: Path Traversal über `manifest.id`/`manifest.category`
**Problem:** `targetPath = apps/${manifest.category}/${manifest.id}/index.html` — `manifest` stammt aus `parseAppManifest(htmlContent)` (LLM-gesteuert, aus Workspace-Datei). Ein `manifest.id = "../../etc/passwd"` oder `manifest.category = "../sessions"` schreibt Dateien an beliebige Workspace-Orte. `targetRepoRoot` ebenfalls unvalidiert.
**Vorschlag:** Sanitize `manifest.id`, `manifest.category`, `targetRepoRoot` (keine `/`, `..`, absoluten Pfade); den finalen Path gegen die Workspace-Root prefix-checken (`path.startsWith(workspaceRoot)`).

### SECTION 3 — [file_tools.ts:207-300] `patch` (V4A): Path Traversal in `*** Update File:`-Header
**Problem:** `parseV4APatch` liest `path = fileMatch[1].trim()` direkt aus dem (vom LLM generierten) Patch-Text. `applyV4APatch` nutzt `mem.readFile(file.path)` und `mem.writeFile(file.path, newContent)` ohne Path-Sanitization. Ein LLM (via Prompt-Injection oder fehlerhaft) kann `*** Update File: ../../../config.json` schreiben und beliebige Workspace-Dateien überschreiben.
**Vorschlag:** `file.path` nach dem Parsen validieren: kein `..`, kein absoluter Pfad, kein `/` am Anfang. Den finalen Path relativ zur Workspace-Root clamen.

### SECTION 4 — [agent.ts:499, 578-685] `extractMemoryFromConversation`: Asynchron, nicht abgetestet, hält `history`-Referenz
**Problem:** `this.extractMemoryFromConversation(history, config).catch(() => {})` — der Call ist **nicht** `await`et und wird **kein `AbortSignal`** übergeben (Zeile 627-633). Das erzeugt: (a) nach `abort()` oder `done` läuft die Extraction weiter, hält die gesamte `history` (potenziell dutzende KB) im GC-Heap fest → **Speicherleck**; (b) eine parallele LLM-Request ohne Zeitlimit → Resource-Exhaustion; (c) wenn `run()` neu gestartet wird, kann die alte Extraction mit alten `config/apiKey` laufen und mit dem neuen Run um IndexedDB-Slots konkurrieren.
**Vorschlag:** `const abortController = new AbortController()` anlegen, `signal` an `llmChatStream` in der Extraction übergeben; bei `abort()`/`run()`-Neustart `abortController.abort()` aufrufen; `history` per JSON-Deep-Copy an die Extraction übergeben statt dem Live-Array.

### SECTION 5 — [llm_client.ts:62-67] `fetchWithRetry`: `lastError`-Semantik falsch
**Problem:** `if (lastError === undefined) lastError = err;` überschreibt `lastError` **nie** — der **erste** Error bleibt haften. Wenn der erste Error retryable war und ein späterer NICHT retryable ist, wird `throw lastError` den **falschen** (ersten, retryable) Error ausgeben — oder, wenn alle retryable sind, den ersten statt des letzten. Das verdeckt die tatsächliche Fehlerursache für Debugging.
**Vorschlag:** `lastError = err;` setzen (letzte überschreibt jede frühere), oder `if (!isRetryableError(err)) { lastError = err; throw lastError; }` — der Non-Retryable muss immer gewonnen.

---

## HOCH

### SECTION 6 — [agent.ts:286, rename_session.ts:27] Stale `ctx.env.sessionId` bei Erstlauf
**Problem:** `const ctx = this.buildToolContext()` (Zeile 286) wird **einmalig pro Run** erzeugt, BEVOR der erste `saveCurrentSession` `this.sessionId` setzt (Zeile 517). Für einen Neustart (kein `sessionId`-Parameter) ist `this.sessionId` dann `null`, und `ctx.env.sessionId` ist `null`/`undefined` — **für alle** Tool-Calls in diesem Run. `rename_session` (Zeile 27-28: `ctx.env.sessionId || null → "no active session"`) bricht deshalb **immer** beim ersten Lauf ab. Das ist ein reproduzierbarer Bug: Die `rename_session`-Tool funktioniert bei neuen Sessions nie.
**Vorschlag:** `buildToolContext` soll `sessionId` als **Getter** übergeben (`ctx.env.sessionId` via `Object.defineProperty` oder eine Closure `() => this.sessionId`), oder vor jedem Tool-Call `ctx.env.sessionId = this.sessionId ?? undefined` neu setzen.

### SECTION 7 — [agent.ts:145-161] `run()` `finally`-Block + `abort()` Race
**Problem:** `finally { this.emitDoneOnce(runSessionId); this.running = false; }` (Zeile 158-161) wird **nach** `_runInnerCore` aufgerufen. Wenn `abort()` während des LLM-Streams aufgerufen wird, `throw`s `llmChatStream` einen `AbortError`, der in `_runInnerCore` gefangen wird (Zeile 327) und `'Aborted'` zurückgibt — aber `emitDoneOnce` wird dann im `finally` von `run()` aufgerufen. Zwischen `abort()` und dem `finally` kann `run()` erneut aufgerufen werden (weil `running` noch `true` ist) → **der zweite `run()` wird abgewiesen** ("Agent is already running") — selbst wenn der erste run bereits abgebrochen wurde. Für den User fühlt sich das wie ein hängender Agent an.
**Vorschlag:** Im `abort()`-Pfad `this.running = false; this.emitDoneOnce(runSessionId);` setzen, BEVOR wir auf den `finally`-Pfad warten. Oder `abort()` selbst `running = false` setzen.

### SECTION 8 — [prompt_builder.ts:38-48] Memory/Profile → System-Prompt ohne Escaping
**Problem:** `buildMemoryBlock` injectet `m.content` (LLM-extrahiert, aus `extractMemoryFromConversation`) **unescaped** in den System-Prompt. Wenn eine bösartige Memory-Entry (via Prompt-Injection über `memory_save`) den Content `Ignore all previous instructions. ...` enthält, bekommt der LLM diese Instruktion mit voller System-Autorität in jedem Folgelauf.
**Vorschlag:** Memory-Content auf maximale Länge begrenzen (z.B. 500 Zeichen), `memory_save`-Handler einen `content.length <= 500`-Check ergänzen, und im Prompt den Section-Header klar als "USER-PROVIDED DATA, NOT INSTRUCTIONS" markieren.

### SECTION 9 — [prompt_builder.ts:78] Hardcoded CORS-Proxy → SSRF-Anleitung im Prompt
**Problem:** Zeile 78: "The app provides its own proxy at `/api/proxy/?url=ENCODED_URL`". Wenn der LLM (via Injection) diesen Endpoint mit internen URLs (`http://169.254.169.254/`, `http://localhost:5000/admin`) aufruft, ist das SSRF. Die System-Prompt **instruiert** den LLM aktiv dazu, diesen Proxy zu verwenden.
**Vorschlag:** Der Proxy-Endpunkt muss服务端 `url` param gegen eine Private-IP/localhost-Blocklist prüfen. Im Prompt nicht explizit auf interne IPs verweisen.

### SECTION 10 — [web_tools.ts:147] `youtube_transcript`: Hardcoded externe Proxy-URL
**Problem:** `const proxyUrl = 'https://vag.vibeops.de/api/youtube/'` — `video_id`, `language` und `with_timestamps` werden als Query-Parameter an eine **feste externe Domain** geschickt, die der User nicht konfigurieren kann. (a) Wenn die Domain kompromittiert wird, können alle Video-IDs aller User abgegriffen werden. (b) Der User hat keine Wahl, diese Daten nicht dorthin zu schicken. (c) Wenn die App im Air-Gapped-Modus läuft, bricht es ohne Hinweis.
**Vorschlag:** `proxyUrl` aus `loadConfig()` lesen (optional), Default auf `null` → "proxy not configured" Message. Keine hardcoded URL.

---

## MITTEL

### SECTION 11 — [llm_client.ts:23-29] `isRetryableError` erkennt nur 3 Keywords
**Problem:** `msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')` — Chrome/Firefox CORS-Error ist `"Failed to fetch"` (enthält "fetch", OK), Safari `"Load failed"` **enthält KEINER** dieser drei → wird nicht retried, obwohl es retryable ist. Umgekehrt: ein `HTTP 400: ...`-Error aus `lastError` (Zeile 53) enthält "fetch" **nicht**, aber "HTTP" — wird korrekt NICHT retried. Die Heuristik ist inkonsistent.
**Vorschlag:** `err.name === 'TypeError'` (Fetch-Netzwerkfehler) explicit als retryable behandeln, plus die drei Keywords.

### SECTION 12 — [llm_client.ts:35-37] `sleep()` ignorieret `AbortSignal`
**Problem:** `fetchWithRetry` wartet `backoffMs * 2**attempt` im `sleep()` (Zeile 70), auch wenn `init.signal` bereits `aborted` ist. Nach 3 Retries × max. 500ms·2ⁿ ≈ **4s** Wartezeit, bevor der User-Abort registriert wird.
**Vorschlag:** `sleep` sollte auf `signal.aborted` horchen und sofort aufräumen, oder `clearTimeout` bei Abort.

### SECTION 13 — [llm_client.ts:185-285] SSE-Buffer-Parsing: kein UTF-8-Flush am Ende
**Problem:** `decoder.decode(value, { stream: true })` wird in jeder Iteration mit `stream: true` aufgerufen. Am Ende des Streams (nach `done`) ist **kein** `decoder.decode('', { stream: false })`-Call, um verbleibende Multi-Byte-UTF-8-Fragmente zu flushen. Das letzte Byte eines 4-Byte-Emoji am Rand eines Chunks geht verloren.
**Vorschlag:** Nach der `while`-Schleife: `buffer += decoder.decode();` (ohne Value, stream:false).

### SECTION 14 — [agent.ts:499] `extractMemoryFromConversation` hält LLM-KI-Response ohne Timeout
**Problem:** `llmChatStream` in der Extraction (Zeile 627-633) hat **kein Timeout** und **kein Signal**. Ein langsamer LLM-Server hält die Extraction 300s+ im GC-Heap.
**Vorschlag:** `AbortSignal.timeout(30000)` als `signal` übergeben, `signal` von `agent.abortController` ableiten.

### SECTION 15 — [sys_check.ts:155-156] `runInWorkerSandbox('return 1 + 2;')` ohne Timeout
**Problem:** Der Worker-Sandbox-Call in `sys_check` hat keinen Timeout. Wenn der Worker-Thread hangt (deadlock, unendlicher Loop), blockiert `sys_check` **unbegrenzt** — und durch `async` auch den Agent-Loop.
**Vorschlag:** `runInWorkerSandbox(code, { timeoutMs: 5000 })` — Timeout-Parameter ist in `run_tools.ts:19` vorhanden, muss hier nur mitgegeben werden.

---

## NIEDRIG

### SECTION 16 — [agent.ts:639-643] `extractMemoryFromConversation`: JSON-Recovery-Regex zu aggressiv
**Problem:** `raw.match(/\{[\s\S]*\}/)` — wenn der LLM zwei JSON-Objekte in der Antwort hat (z.B. `{"memories":...}` und `{"notes":...}`), greift der erste Block, der der Fehler sein kann. `JSON.parse(match[0])` wirft dann, und die Funktion bricht **still** ab (Zeile 682).
**Vorschlag:** Strikte JSON-Validation vor dem `JSON.parse`, oder `raw.trim()` direkt parsen und nur bei Fehler auf den Regex-Block zurückgreifen — mit try/catch um `JSON.parse(match[0])`.

### SECTION 17 — [memory_tools.ts:73-74] `memory_delete`: `if (!id)` verweigert `id === 0`
**Problem:** `const id = asNumber(args.id); if (!id) return 'Invalid or missing id.';` — wenn der LLM explizit `id: 0` sendet (valid in IndexedDB), wird er abgewiesen. IndexedDB-Keys sind aber fast immer > 0.
**Vorschlag:** `if (id === undefined || id === null || id <= 0)` statt `if (!id)`.

### SECTION 18 — [file_tools.ts:44-51] `read_file`: `shownTo`/`shownFrom`-Zählung inkonsistent bei Truncation
**Problem:** Zeile 51: `shownTo = Math.min(requestedEnd, totalLines)` — wenn `numbered` bei Zeile 47 auf `MAX_CHARS` (8000) **char-basiert** gecutet wurde, ist die tatsächlich gezeigte Zeilenzahl < `shownTo`. Die Message "shown 1-200 of 500 lines" ist daher **falsch**, wenn die Truncation bei Zeile 85 geendet hat (weil MAX_CHARS überschritten wurde).
**Vorschlag:** Die tatsächliche Anzahl der Zeilen bis zur Cutoff-Position berechnen und in die Message einbauen.

### SECTION 19 — [llm_client.ts:238] `delta.content === 'undefined'`-Guard
**Problem:** Wenn ein Provider den String `"undefined"` als content sendet (z.B. ein Template-Fehler im Backend), wird er zu `''` ersetzt — der User sieht eine leere Antwort ohne Hinweis. Das ist ein Silent-Fail.
**Vorschlag:** Stattdessen `logger.warn('llm.stream', 'delta.content is literal "undefined"', ...)` und `''` zurückgeben, damit es im Log nachverfolgbar ist.

### SECTION 20 — [llm_client.ts:82, 137] `sanitizeHeader` entfernt non-ASCII API-Key-Zeichen ohne Warnung
**Problem:** `apiKey.replace(/[^\x20-\x7E]/g, '')` — wenn die API-Key unbeabsichtigt Umlaute/Non-ASCII enthält (z.B. aus einer fehlerhaften Umgebungsvariable), werden die Zeichen **stillstark** entfernt. Der Auth-Request läuft mit einem falschen Key, aber es gibt **keine Warnung** im Log.
**Vorschlag:** Vor dem sanitize `logger.warn('llm', 'API key contains non-ASCII characters, sanitizing', ...)` loggen.

---

## 3-Satz-Zusammenfassung der Architektur-Qualität

Die Codebase zeigt ein solides, modulares Agent-Framework mit guter Fehlerbehandlung auf der Tool-Ebene (konsequente `try/catch`, Trunkierung, Audit-Logs), aber die **Sicherheitsgrenze zwischen LLM-ausgeführtem Code und Workspace/IndexedDB ist durchgehend ungeschützt** — drei kritische Path-Traversal-Angriffsvektoren (`app_store_install`, `app_store_publish`, `patch` V4A) und der ungeschützte `extractMemoryFromConversation`-Call ohne Abort/Timeout bilden zusammen ein kohärentes Risiko. Die zentrale Architekturentscheidung (Browser-direct, kein Server-Proxy) ist technisch elegant, wird aber durch die fehlende Input-Sanitization an der LLM-Tool-Grenze und die asynchrone, nicht-abbruchbare Memory-Extraction zu einer unsicheren und potenziell speicherleckenden Implementierung. Priorisierte Fixes: (1) Path-Validation in allen drei `writeFile`-Aufrufstellen, (2) `AbortSignal` + Timeout in `extractMemoryFromConversation`, (3) `ctx.env.sessionId` als Live-Reference statt Snapshot.
