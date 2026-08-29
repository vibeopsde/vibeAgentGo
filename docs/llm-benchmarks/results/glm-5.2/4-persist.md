[0m
> build · ollama/glm-5.2
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
[0m✱ [0mGrep "proxy"[90m in . · 0 matches[0m
[0m✱ [0mGlob "**/proxy*"[90m 1 match[0m
Let me check the proxy backend implementation to assess SSRF risk.
[0m→ [0mRead server/proxy/proxy_server.py
# Code-Review AUFGABE 4/4 — PERSISTENZ + INFRA

## SECTION [cors_fetch.ts:13-18 + proxy_server.py:16-44] — KRITISCH — SSRF über CORS-Proxy ohne feste Allowlist

**Problem:** Der Proxy akzeptiert beliebige `http`/`https`-Ziele (`ALLOWLIST` ist leer, wenn `VAG_PROXY_ALLOWLIST` nicht gesetzt). Die Client-Funktion `proxiedUrl()` schickt jede Cross-Origin-URL ungefiltert durch den Proxy. Das ermöglicht Server-Side Request Forgery: ein Angreifer (oder eine generierte Mini-App, die `window.corsFetch` nutzt) kann den Server zwingen, Requests an interne Dienste zu senden (z.B. `http://169.254.169.254/...` für Cloud-Instanz-Metadaten, `http://localhost:port/...` für interne Dienste). `follow_redirects=True` eröffnet zusätzlich Redirect-basierte SSRF-Umgehung selbst dann, wenn eine Host-Allowlist existiert (Server erlaubt `example.com`, dieser antwortet mit `302 → http://169.254.169.254/`).

**Verbesserung:**
- `ALLOWLIST` darf nicht per Default leer (= allow all) sein — leer sollte `deny all` bedeuten, oder es muss eine sinnvolle Default-Set geben.
- Redirects vor der Verfolgung validieren: `follow_redirects=False`, dann jeden `Location`-Header selbst parsen und gegen Allowlist prüfen, bevor weitergeleitet wird.
- Private IP-Ranges (RFC1918, 169.254.0.0/16, 127.0.0.0/8, ::1) blockieren, z.B. via `ipaddress.ip_address(host).is_private`.
- Zusätzlich: nur Methoden zulassen, die sinnvoll sind (`GET`, `POST`), und Request-Body-Größe limitieren.

---

## SECTION [proxy_server.py:50] — HOCH — `Access-Control-Allow-Origin: *` auf Proxy mit Auth-Weiterleitung

**Problem:** Der Proxy setzt `Access-Control-Allow-Origin: *` und leitet `Authorization`-Header weiter (`request.headers.items()` filtert nur `host/origin/referer/accept-encoding`). Damit kann jede beliebige Third-Party-Website den Proxy nutzen und ggf. Browser-Credentials (Cookies) des Nutzers an beliebige Ziele weiterleiten. Zwar wird `credentials: include` bei `*`-CORS vom Browser blockiert, aber `Authorization`-Header aus expliziten `fetch`-Init-Objekten der eigenen Mini-Apps können so von fremten Sites missbraucht werden, falls diese die Proxy-URL erraten/kennen.

**Verbesserung:** `Access-Control-Allow-Origin` auf die tatsächliche App-Origin reflektieren (oder eine feste Allowlist der Origins), nicht `*`. Alternativ den `Authorization`-Header strippen und nur App-interne Auth verwenden.

---

## SECTION [db.ts:145] — HOCH — `transaction.oncomplete` löst Promise doppelt auf / konfligiert mit `req.onsuccess`

**Problem:** In `runTx` werden sowohl `req.onsuccess` als auch `transaction.oncomplete` registriert, die beide `resolve(req.result)` aufrufen. Das `settled`-Flag verhindert zwar eine zweite Auflösung des Promises, aber bei `readwrite`-Transaktionen ist das `req.onsuccess`-Event gefeuert **bevor** die Transaktion committed ist. Wird der Promise-Wert (z.B. ein autoIncrement-Key) von Aufrufern verwendet, um sofort weitere Operationen anzustoßen, die von diesem Commit abhängen, kann es zu Konsistenzproblemen kommen. Kritischer: Bei `readwrite`-Transaktionen, die nach `req.onsuccess` noch aborten (z.B. Quota-Exceeded), liefert die Promise bereits `resolve`, obwohl die Daten nicht persisted wurden — der Aufrufer glaubt, die Operation sei erfolgreich.

**Verbesserung:** Bei `readwrite`-Transaktionen ausschließlich auf `transaction.oncomplete` resolven und auf `transaction.onabort`/`req.onerror` rejecten. `req.onsuccess` nur für `readonly` oder wenn das Ergebnis vor Commit benötigt wird. Beispiel:
```ts
const resolveOnComplete = mode === 'readwrite';
req.onsuccess = () => { if (!resolveOnComplete) settle(() => resolve(req.result as T)); };
transaction.oncomplete = () => { if (resolveOnComplete) settle(() => resolve(req.result as T)); };
```

---

## SECTION [db.ts:114] — MITTEL — Retry-Bedingung `attempt === 0` erlaubt nur einen Retry, aber recursion setzt nicht zurück

**Problem:** `withDBRetry` retryt bei recoverable Fehlern genau einmal (`attempt === 0`). Das ist gut, aber der Retry ruft `runTx` auf, das erneut `openDB()` aufruft. Wenn `openDB` selbst fehlschlägt (z.B. `onupgradeneeded` wirft, oder Quota bei Versions-Upgrade), wird dieser Fehler nicht als recoverable behandelt und der Retry verpufft. Zudem gibt es keine Backoff-Verzögerung — bei gleichzeitigen Tabs, die alle auf denselben `versionchange` reagieren und retryen, entsteht ein Thundering-Herd.

**Verbesserung:** Kleinen `await setTimeout(50ms)` vor dem Retry einbauen. `openDB`-Fehler in der Retry-Logik mit berücksichtigen.

---

## SECTION [db.ts:237-252] — MITTEL — `resetLocalData` löscht nur die aktive Workspace-DB, nicht alle

**Problem:** `resetLocalData` löscht nur `getDbName()` (die aktuell aktive Workspace-DB). Alle anderen Workspaces (`vibeAgentGo-agent-<wsId>`) bleiben in IndexedDB erhalten, obwohl `localStorage.removeItem('vibeAgentGo-workspaces')` die Registry leert. Das sind verwaiste Datenbanken, die nie mehr erreichbar sind und Speicher verbrauchen — ein Datenschutzhinweis-Problem ("Reset" suggeriert vollständige Löschung).

**Verbesserung:** Vor dem Löschen der Registry die Workspace-Liste auslesen und jede DB einzeln `deleteDatabase`'en. Oder `indexedDB.databases()` (wo unterstützt) nutzen, um alle `vibeAgentGo-agent-*` DBs zu finden und zu löschen.

---

## SECTION [memory.ts:143-164] — MITTEL — `writeFileBinary` speichert `content: ''` zusätzlich zu `binary` — Datenmodell-Ambiguität

**Problem:** `writeFileBinary` setzt `{ path, content: '', binary: buffer }`. `readFile` (text) prüft `result?.content || null` — bei einer Binärdatei ist `content` leerer String → `'' || null` ergibt `null`, ok. Aber `listFiles` returned alle Files mit `content`-Feld, das für Binärdateien `''` ist. Jeder Consumer, der `listFiles()` nutzt und Content annimmt, bekommt leere Strings für Binärdateien ohne zu wissen, dass es Binärdateien sind. `searchFiles` mit `target: 'content'` würde Binärdateien überspringen (leerer Content), was ok ist, aber implizit und nicht kommuniziert.

**Verbesserung:** Ein `type: 'text' | 'binary'`-Feld im File-Record einführen oder `listFiles` um einen `isBinary`/`hasBinary`-Flag ergänzen, damit Consumer korrekt dispatchen können.

---

## SECTION [backup.ts:103-149] — HOCH — Import ohne Transaktion / nicht-atomar → Datenverlust bei Abbruch

**Problem:** `importZip` restored Daten via `Promise.all(memory.map(... saveMemoryRaw))`, `Promise.all(sessions.map(... saveSession))` und `Promise.all(files.map(... writeFile))`. Jede dieser Operationen ist eine eigene IndexedDB-Transaktion. Wenn der Import nach 50% abbricht (Fehler in einem `saveSession`, Quota-Exceeded, Tab-Schließen), ist die Datenbank in einem **gemischten Zustand**: alte Daten teilweise überschrieben, neue Daten nur teilweise drin, Konsistenz gebrochen. Es gibt keinen Rollback. Zudem überschreibt `saveMemoryRaw` mit `store.put(entry)` bestehende IDs — bestehende Daten werden ohne Warnung gelöscht/überschrieben.

**Verbesserung:**
1. Vor dem Import ein automatisches Backup des aktuellen Zustands erstellen (oder zumindest flaggen, dass ein Import läuft).
2. Alle Schreiboperationen pro Store in **einer** IndexedDB-Transaktion bündeln (statt `Promise.all` über einzelne `tx`-Aufrufe). Dafür braucht `db.ts` eine `txBatch(storeNames[], fn)`-Methode.
3. Beim Import-ID-Konflikt (bestehende ID) den User fragen oder Merge-Strategie definieren, statt blind `put`.

---

## SECTION [backup.ts:51-100] — MITTEL — Export liest `searchAllMemory(10000)` — Memory >10k geht verloren

**Problem:** `exportZip` capped Memory bei 10.000 Einträgen (`searchAllMemory(10000)`). Wenn ein Nutzer mehr hat, fehlen diese im Backup — stillschweigend, ohne Warnung im Manifest. Gleiches gilt implizit für Sessions, die via `listSessions()` alle geholt werden, aber `fullSessions` kann bei sehr vielen Sessions an `Promise.all`-Limits scheitern (Speicher).

**Verbesserung:** Entweder ohne Limit exportieren (`searchAllMemory(Infinity)`) oder im Manifest die Anzahl gespeicherter vs. tatsächlicher Einträge vergleichen und warnen, wenn trunciert wurde.

---

## SECTION [backup.ts:119] — NIEDRIG — `loadJson('theme.json')` gibt `undefined` wenn Datei fehlt, `?? null` greift nicht bei JSON-null

**Problem:** `theme.json` enthält `JSON.stringify(backup.theme)` — wenn `theme` `null` war, steht `"null"` in der Datei, `JSON.parse("null")` ergibt `null`, `?? null` ist ok. Wenn die Datei **fehlt**, `loadJson` returned `undefined`, `?? null` ergibt `null`. Aber: wenn die Datei `"null"` enthält (gesetzter Theme war null), kann der Import nicht zwischen "Theme war null" und "Theme-Datei nicht vorhanden" unterscheiden. Klein, aber semantisch unpräzise.

**Verbesserung:** Nur `theme.json` schreiben, wenn `theme !== null`, dann im Import `undefined` = "nicht überschreiben" vs. `null` = "Theme löschen".

---

## SECTION [workspace.ts:185-275] — MITTEL — `copyDatabase` dupliziert Schema-Setup und nutzt hardcodierte `DB_VERSION=6`

**Problem:** `copyDatabase` repliziert das komplette Schema-Setup aus `db.ts` (Stores, Indexes) mit hardcodiertem `DB_VERSION = 6`. Wenn `db.ts` auf v7 upgradet und hier vergessen wird, schlägt die Legacy-Migration stillschweigend fehl oder erzeugt ein falsches Schema. Zudem: `copyDatabase` öffnet die Source-DB mit `indexedDB.open(sourceName, DB_VERSION)` — das triggert ggf. `onupgradeneeded` auf der Source und erstellt dort Stores, die nicht existierten (Nebeneffekt auf die "alten" Daten).

**Verbesserung:** Schema-Setup in eine exportierte Funktion `applySchema(db)` in `db.ts` extrahieren und aus beiden Stellen aufrufen. Source-DB ohne Versionsspezifikation öffnen (`indexedDB.open(sourceName)`) um kein Upgrade zu triggern.

---

## SECTION [workspace.ts:91-113] — MITTEL — `deleteWorkspace` löscht DB auch wenn andere Tabs sie noch nutzen

**Problem:** `deleteWorkspace` ruft `indexedDB.deleteDatabase(dbName)` auf. Wenn ein anderer Tab die DB noch geöffnet hat (gleicher Workspace aktiv), feuert `onblocked` — der Code resolved aber sofort (`resolve()`), ohne zu warten. Die DB ist nicht gelöscht, aber die Workspace-Registry bereits entfernt. Der andere Tab operiert auf einer Phantom-DB, schreibt Daten, die nach Tab-Schließen verwaist sind.

**Verbesserung:** `onblocked` sollte warnen/retryen; vor `deleteDatabase` prüfen, ob andere Tabs aktiv sind (BroadcastChannel) oder den User auffordern, andere Tabs zu schließen. Mindestens `onblocked` nicht als Success behandeln.

---

## SECTION [memory.ts:72-79, 132-139, 185-192] — MITTEL — `deleteMemory`/`deleteSession`/`deleteFile` swallow Fehler

**Problem:** Diese Methoden fangen alle Fehler mit `catch {}` ab und returnen `false`. Der Aufrufer erfährt nicht, **warum** gelöscht werden konnte — ob der Eintrag nicht existierte (erfolg) oder die Transaktion abortierte (Daten noch da). Bei `deleteFile` z.B. liefert `false` sowohl "Datei nicht gefunden" als auch "Quota-Error beim Löschen" — der UI zeigt evtl. "gelöscht", aber die Datei ist noch da.

**Verbesserung:** Unterscheiden zwischen "nicht gefunden" (vorab `get` prüfen) und "Fehler" (Fehler weiterreichen oder zumindest loggen via `logger.error`). Mindestens `logger.error` im `catch`-Block, nicht komplett stumm.

---

## SECTION [memory.ts:101-109] — MITTEL — `saveSession` hat Race Condition: Read-then-Write ohne Transaktion

**Problem:** `saveSession` liest erst `getSession(id)` (eigene Transaktion), dann schreibt es mit `store.put` (zweite Transaktion). Zwischen Read und Write kann ein anderer Tab dieselbe Session updaten — der erste Tab überschreibt dann die Änderungen des zweiten ("Lost Update"). Klassische TOCTOU-Race.

**Verbesserung:** Read und Write in **einer** `readwrite`-Transaktion ausführen (dafür `db.ts` um eine `txReadWrite(store, fn(store))`-Methode erweitern, die `fn` den Store gibt und innerhalb derselben Tx `get` + `put` erlaubt). Bei mehreren Tabs additionally `BroadcastChannel`-Synchronisation oder Last-Write-Wins per `updated_at`-Vergleich.

---

## SECTION [app_store_db.ts:75-86] — MITTEL — `uninstallApp` löscht anhand von `path.startsWith(basePath + '/')` ohne Pfad-Normalisierung

**Problem:** `uninstallApp` iteriert alle Files und löscht die, deren Pfad mit `${basePath}/` beginnt. `basePath` = `apps/${category}/${id}`. Wenn `id` oder `category` manipulated wurden (z.B. `id = '../system'`), ist `basePath = apps/category/../system` → nach Normalisierung `apps/system` → `startsWith('apps/category/../system/')` ist aber false für `apps/system/...`. Eigentlich sicher gegen Path-Traversal (weil String-Match ohne Normalisierung), ABER: umgekehrt kann eine App mit `id = 'foo'` die Files einer App mit `id = 'foobar'` **nicht** löschen (`startsWith('apps/cat/foo/')` ≠ `apps/cat/foobar/`), was korrekt ist. Das eigentliche Risiko: `installApp` schreibt ohne Pfad-Validierung — `app.category`/`app.id` könnten `../../etc` enthalten und zu Writes außerhalb von `apps/` führen (über die Bridge).

**Verbesserung:** `appPath` sollte `category` und `id` validieren (nur `[a-z0-9-]+`), und `installApp`/`uninstallApp` vor dem Pfad-Bau prüfen, dass keine `..`/`/`-Segmente enthalten sind.

---

## SECTION [global_errors.ts:53] — MITTEL — `event.preventDefault()` bei `unhandledrejection` unterdrückt echten Bug sichtbar

**Problem:** `preventDefault()` auf `unhandledrejection` verhindert den Console-Error. Das ist gut für die UX, aber gefährlich: ein echter unbehandelter Promise-Rejection (z.B. DB-Schreibfehler) taucht im DevTools-Console nicht mehr als Error auf, nur noch im Logger (der auch via IndexedDB schreibt — wenn die DB down ist, geht der Fehler komplett verloren).

**Verbesserung:** `preventDefault()` entfernen oder nur aufrufen, wenn der Logger erfolgreich schreiben konnte. Mindestens `originalConsoleError` zusätzlich aufrufen, damit DevTools den Fehler zeigt.

---

## SECTION [presets.ts:18-21] — NIEDRIG — `proxyPath` nutzt `location.host` → in Dev fester Host `vag.vibeops.de` möglich

**Problem:** `proxyPath` fällt auf `'vag.vibeops.de'` zurück, wenn `location` undefined ist (SSR/Tests). In Dev (`localhost:5173`) wird `https://localhost:5173/api/kimi` erzeugt — ok. Aber wenn die App via `file://` oder non-HTTP-Context geladen wird, ist `location.host` leer → `https:///api/kimi` (ungültig).

**Verbesserung:** Validate `location.host` ist nicht leer, sonst klaren Fallback oder Fehler.

---

## SECTION [db.ts:247-252] — NIEDRIG — `resetLocalData` resolved bei `onerror`/`onblocked` trotzdem

**Problem:** `indexedDB.deleteDatabase` resolved immer, auch bei Fehler/blockiert. Aufrufer kann nicht erkennen, ob die DB wirklich gelöscht wurde. Bei "Reset my data"-Button zeigt die UI Erfolg, obwohl Daten noch da sind.

**Verbesserung:** Reject bei `onerror`, bei `onblocked` Hinweis an User.

---

## Zusammenfassung

Die gravierendsten Funde sind **SSRF über den CORS-Proxy** (keine Default-Allowlist, Redirect-Verfolgung ohne Re-Validierung) und der **nicht-atomare Backup-Import** der bei Abbruch eine inkonsistente DB hinterlässt — beides adressiert Datenvertraulichkeit bzw. Datenintegrität auf Architekturebene. Ebenso kritisch ist, dass `runTx` bei `readwrite`-Transaktionen bereits auf `req.onsuccess` resolved, bevor die Tx committed ist — Aufrufer operieren auf potenziell nicht persistierten Daten. DieRace Conditions (Lost-Update bei `saveSession`, gleichzeitige DB-Zugriffe über Tabs ohne Synchronisation) und das stumme Schlucken von Löschfehlern mindern die Zuverlässigkeit im Mehrfenster-Betrieb. Insgesamt ist die Persistenz-Schicht funktionsfähig, aber für gleichzeitige Bearbeitung und fehleranfällige Umgebungen (Quota, Multi-Tab) nicht robust genug; der Proxy muss zwingend gehärtet werden, bevor er produktiv Mini-Apps ausführt.
