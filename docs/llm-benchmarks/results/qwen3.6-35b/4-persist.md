[0m
> build · ollama/qwen3.6:35b
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
# CODE-REVIEW PERSISTENZ + INFRASTRUKTUR

## KRITISCH

### SECTION [web/src/core/cors_fetch.ts:15] SSRF-Schwäche via Proxy
**Problem:** `proxiedUrl` validiert das Ziel nicht gegen ein Allowlist. Angreifer könnten interne Endpunkte über `http://127.0.0.1:6379/` oder Cloud-Metadaten (`http://169.254.169.254/`) erreichen.
**Verbesserung:** Implementiere eine Allowlist mit validiertem URL-Parsing und Blockliste für private IP-Bereiche (RFC 1918).

### SECTION [web/src/core/cors_fetch.ts:29] Keine HTTP-Response-Validierung
**Problem:** `corsFetch` gibt fehlerhafte Responses (4xx/5xx) einfach durch ohne Prüfung. Proxied miniApps erhalten keinen Hinweis auf Proxy-Fehler vs. Zielfehler.
**Verbesserung:** Füge Response-Status-Prüfung hinzu und setze einen Header `X-Proxied: true` für bessere Debugging.

### SECTION [web/src/core/backup.ts:147] API-Keys werden unbemerkt im Backup gespeichert
**Problem:** `includeApiKeys` Parameter wird von aufrufender Stelle ignoriert — die Config-Klone-Variable (`configClone`) ist undefiniert (Zeile 63 verwendet `configClone.apiKey`, aber es gibt nur `current`). API-Keys könnten im Klartext gespeichert werden.
**Verbesserung:** Korrigiere die Variable `configClone` zu `restoredConfig` und setze einen klaren Default für `includeApiKeys` auf `false`.

### SECTION [web/src/core/backup.ts:53] Promise.all mit fehlerhafter Session-Verarbeitung
**Problem:** `this.memory.listSessions().then(list => list.map(s => ...))` — der Typ von `listSessions()` ist unbekannt (kann nicht als `Session[]` garantiert werden). Definiere einen korrekten Error-Fallback.

### SECTION [web/src/core/db.ts:248] deleteDatabase ohne Abort-Schutz
**Problem:** `resetLocalData` löscht die DB synchron über `indexedDB.deleteDatabase()`, während gleichzeitig UI-Komponenten Leseläufe anstoßen können. Dies führt zu `IDBException: Version mismatch`.
**Verbesserung:** Verwende einen Mutex/Lock für alle persistenzkritischen Operationen.

---

## HOCH

### SECTION [web/src/core/workspace.ts:91] Race Condition bei workspace deletion + active workspace check
**Problem:** localStorage ist synchron und getrennt vom IndexedDB-Zustand. deleteWorkspace prüft `localStorage` für workspaces (Zeile 92), löscht dann die IndexedDB-Datenbank, und wechselt im Anschluss den aktiven workspace in localStorage. Wenn währenddessen ein anderer Tab oder Prozess einen neuen workspace anlegt, wird der falsche als "default" gesetzt.
**Verbesserung:** Verwende eine einzige Quelle of truth — speichere workspaces auch in IndexedDB under einer zentralen "registry"-Tabelle und prüfe den Zustand atomar im Transaktionskontext.

### SECTION [web/src/core/workspace.ts:246] copyDatabase liest während Progress ohne Isolation
**Problem:** Beim Copy aller Stores gibt es keine Behandlung von Konflikten: Wenn zwei Instanzen zur selben Zeit kopieren, kann die Reihenfolge der Einträge undefiniert sein. `store.put` überschreibt ohne Merging-Strategie.

### SECTION [web/src/app_store_db.ts:67] Keine Transaktionen während multi-file installApp
**Problem:** installApp (Zeile 67) ruft mehrere `bridge({ type: 'writeFile' })` auf, aber jede ist ein einziger Aufruf ohne Atomic-Transaktion. Wenn Zeile 2 fehlschlägt, ist der App-Zustand inkonsistent — Teil installiert.
**Verbesserung:** Alle Dateien in einem einzigen Transaktions-Kontext schreiben oder einen Rollback bei Fehler durchführen.

### SECTION [web/src/core/backup.ts:142] Restore überschreibt API-Keys ohne Konsistenzprüfung
**Problem:** restoreConfig (Zeile 139) klont `current` und `config` mit `{ ... }` — die flache Kopie kopiert verschachtelte Objekte als Referenzen. Bei großen Konfigurationsobjekten mit tiefen Datenstrukturen kommt es zu unbeabsichtigtem Sharing und Race Conditions zwischen alten und neuen Konfigurationen.

---

## MITTEL

### SECTION [web/src/core/db.ts:65] Schema-Migration nicht versioniert
**Problem:** `createIndex('created_at', 'created_at', { unique: false })` wird bei jedem Open ohne Versionsprüfung aufgerufen (Zeile 64-65). Bei falscher DB-Version kann das zu Duplikatfehlern führen.

### SECTION [web/src/core/memory.ts:17] Type Coercion `as T` in db.ts
**Problem:** Der generische Typ `T` wird von außen als `cursor.value as T` gesetzt. Wenn der caller den falschen Typ übergibt, kommt es zu Laufzeitfehlern und Datenkorruption.
**Verbesserung:** Füge einen Typprüfungs-Schritt hinzu: `if (!(result instanceof expectedType)) throw new TypeError(...)`.

### SECTION [web/src/core/memory.ts:82] Fehlende transaction error propagation
**Problem:** In memory.ts Zeile 90 ist `put()` innerhalb einer writeable-Transaktion, aber der catch block oben (Zeile 94) gibt nur `false` zurück, was für Consumer schwer zu debuggen ist.

### SECTION [web/src/core/global_errors.ts:68] console.error-Wrapper ohne Rekursionsschutz
**Problem:** Der Wrapper von console.error in Zeile 68 ruft logger.error auf, welches seinerseits write to IndexedDB/LogStore aufrufen kann — was theoretisch einen unendlichen Loggings-Zyklus bei DB-Fehlern verursacht.

### SECTION [web/src/core/app_store_db.ts:40] Filterung nach `manifest` ohne Typprüfung
**Problem:** `parsed.manifest` ist eine Dynamische Eigenschaft, die vom Parser abhängt. Keine Validierung ob `manifest.name`, `manifest.version` existieren.

---

## NIEDRIG

### SECTION [web/src/core/presets.ts:18] proxyPath nutzt `location` ohne Existenzprüfung
**Problem:** `typeof location !== 'undefined'` ist korrekt aber fehlende Fehlerbehandlung wenn `location.href` ungültig ist (z.B. `data:` URLs).

### SECTION [web/src/core/global_errors.ts:40] Duplikate bei globalerror Handlern
**Problem:** `registerGlobalErrorHandlers()` prüft zwar den Flag `isRegistered`, gibt aber keine Warnung aus wenn es versucht wird, mehrmals registrieren — was zu stillschweigenden fehlgeschlagenen Initialisierung führt.

---

## 3-SATZ-ZUSAMMENFASSUNG

**KRITISCH:** Die CORS-Proxy-Implementierung ist eine erhebliche SSRF-Risikodarstellung — alle externen URLs werden ungeprüft zum Proxy weitergeleitet ohne Allowlist oder Blocking von RFC-konformen privaten IP-Bereichen. API-Key-Sicherheit im Backup wird durch Code-Bugs gefährdet (undefinierte Variable `configClone` verhindert korrektes Redacting).

Die Backup/Restore-Logik enthält mehrere Race Conditions und mangelnde Validierung — insbesondere das Restore von config mit flachen Klonen und inkonsistente Behandlung von API-Key-Trennung. deleteWorkspace ignoriert gleichzeitige Tab-/Prozess-Zugriffe auf localStorage für die active-workspace-synchronisation, was zu Datenverlust bei parallelem Gebrauch führen kann.

Priorisiere: 1) SSRF-Abwehr im CORS-Prefix-Proxier mit IP-Blockliste, 2) Backup-API-Key-Sicherheit durch Korrigieren von configClone, und 3) Arbeitsspeicher/Datei-transaktions für Workspace-Deletion um konsistente active-workspace-wechsel sicher zu stellen.
