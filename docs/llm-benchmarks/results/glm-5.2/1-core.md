[0m
> build · ollama/glm-5.2
[0m
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/core/llm_client.ts
[0m→ [0mRead web/src/core/prompt_builder.ts
[0m✱ [0mGlob "web/src/core/tools/**/*"[90m 11 matches[0m
[0m→ [0mRead web/src/core/tools/index.ts
[0m→ [0mRead web/src/core/tools/run_tools.ts
[0m→ [0mRead web/src/core/tools/web_tools.ts
[0m→ [0mRead web/src/core/tools/file_tools.ts
[0m→ [0mRead web/src/core/tools/memory_tools.ts
[0m→ [0mRead web/src/core/tools/shared.ts
[0m→ [0mRead web/src/core/tools/error_log.ts
[0m→ [0mRead web/src/core/tools/sys_check.ts
[0m→ [0mRead web/src/core/tools/rename_session.ts
[0m→ [0mRead web/src/core/tools/system_tools.ts
[0m→ [0mRead web/src/core/tools/app_store_tools.ts
[0m✗ [0mRead web/src/utils/worker-sandbox.js failed
[91m[1mError: [0mFile not found: /root/vibeAgentGo/web/src/utils/worker-sandbox.js
[0m→ [0mRead web/src/core/cors_fetch.ts
[0m✱ [0mGrep "interface ToolContext"[90m in web/src/types · 1 match[0m
[0m→ [0mRead web/src/core/global_errors.ts
Ich schaue mir ein paar Hilfsdateien an, um den Kontext zu vervollständigen.
[0m→ [0mRead web/src/types/index.ts[90m [offset=50, limit=30][0m
[0m✱ [0mGlob "web/src/utils/worker-sandbox.*"[90m 1 match[0m
[0m→ [0mRead web/src/utils/worker-sandbox.ts
# Code-Review: Core-Module (AUFGABE 1/4)

## SECTION [agent.ts:103-106] — KRITISCH
**Race Condition bei nebenläufigen `run()`-Aufrufen**
`this.abortController` und `this.sessionId` werden in `run()` ohne Synchronisation überschrieben. Wenn zwei `run()`-Aufrufe verschachtelt werden (z. B. Memory-Extraction im `extractMemoryFromConversation` startet LLM-Call während eine neue `run()` getriggert wird), überschreibt der zweite Aufruf den `abortController` des ersten. `abort()` würde dann den falschen Run abbrechen.
```typescript
this.sessionId = sessionId || this.sessionId || null;
this.abortController = new AbortController();
const runSessionId = this.sessionId;
const controller = this.abortController;
```
Der lokale `controller` wird weitergegeben — das ist gut. Aber `this.abortController` ist Instanz-Zustand; ein zweites `run()` ersetzt ihn, sodass `abort()` den ersten Run nicht mehr stoppen kann. Zudem überschreibt `extractMemoryFromConversation` (Zeile 597) asynchron die LLM-Verbindung ohne AbortSignal, während der nächste `run()` bereits laufen kann.
**Verbesserung:** Verwende eine Map von runSessionId→AbortController, oder blockiere weitere `run()`-Aufrufe, während einer läuft (Guard-Lock). Die Memory-Extraction braucht ihr eigenes AbortController, das nach `done` sofort abgebrochen wird.

## SECTION [agent.ts:469] — HOCH
**Unkontrolliertes Fire-and-Forget-Promise ohne Cleanup**
`this.extractMemoryFromConversation(history, config).catch(() => {});` startet einen asynchronen LLM-Aufruf, der nach dem `done`-Event weiterläuft und bei Tab-Crash/Neustart zu unbehandelten Promise-Rejections oder doppelten Memory-Einträgen führen kann. Er ist nicht abbrechbar und nicht mit dem Run-Lifecycle verknüpft.
```typescript
this.extractMemoryFromConversation(history, config).catch(() => {});
```
**Verbesserung:** Eigener AbortController für die Extraktion, der an `llmChatStream` übergeben und in `abort()` / beim nächsten `run()` abgebrochen wird. Logging im `catch` statt totschweigen.

## SECTION [agent.ts:88-95] — MITTEL
**`document`-Abhängigkeit im ToolContext macht Tests schwierig und kann stale sein**
`isDark: document.documentElement.getAttribute('data-theme') !== 'light'` wird einmal beim Context-Build gelesen. Wenn der Nutzer das Theme während eines langen Multi-Turn-Runs umschaltet, erhalten nachfolgende Tools den stale Wert.
```typescript
isDark: document.documentElement.getAttribute('data-theme') !== 'light',
```
**Verbesserung:** `isDark` als Getter-Funktion (`() => document.documentElement.getAttribute('data-theme') !== 'light'`) oder beim Tool-Aufruf neu lesen, wenn es dynamisch genutzt wird.

## SECTION [agent.ts:486] — MITTEL
**`randomUUID().slice(0,8)` als Session-ID kann kollidieren**
`const id = runSessionId || this.sessionId || randomUUID().slice(0, 8);` kürzt UUID auf 8 Hex-Zeichen → nur 32 Bit Entropie. Bei vielen Sessions steigt die Kollisionswahrscheinlichkeit. Dazu kommt, dass `saveCurrentSession` bei jedem Tool-Checkpoint aufgerufen wird — wenn durch eine Race `this.sessionId` null ist, wird eine neue Session-ID generiert, die von `runSessionId` abweicht.
```typescript
const id = runSessionId || this.sessionId || randomUUID().slice(0, 8);
this.sessionId = id;
```
**Verbesserung:** Volle UUID verwenden oder zumindest 12–16 Zeichen. Im `run()`-Scope eindeutig beim Start generieren und konsequent weiterreichen.

## SECTION [agent.ts:159-175] — MITTEL
**Attachment-Namen als Workspace-Pfad ohne Traversal-Schutz**
`await this.memory.writeFile(a.name, a.content);` verwendet den Attachment-Namen direkt als Pfad. Wenn ein Upload `../../config` oder `..%2Fsecret` heißt, hängt es vom `MemoryStore.writeFile` ab, ob Path-Traversal blockiert wird. Das ist ein direkter Schreibpfad außerhalb der Tool-Schema-Validierung.
```typescript
await this.memory.writeFile(a.name, a.content);
```
**Verbesserung:** `a.name` sanitizen (nur alphanumerisch, `_`, `-`, `/` innerhalb eines erlaubten Wurzelverzeichnisses), oder Attachment-Namen mit `crypto.randomUUID()` präfixen, ähnlich wie andere Tools.

## SECTION [llm_client.ts:39-73] — HOCH
**Retry-Logik überschreibt `lastError` beim Wurf nicht korrekt**
Wenn `fetchWithRetry` einen Non-Retryable-HTTP-Fehler wirft (Zeile 55), wird `lastError` neu gesetzt — korrekt. Aber im Catch-Block (Zeile 57–67) wird `lastError` nur initialisiert (`if (lastError === undefined)`). Wenn ein HTTP-400 folgt, dann ein Netzwerkfehler (retryable), wird `lastError` auf den HTTP-400-Fehler behalten — aber nach Retry-Limitierung wird der HTTP-400 geworfen, obwohl der letzte Fehler ein Netzwerkfehler war. Die Fehlermeldung ist dann irreführend ("HTTP 400" statt "network").
```typescript
if (lastError === undefined) { lastError = err; }
if (!isRetryableError(err) || attempt === retries) { throw lastError; }
```
**Verbesserung:** `lastError` bei jedem Fehler aktualisieren (`lastError = err`), oder den zuletzt aufgetretenen Fehler konsistent weiterreichen.

## SECTION [llm_client.ts:70] — MITTEL
**Backoff ohne Respect für `Retry-After`-Header**
Bei HTTP 429 (Rate Limit) wird mit fixem `backoffMs * 2 ** attempt + jitter` gewartet, aber der `Retry-After`-Header des Providers wird ignoriert. Das kann zu wiederholten 429s führen, wenn der Provider längere Pausen fordert.
```typescript
await sleep(backoffMs * 2 ** attempt + jitter);
```
**Verbesserung:** Bei 429 den `Retry-After`-Header auslesen und als minimale Wartezeit verwenden.

## SECTION [llm_client.ts:158-285] — MITTEL
**Kein Timeout für den SSE-Stream-Lese-Loop**
Die `while(true)`-Schleife liest den Stream bis `done`. Wenn der Provider die Verbindung offen hält ohne Daten zu senden (slow loris) und kein `signal`-Timeout konfiguriert ist, blockiert der Aufruf unbegrenzt. `opts.signal` wird nur an `fetchWithRetry` weitergegeben — ein Abbruch nach dem ersten Response kommt beim `reader.read()` nicht an (Browser respektieren das meist, aber nicht garantiert).
```typescript
while (true) {
  ...
  const readResult = await reader.read();
```
**Verbesserung:** Einen Idle-Timeout mit `setTimeout` um `reader.read()` legen, der bei Inaktivität (z. B. 60s kein Chunk) `reader.cancel()` aufruft.

## SECTION [llm_client.ts:19] — NIEDRIG
**`sanitizeHeader` löscht legitime non-ASCII-Zeichen aus API-Keys**
`return str.replace(/[^\x20-\x7E]/g, '');` entfernt alle Zeichen außerhalb ASCII 0x20–0x7E. Wenn ein API-Key oder BaseURL legitime Unicode-Zeichen enthält (selten, aber bei einigen Providern möglich), wird er still verfälscht und die Authentifizierung schlägt mit kryptischer 401-Meldung fehl.
**Verbesserung:** Stattdessen nur Steuerzeichen (0x00–0x1F, 0x7F) und explizit problematische Codepoints entfernen. Bessere Fehlermeldung, wenn der Header nach Sanitizing leer ist.

## SECTION [prompt_builder.ts:78] — MITTEL
**Feste App-Store-URL und Proxy-Pfad im System-Prompt als Hardcode**
Der System-Prompt enthält `/api/proxy/?url=ENCODED_URL` und `https://vag.vibeops.de/api/youtube/` fest im Text. Wenn sich diese Endpunkte ändern (Umgebungen, Self-Hosting), muss der Prompt-Builder-Code angepasst werden, anstatt konfigurierbar zu sein. Außerdem leakt die Produktions-URL in jeden Chat.
```typescript
CORS: Never use public third-party CORS proxies ... /api/proxy/?url=ENCODED_URL
```
**Verbesserung:** Proxy-Base-URL und YouTube-Proxy aus `cors_fetch.ts`/Config injizieren, nicht hardcodieren.

## SECTION [file_tools.ts:174-193] — HOCH
**`new Function(content)` als "Syntax-Check" führt beliebigen Code aus**
`tryValidateFileSyntax` kompiliert TS/JS-Dateien mit `new Function(content)` — das kompiliert den Code im globalen Scope (V8 JIT) und kann Side-Effects über Getter/Template-Literals/Top-level-await-Polyfills haben. Für TS-Dateien ist es ohnehin unzuverlässig (TS-Syntax wirft fälschlich Fehler), und für JS ist es ein unnötiges Sicherheitsrisiko.
```typescript
new Function(content);
```
**Verbesserung:** Einen echten Parser (z. B. `acorn`) verwenden, oder den Syntax-Check ganz weglassen — der Agent sieht den Fehler nach dem nächsten `run` ohnehin.

## SECTION [file_tools.ts:80-81] — MITTEL
**`atob`-Decodierung von Base64 ohne Fehlerbehandlung**
`Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));` wirft bei ungültigem Base64 einen `DOMException`. Das wird vom umschließenden `try/catch` gefangen, aber die Fehlermeldung ("InvalidCharacterError") ist für den Nutzer uninformativ. Wenn `content` kein Data-URI und kein reines Base64 ist (z. B. ein PDF als text-Attachment), schlägt es fehl.
```typescript
const base64 = content.startsWith('data:') ? content.split(',')[1] : content;
const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
```
**Verbesserung:** Explizit prüfen, ob der Inhalt Base64-kodiert ist, und sinnvolle Fehlermeldung zurückgeben.

## SECTION [app_store_tools.ts:137] — MITTEL
**Installations-URL aus User-Input konstruierbar (SSRF / Pfad-Injektion)**
`const entryUrl = \`https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html\`;` setzt `app.path` direkt in die URL. `app.path` kommt aus dem Store-Index, aber wenn der Index manipuliert ist (MITM, kompromittiertes Repo), kann `app.path = "../../../private/file"` enthalten und beliebige GitHub-Pfade lesen. `corsFetch` routet dann den Request ohne Path-Validierung.
```typescript
const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html`;
```
**Verbesserung:** `app.path` gegen ein Whitelist-Pattern (z. B. `^[A-Za-z0-9/_-]+$`) validieren und `..` ablehnen.

## SECTION [web_tools.ts:147] — MITTEL
**YouTube-Proxy-URL hardcoded und nicht konfigurierbar**
`const proxyUrl = 'https://vag.vibeops.de/api/youtube/';` ist fest eincompiliert. Bei Self-Hosting / Offline-Betrieb schlägt das Tool fehl, und der Nutzer erfährt erst nach dem Aufruf davon. Im System-Prompt (prompt_builder.ts:78) wird behauptet, YouTube-Transcript sei "configured in Settings", aber tatsächlich ist die URL hardcoded.
```typescript
const proxyUrl = 'https://vag.vibeops.de/api/youtube/';
```
**Verbesserung:** URL aus `loadConfig()` lesen; wenn nicht gesetzt, klare Fehlermeldung zurückgeben.

## SECTION [web_tools.ts:28] — NIEDRIG
**`web_search` ohne AbortSignal**
`fetch('https://api.tavily.com/search', ...)` hat kein `signal`. Wenn der Nutzer `abort()` drückt während eine Web-Suche läuft, wird die Suche nicht abgebrochen und das Ergebnis kommt erst nach dem Abbruch zurück — es wird verworfen, aber Netzwerk-/Kostenressourcen werden vergeudet.
**Verbesserung:** `ctx` enthält kein `signal` — das ist ein architektonischer Punkt: Tool-Handler haben keinen Zugriff auf das AbortSignal des Runs. `ToolContext` um `signal?: AbortSignal` erweitern und in allen `fetch`-Aufrufen durchreichen.

## SECTION [worker-sandbox.ts:34] — MITTEL
**Worker-URL relativ zum Import-Modul — bricht bei Subpath-Hosting**
`new Worker('./agent-worker.js')` lädt den Worker relativ zur HTML-Basis-URL, nicht zum aktuellen Modul. Wenn die App unter einem Subpath gehostet wird (`/myapp/`), zeigt `./agent-worker.js` auf `/agent-worker.js` statt `/myapp/agent-worker.js`. Da der Worker nicht wiederverwendet wird, hat das auch Performance-Kosten.
**Verbesserung:** `new Worker(new URL('./agent-worker.js', import.meta.url))` verwenden, damit der Pfad modulrelativ ist.

## SECTION [worker-sandbox.ts:31-174] — MITTEL
**Worker wird pro Aufruf neu erzeugt — kein Worker-Pool**
Jeder `runInWorkerSandbox`-Aufruf erzeugt einen neuen Worker (`new Worker(...)`), der nach Ausführung terminiert wird. Bei vielen Tool-Aufrufen hintereinander entstehen Start-Up-Kosten und Memory-Allocations. Bei Abbruch durch Timeout wird `worker.terminate()` aufgerufen, aber nicht bei normalem Ende des Worker-Code, der den `done`-Post nicht sendet (z. B. Endlosschleife mit postMessage).
**Verbesserung:** Worker-Pool mit Wiederverwendung, oder zumindest Worker einmal erzeugen und über `postMessage({type:'run', ...})` steuern.

## SECTION [agent.ts:87] — HOCH
**`emit` mit unsicherem Cast gefährdet Typ-Sicherheit der Events**
`emit: (event, data) => this.emit(event as keyof AgentEventMap, data as AgentEventMap[keyof AgentEventMap])` castet beliebige Strings und Daten auf die Event-Map. Tools können dadurch beliebige Events emitten (z. B. `ctx.emit('done', {})`), was den Agent-Lifecycle aus dem Takt bringen kann.
```typescript
emit: (event, data) => this.emit(event as keyof AgentEventMap, data as AgentEventMap[keyof AgentEventMap]),
```
**Verbesserung:** `emit` im ToolContext auf eine Teilmenge erlaubter Events (`render_view`, `tool_result`) einschränken, oder die Typen strikt halten und Tools nur ein eingeschränktes Interface geben.

## SECTION [agent.ts:469 + 597] — MITTEL
**Memory-Extraction verwendet dasselbe Modell wie den Agent-Run**
`extractMemoryFromConversation` ruft `llmChatStream` mit `config.model` und `config.apiKey` auf — ein vollwertiger Chat-Completion-Call, der kostenpflichtig ist und das gleiche Modell verwendet. Bei kleinen Modellen, die JSON schlecht produzieren, schlagen die Parsings oft fehl (Zeile 609–613). Zudem gibt es kein Rate-Limiting zwischen Agent-Antwort und Extraktion — beide Calls können überlappen, wenn der Nutzer sofort die nächste Anfrage stellt.
**Verbesserung:** Extraktion mit einem kleineren/cheaper Modell konfigurierbar machen, dedupliziert gegenlaufende Extraktionen mit einem Lock.

## SECTION [agent.ts:416, 452, 464] — MITTEL
**Checkpoints speichern nach jedem Tool — I/O-Stau bei vielen Tools**
`saveCurrentSession(history, runSessionId)` wird vor und nach jedem Tool-Aufruf aufgerufen. Bei einem Run mit 10 Tool-Calls sind das 20 IndexedDB-Schreibvorgänge der kompletten History. Da `getSession` auch noch vorausgeht (Zeile 488), ist das 4 IDB-Operationen pro Checkpoint. Bei langer History wird das zum Bottleneck und blockiert die Event-Loop.
**Verbesserung:** History nur bei Änderung persistieren (Diff), oder die Checkpoint-Frequenz reduzieren (z. B. nur nach `tool_result`).

## SECTION [file_tools.ts:265] — NIEDRIG
**Patch mit leeren `removals` und `additions` überspringt Entfernung nicht**
`const removeCount = hunk.removals.length > 0 ? hunk.removals.length : 0;` — redundante Bedingung. Wenn ein Hunk nur `additions` (reines Einfügen) hat, ist `removeCount = 0` und `before.concat(additions).concat(after)` fügt ein — korrekt. Aber wenn `removals` und `context` beide leer sind, liefert `findContextIndex` `-1` zurück und wirft fälschlich "Could not find patch context". Ein reiner Add-Hunk ohne Kontext ist in V4A gültig.
**Verbesserung:** Wenn `context.length === 0 && removals.length === 0`, den Hunk am Anfang (oder mit einer Positionsmarkierung) einfügen, statt abzulehnen.

---

## Architektur-Zusammenfassung

Die Core-Architektur ist solide designt mit klarer Trennung zwischen Agent-Loop, LLM-Client und Tool-Layer; die durchgehende Event-Emitter-Strategie und IndexedDB-Checkpoints zeigen reife Überlegungen zu Resilienz gegen Tab-Crashes. Schwächen liegen bei der Concurrency-Kontrolle — es gibt keinen Guard-Lock für nebenläufige `run()`-Aufrufe und die Memory-Extraction läuft ungeachtet außerhalb des Run-Lifecycles — sowie bei fehlendem AbortSignal-Durchgriff zu Tool-Handlern, was Abbrüche unzuverlässig macht. Sicherheitsrelevant sind die Path-Traversal-Möglichkeiten bei Attachment-Namen und App-Store-IDs sowie der `new Function`-Syntaxcheck; diese sollten vor einer Produktionseinsatz harteneded werden.
