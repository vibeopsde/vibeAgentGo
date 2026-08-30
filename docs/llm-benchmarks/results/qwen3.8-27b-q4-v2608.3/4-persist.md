[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/db.ts
[0m→ [0mRead web/src/core/app_store_db.ts
[0m→ [0mRead web/src/core/memory.ts
[0m→ [0mRead web/src/core/workspace.ts
I'll read all the specified files first.
[0m→ [0mRead web/src/core/backup.ts
[0m→ [0mRead web/src/core/cors_fetch.ts
[0m→ [0mRead web/src/core/presets.ts
[0m→ [0mRead web/src/core/global_errors.ts
Now the remaining files.
[0m→ [0mRead web/src/main.ts
[0m✱ [0mGlob "web/src/core/logger.ts"[90m 1 match[0m
[0m✱ [0mGrep "api/proxy"[90m 25 matches[0m
Let me check the logger and any server-side proxy implementation to assess SSRF/recursion properly.
[0m✱ [0mGrep "registerGlobalErrorHandlers"[90m 7 matches[0m
[0m→ [0mRead web/src/core/logger.ts
Let me read the logger and the server-side proxy to complete the SSRF/recursion analysis.
[0m→ [0mRead server/proxy/proxy_server.py
# Code-Review — AUFGABE 4/4 · Persistenz + Infra

## `web/src/core/backup.ts`

### [backup.ts:174-176] **KRITISCH** — „All-or-nothing"-Import ist kein Transaction
Der Claim in den Kommentaren (Zeile 171-173) stimmt nicht: Memory-Einträge werden über `Promise.all(memory.map(m => this.saveMemoryRaw(m)))` als **N unabhängige Single-Row-Transaktionen** geschrieben, Sessions separat, Files sequentiell dazwischen. Bei `QuotaExceededError` (oder anderem Abbruch) beim z. B. 500. Eintrag bleibt ein **halbhergestellter Zustand** — ein Teil des Backups ist drin, der Rest fehlt, und es gibt kein Rollback.
**Fix:** Alles in **einer readwrite-Transaktion** über drei Object-Store-Referenzen (`db.transaction(['memory','sessions','files'], 'readwrite')`) schreiben — erst dann `localStorage`-Pins setzen. Alternativ: vor dem ersten Write alle Records in einen In-Memory-Staging-Bereich laden und erst nach Validierung in *einer* TX atomar commiten.

### [backup.ts:58] **HOCH** — Memory-Export wird stumm auf 10.000 Einträge gekappt
`this.memory.searchAllMemory(10000)` trunciert `memory.json`. Überlebt eine Datenbank >10.000 Memory-Entries den Export **stumm Datenverlust**, das `manifest` zeigt das nicht. **Fix:** `cursorAll('memory')` ohne Slice verwenden, und in `manifest.json` `memory_count_total` + `memory_count_exported` + `truncated: true/false` mitschreiben, damit Import/Export asymmetrisch sichtbar bleibt.

### [backup.ts:167-176] **HOCH** — Import-Order: localStorage vor DB, kein Rollback
`restoredConfig`, `theme` und `onboarding` werden in `localStorage` geschrieben, *bevor* IndexedDB-Restore läuft. Schlägt der DB-Restore fehl (Quota, CloneError, Abbruch), ist der App-State bereits überschrieben. **Fix:** localStorage-Write erst **nach** erfolgreichem, atomarem DB-Write setzen.

### [backup.ts:130-134] **MITTEL** — Kein Check, dass `manifest.workspace_id` dem aktiven Workspace entspricht
Ein Backup von Workspace A, das in Workspace B importiert wird, mischt beide Datenbestände still. **Fix:** `manifest.workspace_id !== getActiveWorkspace().id` → Warnung + Bestätigung (hard fail bei `--strict`).

### [backup.ts:298-301] **NIEDRIG** — `saveMemoryRaw` setzt `put` mit fremden `id`s
Bei ID-Kollision (zwei Backups mit verschobenen autoIncrement-IDs) werden ältere Einträge **überschrieben** statt vermerkt. **Fix:** `store.put` ist ok, aber vor dem Write prüfen: `getAllKeys()` + Diff; Kollisionen loggen.

---

## `web/src/core/db.ts`

### [db.ts:237-253] **HOCH** — `resetLocalData` löscht nur die active DB, nicht die anderen Workspaces
`getDbName()` baut den Namen *nur* für den aktuellen Workspace. `vibeAgentGo-agent-<anderer>` bleibt auf der Platte; die Funktion heißt „Reset all local data" und entfernt nur einen Bruchteil aller Daten. **Fix:** `listWorkspaces()` aus `workspace.ts` iterieren und je DB `deleteDatabase` feuern; oder explizit `resetDbForWorkspace(id)` als zweite Variante anbieten.

### [db.ts:24,27-42] **MITTEL** — Workspace-Wechsel-Race: alter Close + neue `openDB()` laufen überlappt
```ts
if (currentDbName !== null && currentDbName !== dbName) {
  if (dbPromise) { dbPromise.then(db => db.close()).catch(()=>{}); dbPromise = null; }
}
currentDbName = dbName;
if (dbPromise) return dbPromise;
dbPromise = new Promise(...);
```
Zwischen `dbPromise = null` und `dbPromise = new Promise(...)` kann ein anderer Task `openDB()` rufen, der seinen eigenen `indexedDB.open(...)` startet. Dann schließen sich **zwei** Opens parallel auf die *neue* DB; das erstgeschlossene überlebt, das andere wird verworfen. Gravierender: in-flight Transaktionen auf der alten DB bekommen `versionchange` → ihre `runTx`-Promises werden per `onabort` rejectet (gut), aber `cursorAll`/`cursorByIndex` (Zeile 166, 186) **haben keinen `onabort`-Handler** und hängen **ewig** (siehe unten). **Fix:** `dbPromise = (dbPromise ?? Promise.resolve()).then(reset).then(open)` — sequenziell kettengestalten, und `onversionchange`-Zustellende `onabort`-Handler in *jeder* Cursor-Promises ergänzen.

### [db.ts:166-184, 186-212] **MITTEL** — `cursorAll`/`cursorByIndex` fehlen `onabort` → dauerhafte Hänge
`runTx` (Zeile 121-148) hat explizite `transaction.onabort`-Behandlung mit dem Kommentar „Promise hangs forever — the agent stalls". Dasselbe Problem fehlt in den zwei Cursor-Implementierungen. Bei `versionchange` aus einem anderen Tab oder bei Quota-Abort **hängt** der Aufrufer blockiert; die UI zeigt ein leeres Lade-Icon, `currentSessionId` ist im Gedächtnis verloren, Reload nötig. **Fix:** `transaction.onabort = () => reject(transaction.error || new Error('Cursor aborted'))` in beide Funktionen; außerdem `withDBRetry`-Wrapper wie für `runTx` anwenden.

### [db.ts:101-119] **NIEDRIG** — `withDBRetry` setzt `dbPromise=null` **vor** dem Retry — verwaiste in-flight Tx wird nicht abgewartet
Der Retry erzeugt sofort einen neuen `openDB()`-Aufruf; die *alte* DB-Konnektion (die zu schließen der Grund für den Fehler war) schließt asynchron. In der Zwischenzeit kann die alte, noch offene Verbindung einen weiteren Abbruch-Event auslösen, der den *neuen* Retry-Pfad trifft. **Fix:** `await resetDBConnection()` vor dem zweiten `runTx`.

### [db.ts:86-91] **NIEDRIG** — `DB_RECOVERABLE_ERRORS` enthält `NotFoundError` — das ist KEIN Recoverable, sondern ein Bug
`NotFoundError` heißt „Object-Store existiert nicht" — ein Retry ändert nichts und verwirrt die Diagnose. `NotFoundError` entfernen; dafür `ConstraintError`/`InvalidAccessError` (keins davon ist aber Retry-fähig — besser: leer lassen und nur die Message-Checks behalten).

---

## `web/src/core/workspace.ts`

### [workspace.ts:184-276] **KRITISCH** — `copyDatabase` ist nicht atomar, Migration verliert bei Fehler Legacy-Daten
`migrateLegacyWorkspace` (Zeile 128) ruft (a) `saveWorkspaces([ws])` + `setActiveWorkspaceId('default')` und (b) `copyDatabase(old, 'vibeAgentGo-agent-default')` **sequenziell und ohne Transaktion**. Stürzt der Prozess zwischen (a) und (b) ab — oder die Copy schlägt bei Store Nr. 3 von 4 fehl — bleibt:
- `workspaces = [{id:'default'}]` in localStorage →
- `migrateLegacyWorkspace` sieht `workspaces.length > 0` und **early-returns bei jedem zukünftigen Start** →
- Legacy-DB `vibeAgentGo-agent` liegt unbenutzt auf Platte.

**Resultat: totaler, unwiederbringlicher Datenverlust.** **Fix:**
1. Copy **vor** dem Register (oder in try/catch: On-Failure `localStorage.removeItem(WORKSPACES_KEY)` + `deleteDatabase('vibeAgentGo-agent-default')`).
2. Copy in *einer* `readwrite`-Transaction über beide DBs — IndexedDB erlaubt das, wenn beide DBs offen sind und die Source-TX `readonly` ist.
3. Nach der Copy `sourceDb` per `indexedDB.deleteDatabase(oldDbName)` entfernen, damit es keine Zwei-Kopien-Gespenst-DBs gibt.

### [workspace.ts:99] **NIEDRIG** — DB-Namensschema doppelte Quelle der Wahrheit
`const dbName = 'vibeAgentGo-agent-${id}'` ist eine **Hardcode-Kopie** von `db.ts:13-16` (`getDbName`). Wenn `db.ts` mal `vibeAgentGo-ws-<id>` wird, stört `deleteWorkspace` die *falsche* Datei und die echte bleibt. **Fix:** `getDbNameWorkspaceId(id)` aus `db.ts` importieren und hier aufrufen.

### [workspace.ts:17-19] **NIEDRIG** — ID-Kollisionsfläche
`'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)` — 4 Buben (24 bits) Zufall reicht für zwei Workspaces in <1 s nicht, ist aber knapp. `crypto.randomUUID()` ist browserseitig überall verfügbar.

### [workspace.ts:91-113] **NIEDRIG** — `deleteWorkspace` löscht *vor* der active-Workspace-Ersatzprüfung; Fehlerfall: `filtered.length === 0`
Wenn z. B. `workspaces.length === 2` und `filtered` nach Filtern leer ist (sollte nach `if (workspaces.length <= 1) return false` gar nicht passieren, ist aber kein Defensiv-Check) → `setActiveWorkspaceId(filtered[0].id)` würde auf `undefined` schreiben. Aktuell unerreicherbar, aber eine `if (filtered.length === 0) { saveWorkspaces(workspaces); return false; }`-Safety wäre günstig.

---

## `web/src/core/memory.ts`

### [memory.ts:101-109] **HOCH** — `saveSession`: read-then-write-Race über zwei Transaktionen
```ts
const existing = await this.getSession(session.id);   // TX1 (readonly)
await tx('sessions','readwrite', s => s.put(toSave)); // TX2 (readwrite)
```
Zwischen den beiden Transaktionen kann eine andere `saveSession` denselben Session-Record schreiben — die eigene `created_at`-Priming überlebt nur, wenn *man selbst* letzter writer ist. **Fix:** `created_at` *inside* der readwrite-TX auslesen (`store.get(id)` + `store.put(...)` in **einer** readwrite-TX). Oder: beim ersten Write `created_at` setzen und späterer Updates nur `updated_at` touchen — die Read ist dann unnötig.

### [memory.ts:81-97] **MITTEL** — `updateMemory`: gleiche read-then-write-Lücke wie `saveSession`
Ebenso: `store.get` in readonly-TX, `store.put` in readwrite-TX. Zwei parallele `updateMemory(id, ...)`-Aufrufe verlieren Updates. **Fix:** in einer TX machen.

### [memory.ts:72-78, 132-139, 185-191] **MITTEL** — `deleteMemory`/`deleteSession`/`deleteFile` schlucken **alle** Fehler und geben `false` zurück
`catch { return false; }` — ein `QuotaExceededError` (Delete kann das nicht auslösen) oder `InvalidStateError` wird vom Aufrufer nicht unterschieden. `deleteMemory`-Return `false` wird in App-Code leicht mit „nicht vorhanden" verwechselt, obwohl die DB *funktional* ok ist. **Fix:** `captureWarn('memory.deleteMemory', ...)` + `logger`-Eintrag, dann `return false`; oder `return {ok: false, err}`-Shaped.

### [memory.ts:147-154] **NIEDRIG** — `readFile` gibt `null`, wenn `content === ''` ist
`return result?.content || null;` — eine **leere Text-Datei** (legitima `content: ''`) wird als `null` („nicht vorhanden") gemeldet. Der `backup.ts:271`-Code macht extra einen `readFileBinary`-Check, um das zu umgehen — es bestätigt, dass `readFile` hier semantisch unzuverlässig ist. **Fix:** `return result ? result.content : null;` und Aufrufer mit `=== null` statt Truthiness checken.

### [memory.ts:194-212] **NIEDRIG** — `searchFiles` lädt pro Date den vollen Content in einer eigenen TX
Für 1.000 Dateien = 1.000 IDB-Roundtrips. **Fix:** `listFiles()` nutzen (schon geladen) und lokal im Array `includes` checken.

### [memory.ts:215-301] **NIEDRIG** — `ClientConfig` hält `apiKey` & `searchApiKey` im **LocalStorage** klar im Klartext
Das ist eine architektonische Entscheidung (client-only). Hier nur als Hinweis: jeder XSS im App-Code kann `loadConfig().apiKey` lesen und an einen beliebigen Ort exfiltrieren. **Fix (optional):** `Web Crypto API` + `localStorage`-Key aus dem Hostname abgeleitet; oder wenigstens `SubtleCrypto.encrypt` mit einer per-Tab-`sessionStorage`-Key.

---

## `web/src/core/cors_fetch.ts` + SSRF

### [cors_fetch.ts:13-31] **KRITISCH** — Client-seitig **gar keine** Ziel-Restriktion, Server-Proxy ist offene Relais
```ts
if (url.origin === window.location.origin) return target;
return `${window.location.origin}${PROXY_BASE}?url=${encodeURIComponent(url.href)}`;
```
Jegliche nicht-same-origin URL — `http://169.254.169.254/…` (Cloud-IMDS), `http://10.x.x.x/…` (Lan), `http://metadata.google.internal/…` — wird in `?url=` encodiert und an den eigenen Server geschickt. `proxy_server.py:18` definiert `ALLOWLIST = []` (leer = **allow all**) und der SSRF-Guard (Zeile 71-77) prüft *nur* private/loopback IP. **Folgen:**
1. Offene public-Web-Relais-Funktion: beliebige Drittanbieter-Requests laufen über den **Server-IP** (Anti-DoS-/Rate-Limit-Umgehung, IP-Reputation-Schaden).
2. DNS-Rebinding TOCTOU: `_validate_target_url` macht `socket.getaddrinfo(host)`, prüft die IP, danach macht `httpx.AsyncClient` **eigenes** `getaddrinfo` — ein 30 s-langes TTL-DNS-Target kann zwischen Validierung und Actual-Request auf eine private IP umbinden. **Fix:**
   - Client: `ALLOWED_ORIGINS` Whitelist in `cors_fetch.ts` (mind. `ki.vibeops.de`, `api.openai.com`, etc.), `file://`, `data:`, `blob:` sofort rejecten; `http://`-Ziele (ohne `https://`) nicht an den Proxy reichen.
   - Server: `httpx` mit einem **eigenem DNS-Resolver** (`httpx.AsyncResolver`/`trustme`-Hook), der die *selbe* IP nutzt, die `_validate_target_url` aufgelöst hat; `AsyncClient` mit `verify=False`+`ca_bundle` oder besser: `httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(local_address=...))` mit `mounts=`-Mapping auf die geregelten IPs.
   - `VAG_PROXY_ALLOWLIST` durch ein **Default-Whitelist** setzen, nicht leer.

### [cors_fetch.ts:15-16] **MITTEL** — `file://` wird an den Server gesandt, obwohl der Browser es direkt aufrufen darf
`new URL('file:///etc/passwd', base)` → `url.origin` ist `null`, nicht same-origin → proxied. Server rejectet (Scheme), aber client-seitig fehlt ein early-Bail für Schemes `file:`, `data:`, `blob:`, `javascript:`, `about:`. **Fix:** `if (!/^https?:$/.test(url.protocol)) throw new Error('scheme not allowed');`

### [cors_fetch.ts:16,30] **MITTEL** — `proxiedUrl` double-proxy möglich
`if (url.href.startsWith(window.location.origin + PROXY_BASE)) return target;` — bei einer URL wie `origin/api/proxy/?url=https://x/api/proxy/?url=https://y` wird die äußere `?url=` nicht entwirrt; der Server entwirrt nur die äußere (und sieht inneres als Ziel), **das innere ist dann eine zulässige Ziel-URL für den Server** — es gibt hier keine echte Double-Proxy-Schutzschicht. **Fix:** client-seitig `if (url.pathname.startsWith('/api/proxy/')) url.searchParams.get('url')` *recursed* prüfen.

### [cors_fetch.ts:41-48] **HOCH** — `window.corsFetch` ist für generierte Mini-Apps **weltweit sichtbar**
`declare global { interface Window { corsFetch: ... } }` + `window.corsFetch = corsFetch` exponiert den Helper ans *gesamte* JS-Universum des Browsers. Jede LLM-generierte Mini-App, jede Injection, jeder `<img onerror=...>` kann `window.corsFetch('http://169.254.169.254/latest/meta-data/iam/security-credentials/')` aufrufen und eine **SSRF** triggern, *ohne* den App-Prozess selbst zu verlassen. **Fix:** `window.corsFetch` nur in sicherem Kontext setzen (z. B. per `<data-vag-scope>`-Merkmark im DOM), oder eine per-session, per-App signierte Version (`corsFetch(url, { scopeToken })`) anbieten, die auf der Serverseite gegen das Scope-Token geprüft wird. Solange das `VAG_PROXY_ALLOWLIST` leer ist (Stand heute): **KRITISCH**.

---

## `web/src/core/presets.ts`

### [presets.ts:18-21] **NIEDRIG** — `proxyPath` fällt auf hardcodetes `vag.vibeops.de` zurück
```ts
function proxyPath(path: string): string {
  const host = typeof location !== 'undefined' ? location.host : 'vag.vibeops.de';
  return `https://${host}${path}`;
}
```
In Unit-Tests / SSR / Node-Sandbox, wo `location` fehlt, wird `https://vag.vibeops.de/api/kimi` generiert — das ist ein **Production-Host**, der in jeden gebauten Bundle eingebacken wird. Zusätzlich ist die Fallback-Konvention von `cors_fetch.ts:7` (`/api/proxy/` relativ) **inkonsistent**. **Fix:** `host = location?.host ?? import.meta.env.VITE_PROXY_HOST ?? 'localhost'` + Build-Zeit-Validierung, dass `import.meta.env.VITE_PROXY_HOST` gesetzt ist.

### [presets.ts:58-60] **NIEDRIG** — `findPresetByUrlAndModel` ignoriert das `model`-Argument
`return PROVIDER_PRESETS.find(p => p.baseUrl === baseUrl);` — zwei Presets mit gleicher `baseUrl` (z. B. `ki.vibeops.de` für `qwen3.8` vs. `ki.vibeops.de` für `llama3`) sind **nicht unterscheidbar**. **Fix:** `(p) => p.baseUrl === baseUrl && p.model === model`.

### [presets.ts:14] **NIEDRIG** — `apiKeyRequired: true` für alle — aber `ki.vibeops.de` ist eine *externe* URL, an die die API-Key **direkt vom Browser** geschickt wird (nicht über den eigenen Proxy). Das ist eine Sicherheitsentscheidung, die im Prompt-Builder nicht kenntlich ist — Nutzer können eine API-Key in die Address-Leiste eingeben, der Browser zeigt „gesicherte Verbindung" an, der Empfänger ist `ki.vibeops.de`. **Fix:** UI-Warnung, oder diese Presets zwingend über `proxiedUrl` laufen lassen.

---

## `web/src/core/global_errors.ts`

### [global_errors.ts:69-81] **MITTEL** — `console.error`-Override hat eine **implizite**, string-matching-basierte Rekurssicherung
```ts
console.error = (...args) => {
  originalError.apply(console, args);
  const message = args.map(…).join(' ');
  if (message.length > 0 && !message.startsWith('[')) {   // ← einzige Sperre
    logger.error('console.error', message.slice(0, 500));
  }
};
```
`logger.error` → `log()` → `writeLog` → `console.error('[source] msg', details)` (logger.ts:38). Die *gesamte* Nicht-Rekursion hängt davon, dass `logger.writeLog` **immer** mit `[` beginnt. Ändere jemand das Format (z. B. `[${source}] ${message}` → `${message} (${source})`), wird `console.error`-Override → `logger.error` → `console.error` → … ein **infinite Loop** und stackt den Tab. **Fix:** explizite `inErrorOverride`-Flag setzen (z. B. `logger.error.__inOverride = true`-Marker oder ein `Symbol.for`-Marker auf dem Argument), nicht auf String-Präfix matchen.

### [global_errors.ts:72-76] **NIEDRIG** — `JSON.stringify(a)` auf beliebigen `args` → `DataCloneError`-Loop-Risiko
`args.map((a) => a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))` — `JSON.stringify` auf einem DOM-Node wirft, auf einem circular Object wirft. Das `try/catch` am Ende fängt es, aber *vorher* hat `originalError.apply(console, args)` schon den Original-Value gerendert, während das Log-Entry verloren geht. **Fix:** `safeStringify`-Wrapper mit `try/catch` pro Arg.

### [global_errors.ts:12-34] **MITTEL** — `errorDetailsFromEvent` speichert `event.reason` **untransformiert**
`de.reason = event.reason` — wenn `reason` ein nicht-structured-cloneable Objekt ist (Function, Proxy, Window-Ref, DOM-Node), wirft der `store.add(record)` in `logger.writeLog` einen `DataCloneError`, der von `log()`-s `.catch(()=>{})` (logger.ts:100) **still geschluckt** wird — das heißt: **der FATAL-Fehler wird nie persistiert**. **Fix:** `de.reason = typeof reason === 'object' ? JSON.parse(JSON.stringify(sanitized(reason))) : String(reason)` in einem `safeDetails()`-Wrapper, der pro Feld `try/catch` hat.

### [global_errors.ts:37-38] **NIEDRIG** — `isRegistered` ist ein Module-Level-Flag
Nur `true` setzbar, nie resetbar — macht Unit-Tests (`registerGlobalErrorHandlers(); // then unregister; // re-register`) unmöglich. **Fix:** `export function _resetGlobalErrorHandlers(): void { isRegistered = false; …removeEventListener… }` für Testing.

---

## `web/src/main.ts`

### [main.ts:10-11] **HOCH** — Kein Bootstrap-Error-Catch rund um `new AppController()`
```ts
const controller = new AppController();
controller.start();
```
`(a)` Wirft der **Konstruktor**, ist noch niemand registriert (Handler werden erst in `start()` gemeldet → `AppController.ts:48`). (b) `start()` ist async; ein unhandled rejection auf Start *vor* dem ersten Event-Listener-Registriervorgang ist unsichtbar. **Fix:**
```ts
window.addEventListener('error', h1, true);
window.addEventListener('unhandledrejection', h2, true);
try {
  const controller = new AppController();
  controller.start().catch(err => { console.error('[bootstrap]', err); throw err; });
} catch (err) {
  console.error('[bootstrap]', err);
  throw err;
}
```
oder — saubere Lösung — `registerGlobalErrorHandlers()` **vor** `new AppController()` (dazu import umschichten).

---

## Drei-Satz-Zusammenfassung

Die drei kritischen Funde sind: (1) `backup.importZip` ist *keine* atomare Transaktion und verliert bei Quota-Abbruch Daten („all-or-nothing" ist falsch), (2) `workspace.copyDatabase` ist nicht atomar und ein Crash während der eine-maligen Legacy-Migration macht alle Legacy-DB-Daten unwiederbringlich verloren, und (3) `cors_fetch.ts` + `window.corsFetch` + Server mit leerem `VAG_PROXY_ALLOWLIST` bilden zusammen eine offene SSRF-/Open-Relay-Oberfläche, die von jeder LLM-generierten Mini-App aus triggerbar ist. Die restlichen Befunde (read-then-write-Races in `memory.ts`, fehlende `onabort`-Handler in `cursorAll`/`cursorByIndex`, `console.error`-Override mit string-matching-basierter Rekurssicherung, inkomplett-Rollout von `resetLocalData`, Framerate-Hardcode in `presets.ts`, fehlender Bootstrap-Catch in `main.ts`) sind nicht fatal, aber jeder einzeln produktionsrelevant. Priorisiert: Backup-Atomizität → Migration-Atomizität → SSRF-Guard → DB-Cursor-Hänger → Session-Race → Konsistenz-Cleanup.
