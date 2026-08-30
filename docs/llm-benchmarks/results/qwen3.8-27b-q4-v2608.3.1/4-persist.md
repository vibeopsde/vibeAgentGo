[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/db.ts
[0m→ [0mRead web/src/core/app_store_db.ts
[0m→ [0mRead web/src/core/memory.ts
[0m→ [0mRead web/src/core/workspace.ts
[0m→ [0mRead web/src/core/backup.ts
[0m→ [0mRead web/src/core/cors_fetch.ts
[0m→ [0mRead web/src/core/presets.ts
[0m→ [0mRead web/src/main.ts
[0m→ [0mRead web/src/core/global_errors.ts
[0m✱ [0mGrep "/api/proxy"[90m in . · 3 matches[0m
[0m→ [0mRead web/src/core/logger.ts
[0m✱ [0mGrep "proxy"[90m in . · 0 matches[0m
[0m✱ [0mGlob "**/*.go"[90m 0 matches[0m
[0m
[0m$ [0mls /root/vibeAgentGo && ls /root/vibeAgentGo/web
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
[0m$ [0mls /root/vibeAgentGo/server
__pycache__
proxy
vag-proxy.service
vag-youtube-proxy.service
youtube_proxy.py
[0m
[0m$ [0mls /root/vibeAgentGo/server/proxy
README.md
__pycache__
proxy_server.py
[0m
[0m→ [0mRead server/proxy/proxy_server.py
[0m✱ [0mGrep "writeFile|deleteFile|listFiles"[90m in web/src · 85 matches[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [offset=160, limit=60][0m
[0m→ [0mRead web/src/core/tools/file_tools.ts[90m [offset=80, limit=60][0m
[0m✱ [0mGrep "registerGlobalErrorHandlers"[90m in web/src · 3 matches[0m
[0m→ [0mRead web/src/core/appManifest.ts[90m [limit=80][0m
[0m✱ [0mGrep "resetLocalData|migrateLegacyWorkspace"[90m in web/src · 7 matches[0m
[0m→ [0mRead web/src/components/SettingsDangerZoneSection.ts[90m [limit=60, offset=30][0m
[0m→ [0mRead web/src/core/AppController.ts[90m [limit=80, offset=40][0m
[0m✱ [0mGrep "needsUpdate|installApp|exportZip"[90m in web/src · 17 matches[0m
# Code-Review 4/4 — Persistenz + Infrastruktur

## [db.ts:142-152] — HOCH
**Problem:** `runTx` löst das Promise beim **ersten** `req.onsuccess` auf, nicht bei `transaction.oncomplete`. Bei Bulk-Operationen (`saveMemoryBulk`, `saveSessionsBulk`, mehrere `put`s) kann das Transaction später noch **aborted** werden (Quota, `versionchange` aus anderem Tab) — das Promise hat aber bereits `resolve`d. Folge: Stiller Datenverlust bei vermeintlich erfolgreichem Write; `withDBRetry` greift nicht, weil kein Fehler mehr auftritt.
**Vorschlag:** Resolve ausschließlich in `transaction.oncomplete`, dabei die Ergebnisse aller Requests in einer Map sammeln und erst dann liefern. `oncomplete` ist bereits als Fallback-Handler vorhanden — ihn zur primären Settle-Rolle machen.

## [db.ts:173-219] — MITTEL
**Problem:** `cursorAll` und `cursorByIndex` haben **keinen `onabort`-Handler** (im Gegensatz zu `runTx`). Ein Transaktions-Abort (Version-Change aus anderem Tab, Browser-GC) lässt das Promise **für immer hängen** — genau der Stalle, den db.ts:147-150 für `runTx` adressiert. Der Agent blockiert, bis der User neu lädt → `currentSessionId` geht verloren (siehe memory.ts getSession-Pfad).
**Vorschlag:** Gleiche `settle()`/`transaction.onabort`-Logik wie in `runTx` anwenden; zusätzlich beide Funktionen hinter `withDBRetry` führen.

## [db.ts:86-99] — MITTEL
**Problem:** `DB_RECOVERABLE_ERRORS` enthält **kein `AbortError`** — den typischen Fehler eines abgebrochenen Transaktions-Writes. Ein `put`, der durch `versionchange` abortet, wird nicht retryed und schlägt beim Caller fehl → verlorener Write ohne Wiederherstellung.
**Vorschlag:** `AbortError` in die Recoverable-Set aufnehmen (Retries bleiben durch `attempt === 0` begrenzt); bei Read-Transaktionen zusätzlich ein zweiter Retry mit frischer Connection.

## [db.ts:244-260] — MITTEL
**Problem:** `resetLocalData` löscht aus `localStorage` **alle** Workspace-Registrierungen (inkl. `vibeAgentGo-workspaces`), räumt aber **nur die** IndexedDB des aktiven Workspaces auf (`getDbName()`) — alle anderen Workspace-DBs bleiben als Orphan-Daten auf der Platte (Datenschutz: API-Nähe, Sessions, Dateien ungelöscht; zusätzlich Plattenleak). `onblocked`/`onerror` werden ohne Log still geschluckt.
**Vorschlag:** Vor dem Löschen `listWorkspaces()` iterieren und jede `vibeAgentGo-agent-${id}`-DB explizit mit `indexedDB.deleteDatabase` entfernen; Blocking-Fehler loggen.

## [db.ts:10 + 57-81] — NIEDRIG
**Problem:** Kommentar behauptet "v6: skills store removed", `onupgradeneeded` ruft aber nie `deleteObjectStore('skills')` auf — alte skills-Daten persistieren endlos in jeder upgegradeten DB.
**Vorschlag:** In `onupgradeneeded` `if (db.objectStoreNames.contains('skills')) db.deleteObjectStore('skills')`.

## [memory.ts:81-97, 107-115] — MITTEL
**Problem:** `updateMemory` und `saveSession` sind **nicht-atomaere Read-Modify-Write**-Sequenzen über zwei separate Transaktionen (Read-Tx, dann Write-Tx). Zwischen beiden kann ein paralleler `saveMemoryBulk`/Import/Backup-Restore einziehen → lost Update bzw. überrollte `session.put` (konkret: `saveSessionsBulk` zwischen dem `getSession`-Read und dem `put` von `saveSession` macht die `created_at`-Erhaltung zunichte).
**Vorschlag:** Read und Write in **eine** readwrite-Transaktion legen (store.get + store.put hintereinander in derselben Tx — IndexedDB unterstützt das); bei `saveSession` alternativ `put` direkt mit gelesenen Feldern in einem Store-Zugriff.

## [memory.ts:156-177] — MITTEL
**Problem:** `writeFile(path, '')` (oder beliebiger Text) **überschreibt eine existierende binäre Datei** — Store-Schema ist `put({path, content, binary?})`; ein Text-`put` ersetzt den Eintrag komplett, `binary` ist danach weg. Backup.ts hat sich dagegen extra abgesichert (restoreFiles-Check), aber der generische Pfad (Bridge `writeFile`, Agent-Tools, `uninstallApp`-Nachbarzonen) hat diese Prüfung nicht → stille Zerstörung binärer Daten.
**Vorschlag:** In `writeFile` vor dem `put` prüfen, ob ein Eintrag mit `binary`-Feld existiert, und entweder ablehnen/throwen oder explizit bestätigen lassen; oder Text- und Binär-Entries schema-separat verwalten (z. B. eigenes Store oder Typfeld mit Guard).

## [memory.ts:72-79, 145-152, 160-167, 198-205] — MITTEL
**Problem:** `deleteMemory`, `deleteSession`, `readFile`, `deleteFile` swallowen **jede** Exception (`catch { return false/null }`) ohne Logging. DB-Abbrüche, Quota-Exceed, Connection-Verlust — alles unsichtbar. Genau in Crash-Situationen, in denen `global_errors.ts`/Logger den Fehler dokumentieren sollte, fehlt jede Spur.
**Vorschlag:** Mindestens `logger.warn(...)` mit Kontext (Methode, Key, Fehler) im Catch-Block; bei Schreibfehlern den Fehler besser an den Caller propagieren statt `false` zu liefern (Callers wie `deleteWorkspace` können dann reagieren).

## [workspace.ts:89-113] — MITTEL
**Problem:** `deleteWorkspace` removes zuerst den Registry-Eintrag, **danach** die IndexedDB. Bei `onblocked` (anderer Tab hat die DB offen) oder Crash dazwischen ist der Workspace aus dem Registry weg, die DB aber noch da (Orphan, Daten faktisch verloren, weil kein Workspace mehr darauf zeigt — und `resetLocalData` würde sie ohnehin nicht mehr löschen, s. o.). Die DB ist nach Registry-Deletion für keinen Codepfad mehr erreichbar.
**Vorschlag:** Reihenfolge umdrehen bzw. transaktionaler machen: DB-Deletion initiieren und Registry-Eintrag erst löschen, wenn `onsuccess`/`onblocked`-Status bekannt ist; bei `onblocked` den Workspace im UI als "wird entfernt" markieren und Retry-Vorrichtung (neuer Start → verwaiste DBs erkennen) bauen.

## [workspace.ts:185-276] — MITTEL
**Problem:** `copyDatabase`: (1) liest **komplette** Stores via `getAll()` in den JS-Heap und schreibt in **einer** Transaktion — bei großen `files`-Stores (binär) OOM-Risiko mitten in der Migration, Source bleibt heil, Target halbfertig. (2) Ein zweiter Migrationslauf (erster abgebrochen/crashed) **mergt** via `put` in das bereits teilgefüllte Target — gemischte Daten statt sauberem State, weil niemals `clear()`/`deleteDatabase(target)` vor dem Copy passiert. (3) Fehler in `copyDatabase` werfen aus `start()` → unhandled rejection → App startet nicht, nur Neuladen hilft.
**Vorschlag:** Vor dem Copy `indexedDB.deleteDatabase(targetName)` (dann frisch anlegen), per Cursor chunkweise kopieren statt `getAll`, und `migrateLegacyWorkspace` with retry/rollback-Hinweis ausstatten.

## [workspace.ts:39-52] — NIEDRIG
**Problem:** `getActiveWorkspaceId` ist ein Getter mit **schweren Seiteneffekten** (erzeugt Workspace, schreibt localStorage) und wird aus `getDbName()` heraus **bei jedem** DB-Call aufgerufen — inkl. rekursiver `listWorkspaces()`/`JSON.parse` pro Öffnung. Zwei Tabs in diesem Fenster können unterschiedliche "Default"-Workspaces erzeugen.
**Vorschlag:** Default-Workspace-Anlage nur in `migrateLegacyWorkspace`/`start()` (App-Bootstrap) tun; getter bleibt side-effect-frei.

## [app_store_db.ts:66-73] — MITTEL
**Problem:** `installApp` baut den Zielpfad aus `app.category`/`app.id` **ohne Path-Sanitizing**. `category` ist erlaubnisslistenbasiert validiert, aber `id` nur auf "vorhanden" geprüft (`appManifest.ts:53-55`) — eine crafted `id` wie `../../x` schreibt per Bridge an einen **beliebigen Workspace-Pfad** (Arbitrary-File-Write innerhalb des Workspace). `readManifest` (Zeile 100) hat dasselbe Muster.
**Vorschlag:** `id` strikt validieren (`/^[a-z0-9-]+$/` o. ä.) in `parseAppManifest` **und** als zweiten Guard in `InstalledAppStore.appPath`; absolut-Pfad-/`..`-Komponenten ablehnen.

## [app_store_db.ts:29-59, 88-97] — NIEDRIG
**Problem:** `getInstalled`/`isInstalled`/`needsUpdate` rufen jedes Mal `listInstalled()` auf, das **alle** `index.html`-Inhalte (komplette HTML!) lädt und parsen muss. Install-/Update-Flows (AppStoreApp Zeile 193/231/377) feuern das mehrmals pro Aktion — bei mehreren Apps spürbar ineffizient.
**Vorschlag:** `readManifest(app.id, app.category)` direkt auf dem erwarteten Pfad lesen (funktioniert bereits isoliert) statt die Liste zu wälzen; oder eine Metadata-Only-Liste führen.

## [backup.ts:56-77] — MITTEL
**Problem:** `exportZip` holt Sessions per `listSessions()` (nur Metadaten) und lädt dann pro Session `getSession(id)` nach; `fullSessions.filter((s) => Boolean(s))` **wirft alle Sessions weg, deren Reload fehlgeschlagen ist** — ein transienter DB-Hiccup während des Exports erzeugt also ein Backup mit **stillem Datenverlust** (Session weg), und das ohne Hinweis im Manifest.
**Vorschlag:** Auf `saveSessionsBulk`-kompatibler kompletter Liste aufsetzen (einmaliger `getAll` auf dem `sessions`-Store) statt zweistufig; wenn eine Session nicht geladen werden kann, muss der Export **fehlen** (Error werfen), nicht stumm filtern.

## [backup.ts:126-181] — HOCH
**Problem:** Import ist **nicht atomic über Stores** und **merge-t** statt restore-t: memory/sessions/files werden nacheinander in separaten Transaktionen `put`-geschrieben. (1) `atob()` auf korruptem Base64 wirft erst in `restoreFiles` (memory.ts:281) — davor sind memory + sessions bereits überschrieben → partial state, kein Rollback (Kommentar Zeile 167-172 behauptet fälschlich "all-or-nothing"). (2) Import in einen **bestehenden** Workspace merge-t: `autoIncrement`-IDs kollidieren (Backup-ID `1` überschreibt die unzusammenhängende lokale Memory-Einträge `1`), Sessions überschreiben sich via `keyPath: id` → echte Datenverlust-Pfade, die der User nicht versteht. **Vorschlag:** Payload vollständig validieren (base64 dekodierbarkeit in `assertValidPayload` testen!), Import explizit als "kompletter Restore" mit Vorab-Wipe der zu importierenden Stores definieren (oder expliziten Merge-Modus), idealerweise in eine Staging-Namen schreiben und via `deleteDatabase`-Swap atomar aktivieren.

## [backup.ts:286-300] — NIEDRIG
**Problem:** `bytesToBase64`/`base64ToBytes` über `String.fromCharCode`+`btoa` sind korrekt, aber die Validierungsseite (`assertValidPayload`) prüft nur `typeof === 'string' && truthy`, **nicht** Decodierbarkeit — kombiniert mit o. g. Nicht-Atomicität des Imports der primäre "corrupt bytes" Trigger.
**Vorschlag:** In `assertValidPayload` einen Test.Decode per `atob()` (try/catch) auf **jeder** binären Datei durchführen, bevor je etwas geschrieben wird.

## [cors_fetch.ts:28-31] — HOCH
**Problem:** `corsFetch(input: RequestInfo)` — wird `input` ein **Request-Objekt** übergeben (und `init` ist `undefined`, der normale Fall), verliert der Folge-Fetch **alle** Header und den Body des Requests, weil `fetch(proxiedUrl(url), init)` nur die URL und `undefined` übergeben bekommt. Stille Datenkorruption/401s in generierten Mini-Apps, die legitime `fetch(Request)`-Muster nutzen.
**Vorschlag:** Request-Inputs explizit behandeln: `new Request(proxiedUrl(input.url), input)` bauen (Header, Method, Body übernehmen) statt URL nur string zu ziehen.

## [cors_fetch.ts:13-22] — MITTEL
**Problem:** `proxiedUrl` routet **jede** external URL in den Proxy — inkl. offenkundig interner Ziele (`http://169.254.169.254/`, `http://localhost:PORT/`, `http://10.x.x.x/`). Die Server-Seite hat Guards, aber der Client tröstet sich nicht: er generiert aktiv Request gegen interne Targets und hängt deren Antwort an beliebte UIs. Defense-in-depth fehlt komplett client-seitig.
**Vorschlog:** `proxiedUrl` lehnt Loopback/Link-Local/RFC1918-Hosts client-seitig ab (klarere Fehlermeldung statt mysteriöser 403s vom Proxy); reduziert Angriffsfläche gegen die Server-DNS-Rebinding-Lücke (s. u.).

## [server/proxy/proxy_server.py:47-77] — KRITISCH
**Problem:** **DNS-Rebinding / TOCTOU-SSRF-Bypass.** `_validate_target_url` löst den Hostname via `socket.getaddrinfo` **bevor** der Request auf, `httpx.AsyncClient` löst denselben Hostnamen **beim Connect neu** auf. Ein Angreifer mit eigener Authoritative-DNS liefert für die Validierungs-Abfrage eine öffentliche IP, für die Connect-Abfrage `127.0.0.1`/`169.254.169.254`/`10.x.x.x` → die SSRF-Guards werden **komplett umgangen** und der Proxy holt Cloud-Metadaten (IAM-Credentials) oder interne Services. Klassisches SSRF-Vorurteil; die Redirect-Revalidierung (Zeile 115) schützt nur gegen 302er, nicht gegen die Re-Resolve im direkten Connect.
**Vorschlag:** DNS-Ergebnis **pinnen**: einmal auflösen, validierte IP in eine `IP-literal`-URL umwandeln und über diese verbinden (bei HTTPS `sn`-SNI/Host-Header beibehalten) — oder mit einem `httpx`-Custom-Transport, das `remote_address` auf die validierte IP sperrt. Alternativ `VAG_PROXY_ALLOWLIST` per Default mit expliziten Hosts befüllen und leere Liste = Hard-Deny.

## [server/proxy/proxy_server.py:23] — HOCH
**Problem:** `FORWARDED_REQUEST_HEADERS = {"content-type", "accept", "authorization"}` — die **Authorization-Header** aus dem Origin-Request wird an **beliebige** (zulässige, d. h. per Default alle) Upstreams weitergeleitet. Kombiniert mit `Access-Control-Allow-Origin: *` (Zeile 123) + `Access-Control-Allow-Headers: ... Authorization` (Zeile 125) kann **jede** Website im Browser des Users einen Preflight + Post an `/api/proxy/?url=angreifer.example` senden und einen custom `Authorization: Bearer <vibeAgentGo-Key>`-Header mitschicken — Cross-Site-Token-Exfiltration gegen einen beliebigen Host, dem der Key übergeben wird.
**Vorschlag:** `authorization` aus `FORWARDED_REQUEST_HEADERS` **entfernen** (Content-Type/Accept reichen für den dokumentierten Use-Case); falls nötig nur bei expliziter Allowlist-Hosts. `Access-Control-Allow-Origin` auf `*` reduzieren (oder origin-echoing mit Preflight-Policy, die Authorization nicht erlaubt).

## [server/proxy/proxy_server.py:127-132] — MITTEL
**Problem:** `upstream.content` **puffert die gesamte** Antwort in den Server-Speicher, ohne Max-Size-Limit. Eine (böswillige oder versehentliche) große Datei/Stream beim Upstream = OOM-Direktzugriff auf den Proxy. Dazu keine Rate-Limitierung pro IP — mit leerm ALLOWLIST per Default ist der Proxy ein **Open-Proxy** für willkürliches Fetching/DoS von außen.
**Vorschlag:** `max_response_bytes` (z. B. 50 MB) mit Streaming + Abbruch umsetzen; `ALLOWLIST` per Default auf eine Whitelist beschränken (leere Liste = 403), optionales per-IP-Rate-Limiting.

## [presets.ts:18-21] — NIEDRIG
**Problem:** `proxyPath` holt `location.host` und präfixt **hart `https://`** — bei lokalem HTTP-Dev-Serve (`http://localhost:5173`) ergibt das `https://localhost:5173/api/...` → Zertifikats-/Mixed-Content-Fehler in der Dev-Umgebung; die Presets sind dann dort unbrauchbar.
**Vorschlag:** `location.protocol` dynamisch verwenden (`${location.protocol}//${host}${path}`) statt `https://` hart zu codieren.

## [global_errors.ts:66-81 + logger.ts:29-43] — HOCH
**Problem:** Rekursionsschleife zwischen `console.error`-Wrapper und Logger: `log()` (logger.ts:29-38) ruft `console.error` auf — das ist der **wrapperisierte** `console.error` von global_errors.ts, der `logger.error(...)` aufruft → `log()` → `console.error` (wrapper) → … Die Behauptung "avoid infinite recursion" (Kommentar Zeile 66-67) trifft **nicht** zu. Die Schleife läuft bis Stack-Overflow (RangeError), wird erst durch die `catch {}`-Blöcke abgefangen — mit dem Effekt, dass **jeder** `logger.error`-/`logger.fatal`-Aufruf (a) Dutzende/fachfach dieselben Zeilen in die Konsole schreibt, (b) Dutzende/fachfach dieselben DB-Log-Einträge produziert und (c) einen RangeError in der Fehlerschleife selbst generiert. Genau dann, wenn ein Crash loggen soll, bricht das Logging selbst zusammen.
**Vorschlag:** In `log()` eine **raw**-Konsole-Referenz führen (`const rawConsoleError = console.error` vor dem Wrapper; `log()` ruft `rawConsoleError` auf), oder ein `isLogging`-Flag im Wrapper setzen, das re-entrant `logger.error`-Aufrufe unterdrückt.

## [global_errors.ts:12-34] — MITTEL
**Problem:** `errorDetailsFromEvent` speichert `event.reason` (bei unhandled rejections) **unstrukturiert** in `details` — arbitrary Objekte, die zirkuläre Referenzen enthalten können. `store.add(record)` in `writeLog` (logger.ts:43) nutzt Structured-Clone → wirft bei zirkulärem `reason` → `.catch(() => {})` in `log()` (logger.ts:100) schluckt das → **der Crash-Eintrag geht verloren**, gerade in dem Moment, in dem eine Rejection mit zirkulärem Payload (sehr häufig bei Agent-Statusobjekten) auftritt.
**Vorschlag:** `reason` defensively serialisieren (`JSON.stringify(reason, replacer)` mit Zirkularitäts-Guard, oder nur `.message`/`.stack` von Error-Instanzen), statt das Rohobjekt in den IDB-Record zu stecken.

## [main.ts:1-11] — (keine Fundstellen)
Schlüsselseil, delegiert alles an `AppController.start()`. Die einzigen relevanten Bootstrap-Risiken (Migration-Vorlauf, SW-Registerung, Lifecycle-Listener) leben in `AppController` und sind in den obigen Einträgen (db.ts, workspace.ts) abgedeckt.

---

**Zusammenfassung:** Die kritischsten Lücken liegen in der CORS-Proxieschicht (DNS-Rebinding-TOCTOU als SSRF-Bypass, plus Weiterleitung des Authorization-Headers an beliebige Hosts mit `Access-Control-Allow-Origin: *`) und im nicht-atomaeren Backup-Import, der bei korrupter oder in einen bestehenden Workspace geladener Payload silent Data Loss erzeugt. Auf DB-Ebene ist die Kombination aus "resolve vor Transaktions-Commit" in `runTx`, fehlenden `onabort`-Hooks in den Cursor-Dateien und der nicht-atomaeren Read-Modify-Write in `saveSession`/`updateMemory` der Hauptgrund für die sonst gut verteilten Race- und Datenverlust-Risiken. Der `console.error`-Logger-Rekursions-Bug in `global_errors.ts` sollte als Erstes gefixt werden, da er die Fehlerbehandlung — also genau den Fokusbereich dieses Reviews — selbst zerstört.
