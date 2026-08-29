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
[0m✱ [0mGrep "proxy"[90m in . · 20 matches[0m
[0m✱ [0mGrep "registerGlobalErrorHandlers|resetDBConnection|resetLocalData"[90m in web/src · 13 matches[0m
[0m✱ [0mGlob "**/proxy*"[90m in . · 1 match[0m
[0m→ [0mRead server/proxy/proxy_server.py
[0m✗ [0mRead web/src/core/sys_check.ts failed
[91m[1mError: [0mFile not found: /root/vibeAgentGo/web/src/core/sys_check.ts
[0m→ [0mRead web/src/components/SettingsWorkspaceSection.ts[90m [offset=80, limit=50][0m
# Code-Review — Persistenz & Infrastruktur (Auftrag 4/4)

## KRITISCH

**CR-1 [server/proxy/proxy_server.py:12, 30-31, 40]** — Open-Relay/SSRF: `ALLOWLIST` ist leer und erlaubter Zustand ("Empty list = allow all"). Jede Seite/Jeder mit dem Proxy kann über `?url=` auf interne Dienste (127.0.0.1, 169.254.169.254, Intranet) zugreifen. Verschärfend: `follow_redirects=True` umgeht die Allowlist-Prüfung, die nur den *initialen* Host prüft — ein erlaubter Host kann per 302 auf interne Ziele umleiten.
**Vorschlag:** `follow_redirects=False` (oder Redirects erneut gegen Allowlist/SSRF-Guards prüfen), explizite Blacklist für private/Loopback/Link-Local-Adressen (`ipaddress.is_private`, `is_loopback`, `is_link_local` nach DNS-Auflösung), und als Default eine nicht-leere Allowlist erzwingen.

**CR-2 [web/src/core/backup.ts:122-149, web/src/core/memory.ts:156-178]** — Datenzerstörung beim Backup-Import: Binärdateien werden exportiert als `content: ''` (weil `listFiles()` die Strings rendert und `writeFileBinary` `content: ''` + `binary` im Store hält) und beim Import per `writeFile(f.path, '')` zurückschrieben — das *überschreibt* die bestehenden Binärdateien im `files`-Store mit leerem Inhalt. Daneben: keine Transaktion über die drei Stores → ein Abbruch (z. B. Quota) hinterlässt einen Teilstam (localStorage schon überschrieben, IDB halb gefüllt).
**Vorschlag:** Binärdaten im Backup serialisieren (base64, `kind: 'binary'`), Import erst in Puffer validieren, dann atomar schreiben (ein readwrite-Tx pro Store, erst nach Vollvalidierung aller JSON-Payloads); alte Datensätze, die im Backup fehlen, nur bei explizitem "replace"-Modus löschen.

## HOCH

**H-1 [server/proxy/proxy_server.py:34-38, 50]** — Kopfbereichs-Weiterleitung inklusive `Cookie`: Der Request an `/api/proxy/` ist same-origin, daher hängt der Browser Cookies an — die werden ungefiltert an das beliebige Upstream-Forwarding weitergegeben. Das macht den Proxy zusätzlich zu einem Cookie-/Credential-Leak-Vektor (Kombiniert mit `Access-Control-Allow-Origin: *`).
**Vorschlag:** Whitelist der zu forwardenden Header (nur `content-type`, `authorization` falls gewollt), `cookie`, `set-cookie`, `host`, `origin`, `referer`, `user-agent` strikt filtern.

**H-2 [web/src/core/db.ts:166-212; web/src/core/logger.ts:56-91]** — `cursorAll`, `cursorByIndex` und `readLogs` haben keine `transaction.onabort`/`oncomplete`-Handler. Genau dieses Szenario wurde in `runTx` (db.ts:144) als "hängt für immer, Agent stirbt" dokumentiert und behoben — die Cursor-Pfade haben die Lücke aber nicht bekommen. Trigger: `versionchange` aus anderem Tab, GC, Quota.
**Vorschlag:** Gleicher `settle`-Mechanismus wie in `runTx` auf alle Cursor-Transaktionen auslagern.

**H-3 [web/src/core/db.ts:43-84]** — `indexedDB.open()` ohne `onblocked`-Handler und ohne Timeout. Blockiert eine zweite Tabularität/Tab die Version, hängt der Promise **unendlich** — `AppController.start()` blockiert, komplette App freeze ohne Fehlermeldung.
**Vorschlag:** `req.onblocked` loggen + Timeout (z. B. 10 s) mit verständlichem Fehler; ggf. `db.close()`-Zwang auf `versionchange`.

**H-4 [web/src/core/db.ts:237-253; web/src/core/workspace.ts:188-265]** — `resetLocalData()` löscht nur die aktive Workspace-DB; alte/andere Workspaces und `LEGACY_DB_NAME` bleiben. `deleteWorkspace` (`workspace.ts:100-105`) löst auf `onblocked`/`onerror` auf — meldet also `true`, obwohl die DB physisch existiert (z. B. andere Tab offen) und später u. U. wieder "auffällt".
**Vorschlag:** `deleteDatabase` über *alle* registrierten Workspace-IDs + Legacy name, `onblocked` nicht als Erfolg werten (retrieren + Fehlermelden).

**H-5 [web/src/core/memory.ts:81-109]** — Read-Modify-Write-Rennen bei `updateMemory` und `saveSession`: `getSession` (eigener readonly-Tx) und `put` (eigener readwrite-Tx) sind separierte Transaktionen. Zwei gleichzeitige `saveSession` (z. B. Stream-Chunk + UI-Update) führen zu Lost-Updates der `messages`.
**Vorschlag:** Einzelne `readwrite`-Transaktion, in der `get` + Modifikation + `put` geschehen (IndexedDB erlaubt mehrere Requests in einer Tx).

**H-6 [web/src/core/workspace.ts:158-171, 185-275]** — Legacy-Migration ist nicht atomar: Target-DB wird geöffnet/ersetzt, `copyDatabase` kann mid-way fehlschlagen → Workspace `default` existiert mit leerer DB während die Legacy-DB ungelöscht daneben bleibt (Duplikate bzw. Datenverlust, wenn Nutzer die Legacy-DB manuell löscht). Es gibt weder Checksummen-Vergleich noch Löschen der Quelle.
**Vorschlag:** Migration in zwei Phasen (copy → validieren: Record-Zählung/Hash-Vergleich → erst dann Legacy-DB löschen), sonst Rollback (Workspace-Registrierung entfernen).

**H-7 [web/src/core/backup.ts:137-144]** — API-Key-Handling beim Import: `config.apiKey === '[REDACTED]'` ist die *einzige* Prüfung. Ein Backup eines anderen Nutzers/Origins kann beliebige (sichere) config-Felder überschreiben; Redaction-Marker ist ein magic-string. Zusätzlich: `manifest.workspace_id` wird beim Import ignoriert → Daten landen im *aktiven* Workspace (Cross-Workspace-Verunreinigung).
**Vorschlag:** Structured check `manifest.version` + expliziter User-Prompt mit Workspace-Ziel; Config-Merge nur auf Whitelist-Felder.

## MITTEL

**M-1 [web/src/core/memory.ts:72-97, 185-192]** — `deleteMemory`/`updateMemory`/`deleteFile`/`deleteSession` schlucken alle Errors (`catch → false`) und `deleteSession` gibt `false` zurück, das von Aufrufern leicht ignoriert wird. Gleichzeitig liefert `getMemories` bei Index-Fehler eine *silent-fallback*-Liste — Aufrufer können nicht zwischen "leider leer" und "Fehler" unterscheiden.
**Vorschlag:** Errors loggen (mindestens `logger.warn`) und/oder `null` vs. `false` unterscheiden.

**M-2 [web/src/core/global_errors.ts:49-56] + [web/src/core/logger.ts:100]** — `unhandledrejection` wird per `preventDefault()` unterdrückt, der *einzige* Verbleib ist fire-and-forget `writeLog().catch(()=>{})`. Schlägt die DB-Write schlicht fehl (Quota, GC), ist der Fehler unwiederbringlich verloren.
**Vorschlag:** Fallback-Queue in `sessionStorage` bei DB-Fehler; zusätzlich `console.error` (das ohnehin gehookt wird, aber die Hook ist zirkulär — direkt `originalError` aufrufen).

**M-3 [web/src/core/workspace.ts:39-52]** — `getActiveWorkspaceId` (Getter) hat Seiteneffekte: erzeugt Workspace, schreibts in localStorage. Wird u. a. aus `db.getDbName()` (default-Arg) aufgerufen. Multi-Tab/SSR-ähnliche Kontexte riskieren Inconsistency.
**Vorschlag:** Side-Effect in `init()`/`createDefaultWorkspace()` outsource; Getter rein lesend.

**M-4 [web/src/core/backup.ts:51-100]** — Export ruft `listSessions()` (Index `updated_at`) und dann *einzelne* `getSession(id)`-Runden — bei 10.000 Sessions sind das 10.001 Sequelt-Transaktionen ohne Backpressure; und `files`-Export liest *alle* Inhalte (inkl. Apps) in einen JSZip-Blob → OOM-Risiko bei großen Workspaces.
**Vorschlag:** Chunking via `cursorAll` mit Pufferlimit, `zip.file` pro Record, statt `Promise.all` (die zusätzlich *parallel* `getSession` ruft).

## NIEDRIG

**N-1 [web/src/core/presets.ts:18-21]** — `proxyPath` fällt auf hardcodetes `vag.vibeops.de` zurück, wenn `location.host` fehlt. Inconsistent mit `cors_fetch.ts:7` (relativer `/api/proxy/`).
**Vorschlag:** Relativen Pfad (`/api/kimi`) verwenden, damit der Browser ihn gegenüber `location.origin` auflöst.

**N-2 [web/src/core/global_errors.ts:75]** — Rekursions-Filter via `!message.startsWith('[')` ist fragil (abhängig vom internen Log-Format in `logger.ts:38`).
**Vorschlag:** Symbolic Marker (z. B. `WeakSet<args[0]>`) oder `// isLoggerCall` Flag.

**N-3 [web/src/core/main.ts:10-11]** — Keine Error-Capture vor `new AppController()` (z. B. Import-Fehler, Constructor-Throw) — `registerGlobalErrorHandlers()` liegt *innerhalb* von `start()`.
**Vorschlag:** Handler-Registrierung sofort nach Import, vor `new AppController()`.

**N-4 [web/src/core/db.ts:110-116] + [web/src/core/db.ts:21-42]** — `withDBRetry` setzt `dbPromise = null`, während *andere* Callers noch mit der *alten* Referenz arbeiten (deren `openDB().then(...)` ist bereits gerollt). Das ist der eigentliche Trigger für H-2/H-3.
**Vorschlag:** Zentrale Connection-Registry mit Versionsnummer, alte References auf `close()`/`abort()` markieren, statt stiller Invalidation.

---

## Zusammenfassung (3 Sätze)

Die kritischsten Funde sind der fehlende SSRF-Schutz und die offene Allowlist im selbstgehosteten CORS-Proxy sowie die stille Datenzerstörung binärer Dateien beim Backup-Import. Die Persistenzschicht hat systematisch ungeschützte Cursor-Promises (Hang-Gefahr), nicht-atomare Read-Mod-Write-Operationen und eine unvollständige `resetLocalData`. Insgesamt: die Architektur (eine IDB-Connection, Workspace-isolierung, Logger) ist konsequent, aber Robustheit gegen Race-Conditions, Quota- und Multi-Tab-Szenarien ist nicht durchgängig umgesetzt.
