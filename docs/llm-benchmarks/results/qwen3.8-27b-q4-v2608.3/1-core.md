[0m
> build · ollama/qwen3.8:27b
[0m
[0m✱ [0mGlob "web/src/core/**/*"[90m 33 matches[0m
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/core/llm_client.ts
[0m→ [0mRead web/src/core/prompt_builder.ts
[0m→ [0mRead web/src/core/tools/index.ts
[0m→ [0mRead web/src/core/tools/shared.ts
[0m→ [0mRead web/src/core/tools/web_tools.ts
[0m→ [0mRead web/src/core/tools/memory_tools.ts
[0m→ [0mRead web/src/core/tools/sys_check.ts
[0m→ [0mRead web/src/core/tools/error_log.ts
[0m→ [0mRead web/src/core/tools/app_store_tools.ts
[0m→ [0mRead web/src/core/tools/rename_session.ts
[0m→ [0mRead web/src/core/tools/system_tools.ts
[0m→ [0mRead web/src/core/tools/file_tools.ts
[0m→ [0mRead web/src/core/tools/run_tools.ts
[0m→ [0mRead web/src/core/cors_fetch.ts
[0m→ [0mRead web/src/core/memory.ts
[0m✱ [0mGrep "agent\.run|\.on\('done'|'session_saved'|new Agent"[90m in web/src/core/AppController.ts · 9 matches[0m
[0m✱ [0mGrep "export function normalizeLanguage"[90m in web/src/i18n · 1 match[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=280, limit=75][0m
Vollständig gelesen: `agent.ts`, `llm_client.ts`, `prompt_builder.ts` sowie alle 11 Dateien unter `tools/` (+ Abhängigkeiten `memory.ts`, `cors_fetch.ts`, `AppController.ts` für Kontext). Hier das Review.

---

## Code-Review — vibeAgentGo Core (Agent-Loop, LLM-Client, Tools)

### KRITISCH / HOCH

**[file_tools.ts:184-192] HOCH — `tryValidateFileSyntax` verwirft gültige TS/ESM-Dateien**
`new Function(content)` parst den Inhalt als *Function-Body im Script-Kontext*. Dadurch (a) schlagen **alle TypeScript-Dateien** mit Type-Annotations fehl (z. B. `: string` → SyntaxError) und (b) **alle ES-Module** mit `import`/`export` an Top-Level (z. B. `import x from "y"`) → SyntaxError. Beides sind in der Praxis die Standardfall. Ergebnis: `patch`/`replace` auf realen `.ts`- und ESM-`.js`-Dateien wird **fälschlich abgelehnt** ("No changes were written") — die LLM-Änderung geht verloren. Das ist keine Sicherheitslücke (`new Function` parst nur, es wird nicht ausgeführt), sondern ein harter Funktions-Bug.
*Vorschlag:* TS mit echtem Parser (z. B. `@babel/parser` / `acorn` mit `sourceType: 'module'`, `ecmaVersion: 'latest'`) validieren, oder die Syntax-Prüfung auf echte, isolierbare Fälle beschränken und Fehler *warnend* statt *blockierend* zurückgeben.

**[llm_client.ts:185, 286-292] HOCH — TextDecoder nicht am Stream-Ende geflusht → verlorene/multi-byte-Zeichen**
`decoder.decode(value, {stream:true})` wird nur pro Chunk aufgerufen; es fehlt der finale `decoder.decode()` ohne `{stream}`-Flag in `finally`. Wenn ein Netzchunk einen Multi-Byte-UTF-8-Zeichen (Emoji, Umlaut, CJK) in der Mitte trennt und **dies das letzte Chunk** war, bleibt der unvollständige Code-Punkt im Decoder hängen und wird nie ausgegeben. Konsequenz: der *letzte* Teil des gestreamten Inhaltes/Tool-Arguments kann bei nicht-ASCII-Output verloren oder kaputt gehen, genau das für `memory_save`/`write_file` relevant.
*Vorschlag:* im `finally`-Block `buffer += decoder.decode();` aufrufen (Flush) und den Rest der Pipeline auf `buffer` laufen lassen, bevor `releaseLock()`.

**[agent.ts:497 / 158-160] HOCH — Doppelte `done`-Emission auf dem Erfolgspfad**
Im Final-Pfad wird `done` *direkt* über `this.emit('done', …)` (Zeile 497) geschickt. Der `finally`-Block von `run()` ruft anschließend `this.emitDoneOnce(runSessionId)`, und da Zeile 497 `doneEmitted` **nicht** auf `true` gesetzt hat, fires `emitDoneOnce` die `done` **ein zweites Mal**. `AppController.setupAgent` (`'done'`-Handler, AppController.ts:332-340) reagiert auf jedes `done`: `finalizeStream()`, `setStatus('idle')`, `setRunning(false)`, `persistLastSession`, `sounds.play('done')`. → Sound doppelt, `finalizeStream` doppelt, UI-Zustands-Switch doppelt. In den Fehler-/Abort-/MaxTurn-Pfaden ist es korrekt, weil dort nur `emitDoneOnce` im `finally` läuft — nur der Erfolgspfad bricht das "exactly once"-Versprechen.
*Vorschlag:* Zeile 497 durch `this.emitDoneOnce(this.sessionId)` ersetzen (oder `this.emitDoneOnce` an jeder Stelle nutzen, die `done` löst), damit der zentrale Flag-Mechanismus wirklich die einmalige Emission garantiert.

**[app_store_tools.ts:136-143] HOCH — `app_store_install` schreibt remote-gesteuerten Pfad ohne Validierung**
`basePath` wird aus dem **unverarbeiteten Remote-JSON-Index** (`app.category`, `app.id`) und `entryUrl` aus `app.path` (`https://raw.githubusercontent.com/.../apps/${app.path}/index.html`) gebaut — ohne dass `path`/`id`/`category` gegen absolute Pfade, `..`-Segmente oder Leerzeichen geprüft werden. Ein kompromittierter/bösartiger Index-Eintrag kann damit `id`/`path` so steuern, dass `mem.writeFile` an unerwartete Workspace-Pfade schreibt (z. B.-Kollision mit `apps/…` anderer Apps), und die installierte `index.html` wird ohne Manifest-/Berechtigungs-Prüfung in die Sandbox übernommen (XSS-Fläche, die die Sandbox als einzige Grenze setzt).
*Vorschlag:* `path`/`id` strikt validieren (keine `/` außer erwartete Struktur, keine `..`, Whitelist-Regex), `app.id` gegen einen Canonical-Regex prüfen und vor dem Abspielen das eingebettete Manifest + `permissions` prüfen, statt blind in die Sandbox zu geben.

---

### MITTEL

**[agent.ts:287] MITTEL — `ctx` wird vor dem Loop gebaut → `env.sessionId` im ersten Tool-Call `undefined`**
`buildToolContext()` (Zeile 287) snapshotted `env.sessionId = this.sessionId ?? undefined` **vor** dem Run-Loop. Bei einer *neuen* Session ist `this.sessionId` noch `null`; sie wird erst durch das erste `saveCurrentSession` (Zeile 517-518, aufgerufen in Zeile 447 **vor** dem Tool-Dispatch) gesetzt — aber `ctx` ist längst gebaut. Tools, die `ctx.env.sessionId` lesen, bekommen daher im ersten Durchlauf `undefined`. Direkt betroffen: `rename_session` (rename_session.ts:27) → liefert "Error: no active session to rename", obwohl gerade per System-Prompt ("Use early in the conversation") genau im ersten Zug gerufen. Der Resumed-Fall (bestehende `sessionId` Parameter) trifft den Bug nicht, weil `this.sessionId` dann vor Zeile 287 gesetzt ist.
*Vorschlag:* `ctx` pro Tool-Call neu bauen (`const ctx = this.buildToolContext();` direkt vor `dispatchToolByName`), oder `env.sessionId` als Getter/Funktion ausliefern, die `this.sessionId` live auflöst.

**[llm_client.ts:39-73] MITTEL — kein Request-Timeout; hängende Streams blockieren den Agenten endlos**
`fetchWithRetry` hat nur *Backoff-Sleeps zwischen Retries*; der eigentliche `fetch` und vor allem das anschließende `reader.read()` haben **keine Timeout-Semantik**. Ein Provider, der 200 + Header liefert und dann nicht streamt, hält `llmChatStream` (und damit `Agent.running = true`) unendlich — der einzige Exit ist der manuelle `abort()`-Klick. Das gleiche gilt für eine *gestartete* 428/5xx-Ki-Taste ohne Body (hier `isRetryableStatus` greift, ok), aber der Stream-Stall ist ungedeckt.
*Vorschlag:* eine `AbortSignal.timeout(ms)` (bzw. eigene Timeout-Logik) pro Read und pro Overall-Request einführen und den Timeout als `AbortError`/klare Meldung an `Agent` durchreichen.

**[agent.ts:500, 628-634] MITTEL — `extractMemoryFromConversation` ist unstrukturiert: kein Signal, kein Timeout, unbegrenzte Größe**
Nach Erfolg wird Fire-and-forget mit `.catch(() => {})` ein LLM-Call ohne `signal`/Timeout gestartet. Das Prompt enthält die **komplette History inkl. aller Tool-Results** (Zeile 610-624) — bei langen Läufen sind das häufig Megabytes an Tokens + Kosten, und ein hängender Provider hält das unsichtbare Promise + zugehörigen Memory-Store-Referenzen dauerhaft im Heap (leiser Memory-Leak), weil nichts es jemals löst.
*Vorschlag:* `signal` aus dem Lauf übergeben (oder eigene Timeout), die History auf die letzten N Einträge trimmen, und den Aufruf mit dem Agenten-Lebenszyklus koppeln (bei Abort/Neustart verwerfen).

**[cors_fetch.ts:13-22] MITTEL — Proxy-SSRF: `corsFetch`/`proxiedUrl` leiten beliebige Ziele an den eigenen Server-Proxy**
`proxiedUrl` prüft nur "gleiche Origin?". Alles andere — `file://`, `http://localhost:*`, `http://169.254.169.254/…` (Cloud-IMDS), interne 10./172.-Netze — wird auf `encodeURIComponent(url.href)` an `/api/proxy/?url=…` geroutet. Da `window.corsFetch` explizit für generierte Mini-Apps exponiert wird (cors_fetch.ts:46) und auch `app_store_install` es nutzt, ist ein `file:///etc/passwd`- oder IMDS-Fetch durch eine LLM-generierte App möglich.
*Vorschlag:* Auf dem Proxy eine Origin-/Host-Whitelist (nur http/https, keine loopback/link-local/IMDS/Dateisystem-Protokolle) erzwingen und im Client zusätzlich `http(s):`-Only prüfen, bevor `proxiedUrl` aufgerufen wird.

**[agent.ts:122-128] MITTEL — abgelehnte `run()`-Doppelaufrufe korrupte das in-flight-`done`-Tracking**
Wird `run()` auf **derselben** `Agent`-Instanz aufgerufen, während noch ein Lauf aktiv ist, nimmt der Reject-Pfad `emitDoneOnce(null)` — setzt `doneEmitted = true` auf `true` — und die `finally`-Logik des *echten* Laufs (Zeile 160) läuft dann durch, weil `doneEmitted` bereits `true` ist → der in-flight-Lauf emittiert **niemals** sein `done`. Damit hängt `AppController.isRunning` bei `true` (AppController.ts:338/345/319), `setStatus('idle')` kommt nie, Sound "done" fehlt. Nur erreicht, wenn zweimal auf *dasselbe* Objekt gerannt wird; AppController scheint neue Agent-Instanzen zu erstellen (`const a = new Agent(...)` bei AppController.ts:285), daher latent statt garantiert — der Klassencode ist trotzdem nicht idiomenssicher.
*Vorschlag:* im Reject-Pfad nicht `emitDoneOnce`, sondern nur `error` emittieren (und den in-flight-Lauf in Ruhe sein lassen); oder die "already running"-Ablehnung per `throw` ohne Side-Effects machen.

**[agent.ts:191-205] MITTEL — Anhangs-Pfade werden ohne Sanitisation in den Workspace geschrieben**
`this.memory.writeFile(a.name, a.content)` nutzt den rohen, LLM-/Nutzer-seitigen `a.name` als Key. Ein Name wie `../../critical.html` oder ein absoluter Pfad könnte dadurch andere Workspace-Dateien überschreiben (z. B. die App des Nutzers unter `apps/…`). IndexedDB begrenzt den *Scope*, die Kollisions-Oberfläche ist jedoch nicht klein.
*Vorschlag:* `a.name` auf einen flachen, sanitisierten Base-Name reduzieren (keine `/`, `..`, absolute Pfade; optional voranstellen mit `attachments/<uuid>/`).

**[memory_tools.ts:49, 52 + memory.ts:53-70] MITTEL — `memory_search` ohne Obergrenze + Voll-Scan**
`limit` wird nicht clamped (im Gegensatz zu `error_log.ts:26`, das auf 1..100 begrenzt). `limit * 4` fließt in `cursorByIndex(..., limit*4, 'prev')` bzw. `cursorAll(...)` (`searchAllMemory`, memory.ts:55 liest den **gesamten** Store), und `searchAllMemory(1000)` im `getAllMemory(200)` für `extractMemoryFromConversation` ebenfalls. Eine LLM, die `limit: 1e9` setzt, zwingt uns in einen Full-Scan mit unbegrenztem In-Memory-Puffer — CPU-/RAM-Last und Latenz, die über den Lauf auf den Haupt-Thread trifft.
*Vorschlag:* `limit` auf 50/100 wie `error_log` clampen und die Index-Queries als O(Limit) begrenzen, statt als O(Store).

---

### NIEDRIG

**[llm_client.ts:249-263] NIEDRIG — Tool-Call-`name` wird konkatiert, was bei nicht-OpenAI-konformen Providern kaputtgeht**
Die Logik akkumuliert `name += tcFunction.name` — korrekt, wenn der Provider `name` nur im *ersten* Chunk sendet und danach leere Strings (OpenAI-Verhalten). Ollama und ähnliche senden auf manchen Pfade die *komplette* `name` in jedem Segment; dann wird der Name zu "foofoofoo" und der nachfolgende `dispatchToolByName` liefert "Unknown tool". `arguments`-Konkatt ist korrekt.
*Vorschlag:* `name` nur setzen, wenn `existing` noch keinen non-empty Name hat (erstes-Winnt), `arguments` weiter konkattieren.

**[llm_client.ts:174-180] NIEDRIG — Mid-Stream-Netzfehler sind final, ohne Resume/Partial-Vertrag**
Ein `reader.read()`-Fehler nach Start des Streams löst `throw` → `Agent` behandelt es als Fehlschlag, gibt `Error during LLM request` zurück, und der teilweise akkumulierte `fullContent` wird verworfen. Das ist defensiv korrekt, aber bei einem hängenden/flackernden Stream auf langem Lauf ein harter Bruch.
*Vorschlag:* optional `fullContent` als "partial" zurückliefern (mit Kennzeichnung) oder einen Retry mit den bisher gesendeten Tokens als Präfix erlauben; mindestens: klaren `stream_interrupted`-Status emittieren, statt generischem Error.

**[cors_fetch.ts:46-48] NIEDRIG — Modulseiteneffekt bei Import: `window`-Zuweisung**
`window.corsFetch = …` läuft bei jedem Import dieser Modul-Kette aus (`app_store_tools` → `web_tools` → `cors_fetch`). In Worker-Kontexten, SSR oder Tests ohne `window` wirft das ein `ReferenceError` und blockiert den Import.
*Vorschlag:* hinter `typeof window !== 'undefined'` legen oder die Globalen auf `AppController`-Setup-Phase verlegen.

**[llm_client.ts:109 / web_tools.ts:32] NIEDRIG — inkoherente Header-Sanitisation**
`Authorization: Bearer ${config.searchApiKey}` (web_tools.ts:32) und `Authorization: Bearer ${sanitizeHeader(...)}` (llm_client.ts:137) unterscheiden sich: `sanitizeHeader` entfernt alle Nicht-ISO-8859-1-Zeichen, weil der Browser `fetch()` andernfalls wirft. Bei einem API-Key mit Umlaut/Nicht-ASCII-Copy-Paste wirft der Tavily-Call, und der Fehler kommt als "Search error: …" zurück (wird nicht abgefangen).
*Vorschlag:* einen zentralen `safeHeader()`-Helper in `llm_client.ts` exportieren und überall verwenden — inkl. `Authorization` in `web_tools`.

**[memory.ts:150, 149] NIEDRIG — leere Datei wird als "not found" geparst**
`readFile` gibt `result?.content || null` zurück → für eine 0-Byte-Datei `null` statt `''`. `read_file` meldet dann "File not found"; `run_app` (run_tools.ts:134-136) fängt es mit dem extra `trim()`-Check ab, aber die Semantik ist irreführend und `write_file` → `read_file` auf leerem Inhalt liefert die falsche Meldung.
*Vorschlag:* `result ? (result.content ?? '') : null`, also `has-key`-basiertes Null-Handling.

**[agent.ts:58-68 + AppController.ts:294-346] NIEDRIG — Event-Listener nie entbunden; Agent-Lebenszyklus hat kein Dispose**
`Agent` speichert `listeners` pro Instanz; `AppController.setupAgent` hängt Handler an, die auf `this` (AppController) und das aktive Chat-App referenzieren. Falls mehrere Agenten-Instanzen angelegt werden (z. B. nach Reset), ohne dass die alten verworfen werden, und falls `AppController` sie irgendwo hält, akkumulieren die Referenzbäume (tools, memory, listener-array) im Heap. Derzeit vermutlich einmalig, aber die Klasse hat keinen `removeAllListeners()`/`dispose()`.
*Vorschlag:* ein `dispose()` hinzufügen, das `listeners` leert, und AppController bei Neu-Aggenierung `agent.dispose()` aufrufen (bzw. `AbortController` + Listener-Kleanup in einem Rutsch).

**[web_tools.ts:28-33 & llm_client.ts:109] NIEDRIG — fehlende `Retry-After`-Achtung bei 429**
`isRetryableStatus`/Retry-Loop (llm_client.ts:31-72) hat nur feste Backoff `500 * 2^attempt + jitter`, kein Blick auf `Retry-After`-Header. Bei `429` mit explizitem `Retry-After: 30` schlägt der Client 3× zu früh zurück und riskiert 423/403 vom Provider.
*Vorschlag:* `Retry-After` (s oder HTTP-Date) parsen und als Lower-Bound für den Backoff nutzen.

---

### 3-Satz-Zusammenfassung der Architektur-Qualität

Die Core-Architektur (strammer Browser-Agent, SSE-Client, Tool-Registrierung via JSON-Schema) ist sauber getrennt, aber die *Fehler- und Zustandsmechanik* um den Agenten-Loop (`done`-Emission, `ctx`-Snapshot, abgelehnte Doppelaufrufe) ist an mehreren Stellen nicht idiomenssicher. Die größten Risikoflächen sind (a) Tool-Validierung mit `new Function`, die echte TS-/ESM-Artefakt-Fehlalarme erzeugt, und (b) die App-Store-Installation, die unverarbeitete Remote-Pfade direkt in den Workspace und die Sandbox übernimmt. Insgesamt ein solides, gut-getestetes Skelett, das aber eine engere "exactly-once + sanitized + validiert"-Schicht rund um Agent-State, Provider-Streaming und Store-Dateien braucht, bevor es produktionsstabil ist.
