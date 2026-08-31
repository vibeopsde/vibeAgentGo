[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/core/tools/index.ts
I'll start by exploring the relevant files to understand the codebase structure.
[0m→ [0mRead web/src/core/llm_client.ts
[0m→ [0mRead web/src/core/prompt_builder.ts
[0m✱ [0mGlob "web/src/core/tools/*.ts"[90m 11 matches[0m
[0m✱ [0mGlob "web/src/**/*.ts"[90m 57 matches[0m
[0m→ [0mRead web/src/core/tools/file_tools.ts
[0m→ [0mRead web/src/core/memory.ts
[0m→ [0mRead web/src/core/tools/shared.ts
[0m→ [0mRead web/src/core/tools/run_tools.ts
[0m→ [0mRead web/src/utils/schema_validate.ts
[0m→ [0mRead web/src/core/tools/web_tools.ts
[0m→ [0mRead web/src/core/tools/rename_session.ts
[0m→ [0mRead web/src/core/tools/app_store_tools.ts
[0m→ [0mRead web/src/core/tools/memory_tools.ts
[0m→ [0mRead web/src/utils/worker-sandbox.ts
[0m→ [0mRead web/src/core/cors_fetch.ts
[0m→ [0mRead web/src/core/AppController.ts
[0m→ [0mRead web/src/i18n/index.ts[90m [limit=60][0m
[0m→ [0mRead web/src/types/index.ts[90m [limit=120][0m
[0m→ [0mRead web/src/apps/ChatApp.ts
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/core/db.ts
[0m→ [0mRead web/src/core/tools/system_tools.ts
[0m→ [0mRead web/src/core/tools/error_log.ts[90m [limit=80][0m
[0m→ [0mRead web/src/core/slash_commands.ts[90m [limit=120][0m
Ich habe alle benannten Flüsse end-zu-end durch den echten Code verfolgt (agent.ts, llm_client.ts, prompt_builder.ts, tools/*, worker-sandbox.ts, AppController.ts, ChatPanel.ts, memory.ts/db.ts als save-Gegenstelle). Alle Behauptungen habe ich gegen die Zeilen geprüft.

---

# Code-Review 1/5 — Agent-Logik & Steuerung

## Zustandsmaschine (Rekonstruktion)

**Zustände:** `IDLE → RUNNING → {STREAMING_TURN_n} ⇄ TOOL_EXEC → ... → DONE` bzw. `RUNNING → ABORTING → DONE`
**Übergänge (Kanten):**
- `IDLE → RUNNING`: agent.ts:144-151 (Voraussetzung: `!running || abortRequested`, Zeile 137)
- `RUNNING → STREAMING`: agent.ts:333 (pro Turn, Zeile 327)
- `STREAMING → TOOL_EXEC`: agent.ts:411-441 → 441-506 (Tool-Loop, sequenziell)
- `TOOL_EXEC → STREAMING`: agent.ts:508 (`continue`)
- `STREAMING → DONE`: agent.ts:511-524 + `emitDoneOnce` in finally (173-177)
- `RUNNING → ABORTING`: agent.ts:87-93 (`abort()` setzt `abortRequested`, `controller.abort()`, emittiert `abort`)
- `ABORTING → DONE`: llm_client wirft `AbortError` → agent.ts:343-350 / 378-384 (`running=false`, `'Aborted'`) → finally 173-177
- `RUNNING → ERROR_DONE`: LLM-Fehler agent.ts:396-407, Max-Turns 527-531 → Fehler-Event, Save, `done` via finally

**Geteilte Instanz-State** (alle pro *Instanz*, nicht pro *Run*): `sessionId` (40), `running` (45), `abortRequested` (46), `doneEmitted` (47), `abortController` (42), `currentHistory` (43), `currentRunSessionId` (44).

---

## Flow (a): Lebenszyklus eines Runs

### A1 [agent.ts:137 + 441-508 + 187-196] — KRITISCH — Doppelte Live-Runs: zweites `run()` während der erste nach Abort durchläuft
Die Guard auf Zeile 137 erlaubt ein Folge-`run()` explizit, wenn `abortRequested=true` (Kommentar 133-136). Das ist nur sicher, wenn der abbrechende Run **unmittelbar** stirbt. Das passiert aber nur, wenn der Abort während der LLM-Stream-Phase auftritt (`controller.signal` wird nur an `llmChatStream` übergeben, agent.ts:340/375). **Wird `abort()` während einer Tool-Ausführung aufgerufen (z. B. `run` mit 60 s Sandbox), stirbt der alte Run erst am nächsten Turn** — d. h. nach Tool-Ende, `saveCurrentSession` und erst beim nächsten `fetch` mit bereits abgebrachter Signal. In diesem Fenster (bis 60 s + verbleibende Tools des Batches) läuft der neue Run parallel. Konsequenzen, alle verifiziert:
1. agent.ts:193-195: `_runInner`-`finally` des alten Runs löscht `currentRunSessionId=null`, `currentHistory=[]` — **während der neue Run aktiv ist** (Shared-Fields, Run-Identität fehlt komplett).
2. agent.ts:343-349: der alte Run emittiert verzögert `error` → AppController.ts:315-321 setzt `isRunning=false`, `setRunning(false)`, Status `idle` **mitten im neuen Run**.
3. agent.ts:175/121-125: `doneEmitted` ist instanzweit — der alte Run feuert `done` (AppController.ts:332-339: `finalizeStream()`!) und setzt `doneEmitted=true`, wodurch das `done`-Event des **neuen** Runs unterdrückt wird.
4. **Datenverlust:** beide Runs schreiben dieselbe Session (`saveCurrentSession`, 539: `runSessionId || this.sessionId`) — der Spätsave des alten Runs mit dem älteren History-Array überschreibt den neueralten Save des neuen Runs (last-writer-wins in memory.ts:107-115, kein Versionsvergleich).
**Fix:** Run-Identität einführen: `private runSeq = 0`; in `run()` `const runId = ++this.runSeq`; nach jeder Await-Grenze in `_runInnerCore` prüfen `if (runId !== this.runSeq || controller.signal.aborted) return;`; `_runInner`-`finally` nur räumen, wenn `this.currentRunSessionId === runSessionId`; `doneEmitted` pro Run (lokal in `run()`, nicht Feld); Guard auf 137 durch aktive-Run-Zähler ersetzen (`activeRuns > 0 && !abortRequested` → reject), sodass die Folge-Run-Fensterlogik den tatsächlichen Abschluss des alten Runs erwartet.

### A2 [agent.ts:342-350, 377-384] — MITTEL — Abort mid-Stream: Teil­output und User-Nachricht gehen im Persist-Store verloren, UI behält sie
Der Abort-Pfad emittiert `error` und `return 'Aborted'` **ohne `saveCurrentSession`**. Der bereits streamte Teiltext wird in der UI behalten (AppController.ts:341-346 → ChatPanel.finalizeStream, ChatPanel.ts:298-313), aber weder er noch die zugehörige User-Nachricht (die erst bei Tool-Checkpoint 469/505 oder final 517 persistiert wird) landen in der Session. Nach Reload/Resume fehlt beides → UI-Historie und persistierte Historie weichen dauerhaft ab; der LLM-Kontext hat die User-Nachrift nie „beantwortet“ erhalten.
**Fix:** `llmChatStream` bei `AbortError` den bis dahin akkumulierten `fullContent` mitschaffen (z. B. `e.partialContent`), im Agent-Abort-Block als `assistant`-Nachricht in `history` pushen und `saveCurrentSession` aufrufen, bevor `'Aborted'` zurückgegeben wird.

### A3 [agent.ts:527-531 + 173-177] — NIEDRIG — Max-Turns und Error-Pfade feuern trotz Fehler `done` (inkl. „Fertig“-Sound)
`emitOnce` im `finally` (175) ist auf allen Pfaden das selbe Event; AppController.ts:332-339 unterscheidet nicht zwischen Erfolg und Fehler (spielt `sounds.play('done')`, Status `idle`). Die Fehlermeldung selbst kommt über das `error`-Event (315-321) — Funktionell heil, aber der Zustand „fehlschlagener Run“ ist für Zuhörer nicht mehr von „erfolgreich“ zu trennen (z. B. Bridge-`sendMessage`, AppController.ts:214-244, bekommt `ok:true`, weil `run` den Fehlertext als String liefert statt zu werfen).
**Fix:** `done`-Event um `status: 'ok' | 'error' | 'aborted'` erweitern (Payload-Feld in agent.ts:23), Bridge-Pfad danach `ok:false` liefern.

### A4 [llm_client.ts:69-71] — NIEDRIG — Abort-Verzögerung: Backoff-Sleeps ignorieren das Signal
`fetchWithRetry` schläft zwischen Retries (`sleep(backoffMs * 2**attempt + jitter)`, max. ~2 s), ohne `signal.aborted` zu prüfen oder den Sleep abortbar zu machen; der Abort wirkt frühestens beim nächsten `fetch`. Zusätzlich wird der Reader bei Abbruch/Provider-Fehler nicht per `reader.cancel()` freigegeben (only `releaseLock`, llm_client.ts:286-292).
**Fix:** Sleep als `(signal)`-abortables `Promise.race`; im `finally` `reader.cancel().catch(()=>{})` ergänzen.

### A5 [agent.ts:355-360, llm_client.ts:143-150, 23-29] — MITTEL — Steuerlogik per Fehler-String-Sniffing
Das Bild-Retry-Kriterium ist `errMsg.includes('400') && (errMsg.includes('image') || ...)` — abhängig davon, dass der Provider „image“ ins Fehler-Textfeld schreibt. `isRetryableError` (llm_client.ts:23-29) matcht auf `'network'|'fetch'|'timeout'`; Browser wie Safari werfen bei Netzausfall z. B. `"Load failed"`, das matcht nicht → dort keine Retries für 429-ähnliche Netzausfälle. Auch `status` wird per Regex `/HTTP (\d+)/` aus der Message geparst (143) statt aus `Error.cause`/eigener Exception-Klasse.
**Fix:** strukturierte Fehler (`LlmHttpError {status, bodyText}`) definieren; Retry-Tests gegen `status`, Bild-Retry gegen Status + normalisierte Body-Klassifikation.

---

## Flow (b): Instance-State

### B1 [agent.ts:121-125 + AppController.ts:332-340, 152-162] — HOCH — `done` mit Platzhalter-`'unknown'` wird als echte Session-ID persistiert
`emitDoneOnce(runSessionId)` → `sessionId || 'unknown'` (agent.ts:124). Bei neuem Chat, der **vor** dem ersten `saveCurrentSession` abbricht/fails (z. B. A2-Szenario), ist `runSessionId=null` → `done {sessionId:'unknown'}`. AppController.ts:336-337 setzt daraufhin `currentSessionId='unknown'` und `persistLastSession('unknown')` → `localStorage['vibeAgentGo-lastSession']='unknown'`. Beim nächsten Start: `startApp → resumeSession('unknown')` (AppController.ts:593-596, 362-414) → `getSession('unknown')` liefert `null` → Chat wird geleet und ein „Geister-Sitzungspunkt“ bleibt in der Last-Session persistiert. Zusätzlich zündet der Vergleich AppController.ts:471 (`agent.getLastSessionId() !== this.currentSessionId` → `null !== 'unknown'`) bei jeder Folge-Nachricht eine unnötige Agent-Neuanlage (280/471-473).
**Fix:** `done` bei `runSessionId===null` mit `sessionId:null` emittieren; AppController-Handler persistiert `null` nur, wenn bisher keine echte ID gesetzt war; `persistLastSession` filtert `'unknown'`.

### B2 [agent.ts:534-570] — MITTEL — `this.sessionId` wird erst bei Save gesetzt — Lese-/Schreib-Fenster inkonsistent
`this.sessionId = id` (540) wird in `saveCurrentSession` mutiert, während `runSessionId` (Konstante aus 147-149) die Run-Identität trägt. `buildToolContext` liefert `env.sessionId` als Live-Getter (109-113) — korrekt —, aber `getRecentErrors` (573) und `saveCheckpoint` (580) lesen `this.sessionId`/`this.currentRunSessionId` aus, die in der Overlap-Situation (A1) von beiden Runs gleichzeitig bewegt werden. Zwischen „`session_saved` emittiert“ (563) und dem `done`-Event kann `this.sessionId` bereits durch einen Folge-Run überschrieben sein (neue Session bei neuem Chat), während `AppController.currentSessionId` noch die alte ID aus `session_saved` hält.
**Fix:** alle Lesepunkte auf den Run-Scoped `runSessionId` umstellen; `AppController.currentSessionId` ausschließlich aus `session_saved`/`done`-Ereignissen aktualisieren und nie rückwärts aus `Agent.sessionId` ableiten.

### B3 [agent.ts:45-47 + 348/382] — MITTEL — `running` wird an zwei Orten, `abortRequested` nur an einem, gesetzt
`running=false` wird sowohl im Abort-Pfad (348, 382) als auch im `finally` (176) gesetzt; `abortRequested` nur in `abort()` (89) und `run()` (145). In der Sequenz `abort() → Run stirbt langsam (A1) → zweites run() startet → erster `finally` läuft`, bleibt nach dem zweiten Start `abortRequested=false` (145) stehen, während `running` vom zweiten Run gehalten wird — die Guard-Logik auf 137 ist dann nur noch durch die Sequenz sicher statt durch Invariante.
**Fix:** `running` ausschließlich in `finally`; `abortRequested` ebenfalls nur in `run()`/`finally` zurücksetzen; beide invariant zu `runSeq` (A1) koppeln.

---

## Flow (c): Tool-Orchestrierung über mehrere Turns

### C1 [llm_client.ts:243-268, 301-326] — HOCH — Tool-Call-Merge indexiert per `tc.id` statt `tc.index`; Folge: leere Namen/zerhackte Args, `Unknown tool:`, Sort-Defekt
Zeile 246: `const idx = (tc.id as number) ?? 0;` — die OpenAI-Stream-Spezifikation liefert `index` (Zahl) pro Chunk, `id` nur im **ersten** Chunk pro Tool. Provider, die `id` nicht wiederholen (kanonisches OpenAI, viele Local-Endpunkte), erzeugen dann:
- Chunk 1 (`id:"call_x"`, name) → Map-Entry unter Key `"call_x"` mit (leeren) Args
- Chunk 2 (`index:0`, args-Teil) → `tc.id` fehlt → `?? 0` → Key `0` → **neue** Entry mit leerem Name und Teil-Args
Ergebnis: `toolCallMap` enthält zwei Einträge — `{name:"", args:""}` + `{name:"read_file" …}` bzw. die verteilten Fragmente — und `agent.ts:593` (`dispatchToolByName`) antwortet `Unknown tool: ` (leerer Name). Parallel-Tool-Case: mehrere Calls werden je nach `id`-Rhythmus durcheinandergemischt; der Sort auf 303-304 (`a - b`) mit gemischten String-/Number-Keys ergibt `NaN` → Reihenfolge undefiniert.
**Fix:** `const idx = typeof tc.index === 'number' ? tc.index : (tc.id ?? 0);` und Map-Keys einheitlich numerisch halten.

### C2 [run_tools.ts:12-46, web_tools.ts:27-70, app_store_tools.ts:45-56, memory_tools.ts via IndexedDB] — HOCH — Tools erhalten kein Abort-Signal; Bridge/Netz-Timeouts unbeschränkt
`ToolContext` (types/index.ts:60-69) hat kein `signal`-Feld. `runInWorkerSandbox` (worker-sandbox.ts:28-174) hat einen Total-Timeout (max. 60 s, run_tools.ts:101), aber `web_search`/`youtube_transcript`/`app_store_*` nutzen `fetch` ohne `AbortSignal` und ohne Timeout (web_tools.ts:28, 168; app_store_tools.ts:47, 160) — ein hängender Proxy/Netz-Call hält den Agent-Run unbeschränkt und ist per `abort()` nicht mehr erreichbar (Signal fehlt), was direkt in A1 mündet. Ebenso hält eine einzelne `readFile`/`writeFile`-Bridge-Antwort den Worker unendlich, bis der Total-Timeout abläuft — für die Wartezeit ist der Agent faktisch „gestorben“, aber noch `running=true`.
**Fix:** `ToolContext.ctx.signal` durchreichen und in `corsFetch`/`web_search`/Sandbox als `signal`/`cancelToken` verwenden; per-Netz-Call-Timeout (z. B. 20 s) ergänzen.

### C3 [worker-sandbox.ts:55-101, run_tools.ts:19-22] — MITTEL — Bridge-Pfade umgehen `isSafeRelPath`; Inkonsistenz zu File-Tools
`options.readFile`/`writeFile` mappen 1:1 auf `mem.readFile`/`mem.writeFile` (memory.ts:156-167) **ohne** `isSafeRelPath` (shared.ts:52-64), die `read_file`/`write_file`/`patch` erzwingen (file_tools.ts:27-29, 117-119, 364-366). Sandbox-Code kann dadurch Workspace-Keys mit `..`- oder sonst „unsicheren“ Segmente anlegen, die die File-Tools anschließend als `unsafe path` zurückweisen — für das LLM ununterscheidbar, eigentlich aber les-/schreibbar. Kein echter FS-Escape (KV-Store), aber eine echte Zustands- und Konsistenzlücke.
**Fix:** `readFile`/`writeFile`-Callback in `run_tools.ts` um `isSafeRelPath(path)`-Check wickeln und bei Verletzung eine Bridge-Fehlerantwort an den Worker zurücksenden.

### C4 [agent.ts:441-474 + 591-599 + schema_validate.ts:9-31] — MITTEL — Tool-Fehler-Pfade: validierte Type vs. LLM-Realität
`validateArgs` (594) lehnt unerwartete Parameter und Typparameter strikt ab (schema_validate.ts:22-30). LLMs geben regelmäßig `offset` als String `"100"`, `limit` als `"20"` oder leere `""`-Objekte — `asNumber` (shared.ts:17-19) akzeptiert nur echte Numbers, sonst Fallback; ein Typparameter wird also **vorher** abgewiesen. Das LLM muss self-corrigiren — bei Max-Turns-Druck (A) ein reiner Robustheitsverlust, nicht ein harter Fehler.
**Fix:** für bekannte numerische Felder vor der Validierung `String→Number`-Coercion vorlegen, oder `validateArgs` numerische Strings tolerieren.

### C5 [agent.ts:471-505] — NIEDRIG — Tool-Ergebnis-Typverifikation fehlt; falsche Return-Typen fließen in History
`result` von `dispatchToolByName` wird ungeprüft als `string` nach `history.push({role:'tool', content: result})` (501). Ein Tool, das `undefined`/`null`/Objekt liefert (Typparameter, Bug in Custom-Tool), landet in IndexedDB und wird beim nächsten LLM-Call als JSON `null`/Objekt serialisiert → Provider-400 oder Kontext-Verzerrung. Alle Default-Tools liefern Strings, aber die Schutzlücke ist real.
**Fix:** `typeof result === 'string' ? result : JSON.stringify(result)` vor dem Push; leere Strings als `'(empty result)'` ersetzen.

---

## 3-Satz-Zusammenfassung

Die Grundarchitektur (event-basierter Agent-Loop, Checkpointing, Schema-Sanitisation, Sandbox) ist durchdacht und überwiegend korrekt, aber die **Instanz-State-Fields sind pro Agent, nicht pro Run** — das erzeugt in genau dem von der Guard explizit erlaubten Fenster (zweites `run()` nach `abort()` bei noch laufendem altem Run) einen deterministischen Parallel-Run-Zustand mit UI-Korruption, unterdrücktem `done`-Event und Session-Data-Loss (A1/B2/B3). Die zwei unabhängig davon kritischen Einzelstellen sind der **Tool-Call-Streaming-Merge per `tc.id`** (C1) und das **fehlende `signal`/Timeout in der Tool-Schicht** (C2) — beide brechen die Steuerungslogik bei realistischen Netzwerk- und Provider-Szenarien. Priorisiertes Fix-Programm: A1 → C1 → B1 → C2, danach B2/B3 für State-Konsolidierung; das Rest ist gehärtet, aber nicht robust gegen Provider- und Browser-Variation.
