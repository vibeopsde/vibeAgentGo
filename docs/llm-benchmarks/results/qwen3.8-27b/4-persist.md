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
[0m→ [0mRead web/src/core/logger.ts
Now let me verify dependencies: `logger.ts` (recursion risk) and `appManifest.ts` (path validation for the app store).
[0m→ [0mRead web/src/core/appManifest.ts
[0m✱ [0mGrep "/api/proxy"[90m in . · 0 matches[0m
Let me also check the server-side proxy handler (the SSRF surface of `/api/proxy?url=`) briefly, since it's referenced by `cors_fetch.ts`.
[0m✱ [0mGrep "proxy"[90m 0 matches[0m
[0m→ [0mRead .
[0m✱ [0mGrep "url=|/api/proxy"[90m in server · 9 matches[0m
[0m→ [0mRead server/proxy/proxy_server.py
[0m✱ [0mGrep "clearLogs|registerGlobalErrorHandlers"[90m in web/src · 5 matches[0m
[0m✱ [0mGrep "listFiles"[90m in web/src · 26 matches[0m
A few quick cross-checks before writing the review:
[0m✱ [0mGlob "web/src/core/bridge*"[90m 0 matches[0m
[0m✱ [0mGrep "resetLocalData|deleteWorkspace\(|navigator\.storage"[90m in web/src · 6 matches[0m
[0m→ [0mRead web/src/core/AppController.ts[90m [limit=120, offset=160][0m
Let me verify the bridge semantics (what `listFiles`/`writeFile` actually do) to be precise about the data/integrity findings.
[0m✱ [0mGrep "permissions|allowlist|checkPermission"[90m in web/src · 0 matches[0m
# Code-Review — Persistenz & Infrastruktur

## KRITISCH

**1. [server/proxy/proxy_server.py:16-44] — Öffentlicher SSRF-Proxy ohne Schutz (via `web/src/core/cors_fetch.ts:13`)**
Der Proxy akzeptiert **jede** http/https-URL (`ALLOWLIST` optional, leer = alle erlaubt). Generierte Mini-Apps und LLM-Ausgaben rufen `window.corsFetch(...)` auf → die App selbst kann beliebige Zielpunkte im Servernetzwerk abrufen: `http://169.254.169.254` (Cloud-Metadaten), `http://127.0.0.1`, interne Hosts. Verschärft durch (a) `follow_redirects=True` — ein 302 auf einen internen Host umgeht die Allowlist komplett, da nur das *initiale* `parsed.host` geprüft wird (proxy_server.py:30 vs. 40), und (b) Weiterleitung von Request-Headern (proxy_server.py:33-38), darunter `Authorization`.
→ **Fix:** Allowlist-Pflicht (Default-Deny), Block privater/link-local/metadata-IPs (DNS-Auflösung vor dem Request, nicht nur Host-String-Vergleich), Redirects nur re-prüfen (eigenen Redirect-Loop mit erlaubter Ziel-Prüfung ersetzen `follow_redirects`), keine Weiterleitung von `Authorization`/`Cookie`/`X-Forwarded-*` an Upstreams, Rate-Limit pro IP.

**2. [web/src/core/backup.ts:54-57,95-98] + [web/src/core/memory.ts:175-178] — Binary-Dateien gehen im Backup stillschweigend verloren**
`exportZip` exportiert Dateien über `listFiles()`, das immer `{path, content: string}` liefert. Für per `writeFileBinary` gespeicherte Dateien (`memory.ts:161`) ist `content` leer (binaries liegen im Feld `binary`). Das Backup enthält diese Dateien als **leere Textdateien**; der Import (`memory.ts:144`) schreibt dann das leere `content` → das Original ist bei Restore überschrieben. Kein Fehler, keine Warnung → stiller Datenverlust beim wichtigsten Schutzmechanismus.
→ **Fix:** `listFiles` muss eine Typinfo (`text`/`binary`) mitliefern; binäre Einträge als Base64 in `memory.json`/`files/` exportieren und bei Import per `writeFileBinary` rekonstituieren; auf die Export-Vollständigkeit (Zählvergleich) prüfen und bei Nicht-Match die Backup-Datei kennzeichnen.

**3. [web/src/core/workspace.ts:158-171] + [workspace.ts:185-276] — Legacy-Migration nicht atomar, nicht idempotent**
Reihenfolge: `saveWorkspaces([ws])` + `setActiveWorkspaceId('default')` werden **vor** `copyDatabase` ausgeführt. `migrateLegacyWorkspace` gibt bei `workspaces.length > 0` auf (Zeile 130) → läuft also exakt einmal. `copyDatabase` macht Store-für-Store Lese-+Schrift-Transaktionen ohne globale Transaktion/Verifikation. Fällt die Kopie中途 (Quota, Abbruch, Crash), ist die Migration „erledigt“, aber die Daten liegen nur noch im Legacy-DB (nicht mehr adressierbar) → der Nutzer verliert den Zugriff auf sein gesamtes Datenmaterial.
→ **Fix:** Erst kopieren, dann (erst!) Workspace registrieren; Migration in markierter Phase (`migrations`-Key / `migrated_from`-Feld) abspeichern, Retry bei Fehler; am Ende Vollständigkeitsprüfung (Zählsummen je Store + ggf. Checksumme) und erst dann Legacy-DB belassen/aufräumen; Fehler dem Nutzer sichtbar melden.

## HOCH

**4. [web/src/core/backup.ts:138-142] — Import überschreibt aktuelle API-Keys**
Nur der exakte String `' [REDACTED]'` wird geschont. Enthält der Backup die leeren/fehlenden Keys (Backup ohne Key erstellt, oder ältere Version), wird `apiKey` auf `''`/`undefined` gekloppt und persistiert → vorhandener, gültiger Key ist nach dem Restore weg. `searchApiKey` analog.
→ **Fix:** Niemals `''`/`undefined`/`null` aus dem Backup überschreiben (nur explizite, valide Werte oder der Redaction-Marker-Abgleich); am sichersten: Keys beim Import immer aus der aktuellen Konfiguration behalten, Backup-Keys nur auf Nutzerbestätigung einspielen.

**5. [web/src/core/backup.ts:147-155] — Import kollidiert mit autoIncrement-IDs (stille Überschreibung)**
`saveMemoryRaw` verwendet `store.put(entry)` mit importierten expliziten IDs. IndexedDB erhöht den AutoIncrement-Zähler **nicht** bei `put` → die nächste `saveMemory` (`store.add`, `memory.ts:23`) erhält die nächste freie Nummer, die eine bereits importierte ID treffen kann → `add` wirft `ConstraintError` (gut), aber `put`-Pfade könnten dieselbe ID überschreiben; zudem sind die 3 `Promise.all`-Batches keine einzige Transaktion → ein Abbruch (Quota/Crash) lässt einen **inconsistenten Zustand** (neue Sessions ohne Dateien, alte Memory-Einträge neben importierten) zurück.
→ **Fix:** Import pro Store in einer Transaktion; vor import `store.clear()` (ersetzen statt mergesen) oder explizite Merge-Logik mit Nutzerwahl; nach Import Zähler konsistent halten oder IDs neu generieren; vorher automatisches Sicherheits-Snapshot.

**6. [web/src/core/memory.ts:101-109] — Race Condition in `saveSession` (read-modify-write über zwei Transaktionen)**
`getSession` (readonly-Tx) und `put` (readwrite-Tx) sind getrennt. Zwei parallele Schreibende (Agent-Streaming + UI-Ereignis, zwei Tabs) lesen dieselbe `existing`/gleiche Session und schreiben nacheinander → das spätere, ältere `messages`-Array gewinnt → **Nachrichten gehen verloren**.
→ **Fix:** Get und Put in **einer** readwrite-Transaktion zusammenfassen (atomare read-modify-write); bei Bedarf Merge-Strategie (z. B. längste Messages-Liste gewinnt) statt „letzte gewinnt“.

**7. [web/src/core/app_store_db.ts:25-27,66-85] — Unsanitierte App-`id`/`category` → Pfad-Traversierung + ignorierte Bridge-Fehler**
`installApp` setzt `path` aus `app.category`/`app.id` ohne Validierung (`id` ist frei wählbar!): `id:"../../foo"` oder `"a/b"` schreibt Dateien **außerhalb** des `apps/`-Baums in den Workspace; `listInstalled` findet zudem jede `*/index.html` im Workspace (z. B. `.vibeAgentGo/…`) als installierte App. Die Bridge-Responses `ok`/`error` werden an Zeile 68-72 und 83 **nicht geprüft** → fehlgeschlagene Writes/Deletes werden still geschluckt (Teil-Deinstallation möglich), der Aufrufer (`AppController.ts:246-258`) meldet trotzdem Erfolg.
→ **Fix:** `id` (und `category` trotz Allowlist aus dem Manifest) strikt validieren: `!/^[A-Za-z0-9_-]{1,64}$/`, keine `/`, `..`, keine Leerzeichen; Basis-Pfad nach dem Schreiben mit dem erwarteten Präfix verifizieren; `ok:false`/`error` bei jeder Bridge-Aufruf prüfen und weiterwerfen.

## MITTEL

**8. [web/src/core/db.ts:24-43,114] — Workspace-Wechsel während pendender `openDB`-Promises**
`openDB()` schließt bei Name-Wechsel nur die *gelösten* Connections. Aufrufer, die die **pendende** `dbPromise` für den alten Workspace bereits erhalten haben (z. B. Logger-Write während `switchWorkspace`), schreiben nach Auflösung in die alte DB; umgekehrt kann ein neuer `openDB` für ws_A wieder `dbPromise=null` setzen, während ws_B-Transaktionen in Flug sind → Writes landen im falschen Workspace (datenverwechslung zwischen Workspaces), Retry-Mechanismus rettet nur Einzel-Transaktionen, nicht die Verwechslung.
→ **Fix:** Promise pro DB-Name führen (Map `name → Promise<IDBDatabase>`), bei Reset aktive Verbindungen pro Name schließen und pendende Transactions pro Name sauber aborten/synchronisieren; Workspace-ID in Transaktions-Metadaten mitschreiben und prüfen, dass die Tx zum erwarteten DB-Namen gehört.

**9. [web/src/core/db.ts:246-252, 237] — `resetLocalData` behauptet Vollständigkeit, räumt nur aktiven DB ab**
Kommentar sagt „Delete all workspace databases“, tatsächlich wird nur `getDbName()` (aktiver Workspace) gelöscht; `indexedDB.deleteDatabase` wird `onblocked` **als Erfolg** behandelt (Zeile 251) → in einem anderen Tab offene Connection blockiert den Delete, die Funktion liefert aber `resolve()` → der Nutzer glaubt, alle Daten seien gelöscht. Analog in `workspace.ts:100-105` (deleting Workspace).
→ **Fix:** Alle DB-Namen aus `listWorkspaces()` + `LEGACY_DB_NAME` durch `indexedDB.databases()` verifizieren und einzeln löschen; `onblocked`: Retry mit Backoff oder sichtbare Fehlermeldung, nicht `resolve`; Ergebnis (zähler) zurückgeben und UI-auswerten.

**10. [web/src/core/global_errors.ts:49-56] — `event.preventDefault()` schluckt alle unhandled Rejections**
Jeder unhandled-Promise-Rejection wird global verhindert → Browser-Konsolen-Eintrag unterdrückt und **keine** sichtbare UI-Reaktion; bei persistenzkritischen Fehlern (z. B. fehlgeschlagene DB-Write, die nirgends gecatcht wurde) läuft die App mit inkonsistentem Zustand weiter. Das Logging in IndexedDB ist dabei ironischer Weise die eigene Stellschraube: Ist die DB defekt (häufigste Crash-Klage), fällt auch der `logger.fatal`-Write (`.catch(()=>{})`, `logger.ts:100`) → Crash ist nicht reproduzierbar/untersuchbar.
→ **Fix:** `preventDefault` nur für bekannte, gut behandelte Kategorien (z. B. Resource-Loads), sonst durchlassen; bei `logger`-Fehlern Fallback auf `localStorage`-Spool + sichtbares UI-Banner; Crash-Reports in `navigator.sendBeacon`-fähigen Speicher duplizieren.

**11. [web/src/core/cors_fetch.ts:28-31] + [server/proxy/proxy_server.py:33-38,51-52] — API-Keys laufen über den Zentralserver**
Jeder cross-origin Request (inkl. `Authorization: Bearer <LLM-Key>`) durchläuft `proxy_server.py`, der die Header an den Upstream weiterleitet und `Access-Control-Allow-Headers: … Authorization` global erlaubt. Keys sind damit im Server-Log/Tracer sichtbar, zentral gesammelt und von jeder Seite im Browser (auch generierte Mini-Apps) abrufbar.
→ **Fix:** Proxy nur für definierte, serverseitig konfigurierte Provider-Routen freigeben (kein freies `?url=`); `Authorization` nicht generisch weiterleiten, sondern serverseitig aus Session/Key-Vault setzen; Request-Logs ohne `Authorization`/Secrets-Header.

**12. [web/src/core/workspace.ts:39-52] — Seiteneffekte im Getter `getActiveWorkspaceId`**
`getDbName()` (`db.ts:13`) ruft `getActiveWorkspaceId()` auf, die bei leerem Zustand **neue Workspace-Registrierung + `setActiveWorkspaceId`-Schreibzugriff auf localStorage** ausführt. Zwei Tabs parallel beim ersten Start erzeugen zwei `Default`-Workspaces (Race auf `listWorkspaces()`/`saveWorkspaces`); jeder beliebige Aufrufer, nur „lesen“ wollend, triggert State-Mutation.
→ **Fix:** Getter rein halten (nur lesen, kein auto-create); Workspace-Anlage als explizite, einmalige Initialisierungsfunktion mit Lokalisierungssperre/Lock-Key (z. B. `localStorage`-Write mit CAS via `sessionStorage`-Token) machen.

**13. [web/src/core/app_store_db.ts:29-59,78-85] — `listInstalled` lädt gesamte Workspace-Dateiinhalt ein**
`listFiles()` liefert **alle** Dateien inkl. vollen `content` (`memory.ts:175-177`, `AppController.ts:195-198`) → für 10 MB Workspace-Dateien werden 10 MB in den JS-Heap gezogen, nur um 5 Manifeste zu parsen; analog `uninstallApp` (Zeile 78). Bei gleichzeitigen Writes während des Lesevorgangs inaktive Snapshot-Semantik in zwei getrennte Reads → inkonsistente Ansichten.
→ **Fix:** Bridge-Operation `listFiles(dir)` mit nur Pfaden + optional `readFile` für Manifeste; `uninstallApp` mit `listFiles(dir)`-Variante; beide Aufrufe als atomare Bridge-Operation im AppController bündeln.

**14. [web/src/core/backup.ts:55] — Stillschweigende Truncierung auf 10 000 Memory-Einträge**
`searchAllMemory(10000)` exportiert nur die letzten 10k; bei großen Beständen bleibt der Rest ohne Hinweis (manifest kennt die Zahl nicht) → Nutzer-Backup ist unvollständig, aber sieht „vollständig“ aus.
→ **Fix:** `manifest.json` um `memory_total`/`memory_exported`/`sessions_total`-Felder erweitern; bei Truncierung Warnung im Export-UI und in der Datei selbst (`"truncated": true`).

## NIEDRIG

**15. [web/src/core/workspace.ts:186] vs [db.ts:10] — Duplizierte `DB_VERSION`**
`copyDatabase` hardcodet `const DB_VERSION = 6` statt `DB_VERSION` aus `db.ts` zu importieren → Versions-Drift bei Schema-Bump; dieselbe Store/Erschaffungslogik ist 3× kopiert (db.ts:62-79, workspace.ts:194-242).
→ **Fix:** Gemeinsame `createSchema(db)`-Helfer in `db.ts` exportieren, in beidem nutzen.

**16. [web/src/core/presets.ts:18-21] — `proxyPath` erzwingt `https`**
`location.host` wird mit hartcodiertem `https` vorangestellt. Dev-Setup unter `http://localhost` erzeugt `https://localhost/...`-URLs → Fehlschlag; `location.protocol` nicht berücksichtigt.
→ **Fix:** `const proto = location.protocol === 'https:' ? 'https' : 'http';` bzw. relativ-Pfade verwenden, wenn die API originident ist.

**17. [web/src/core/global_errors.ts:52,12-33] — Unbegrenzte `event.reason`-Objekte in Logs**
`details.reason = event.reason` kann zirkuläre/gigantische Objekte sein → `JSON.stringify`/StructuredClone beim IDB-Write schlägt fehl → exakt der Crash-Log, der gebraucht wird, kommt nie an. Auch `errorStack`-Strings ohne Längenlimit.
→ **Fix:** `safeStringify` (Circular-Depths, Länge ≤ 2 k) für alle `details`-Felder; Reason als `String(reason)` + `name` + `stack` persistieren, nicht rohes Objekt.

---

## Zusammenfassung
Die kritischsten Lücken liegen in (a) dem faktisch offenen CORS/SSRF-Proxy, (b) dem Backup/Restore-Pfad, der binäre Dateien verliert, API-Keys überschreibt und nicht atomar importiert, und (c) der einmalig, vorkopierend ausgeführten Legacy-Migration, die bei Teilversagen nicht idempotent nachholt. Zusätzlich bestehen reale Race-Conditions in `saveSession` und `openDB`-Workspace-Wechsel sowie unvalidierte Pfadbilder in `InstalledAppStore`. Priorität: Proxy-Schutz (Allowlist/Block) → Backup (Binary, Atomicity, Keys) → Migration (Atomarität, Retry, Verifikation) → DB-Races (transaktionsgebundene RMW) → App-Store-Pfad.
