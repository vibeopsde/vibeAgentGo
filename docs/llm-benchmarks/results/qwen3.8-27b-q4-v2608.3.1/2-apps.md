[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m→ [0mRead web/src/apps/TextEditorApp.ts
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m→ [0mRead web/src/core/appManifest.ts
[0m✱ [0mGrep "parseAppManifest"[90m in web/src · 6 matches[0m
[0m✱ [0mGrep "document\.addEventListener|window\.addEventListener|setInterval|setTimeout"[90m in web/src/components/MemoryPanel.ts · 9 matches[0m
[0m→ [0mRead web/src/core/app_store_db.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m→ [0mRead web/src/types/index.ts
# Code-Review — APPS

---

## ExplorerApp.ts

### [ExplorerApp.ts:272] — MITTEL — Fehlerbehandlung / Performance
`new Blob([file.content]).size` erzeugt bei jedem `render()` einen kompletten Blob nur um die Byte-Größe einer Datei zu ermitteln. Bei großen Dateien (mehrere MB) ist das vermeidbarer Overhead. Da `file.content` bereits im Speicher liegt, genügt `new TextEncoder().encode(file.content).length` – besser noch: die Größe serverseitig mitliefern oder `file.content.length` (UTF-16-Codeunits) mit Hinweis verwenden.

**Vorschlag:** Größe in der `FileEntry`-Struktur vom Bridge-/IndexedDB-Layer befüllen lassen; Blob-Konstruktion eliminieren.

---

### [ExplorerApp.ts:273] — MITTEL — Performance
`file.content.split('\n').length` splittet den gesamten Inhalt einer Datei in ein Array, nur um die Zeilenanzahl zu wissen. Bei einer Datei mit 200k Zeilen sind das 200k String-Objekte, die sofort wieder verworfen werden.

**Vorschlag:** `(file.content.match(/\n/g) || []).length + 1` oder besser: Zeilenanzahl vom Backend liefern lassen.

---

### [ExplorerApp.ts:74-77] — HOCH — Performance / DOM
Jedes einzelne Keystroke auf der Suchein­gabe löst `this.render()` aus, das `listEl.innerHTML = ''` (Zeile 193) aufruft und **die gesamte Baumstruktur neu aufbaut** (Sort, Tree-Build, rekursive `renderNode` mit je 5-8 Event-Listenern pro Knoten). Bei 5000 Dateien und schnellem Tippen entsteht ein ständiger DOM-Abriss.

**Vorschlag:** Suche debounce­n (z. B. 200 ms `setTimeout`), und/oder nur die gefilterte Liste in ein isoliertes `<div>` rendern statt den kompletten Baum.

---

### [ExplorerApp.ts:310] — MITTEL — Bug
`const isFolder = i < parts.length - 1 || part === '.keep';` markiert **jede** Datei namens `.keep` als Ordner. Eine legitime Datei `.keep` mit Inhalt wird dadurch in `renderNode` (Zeile 329: `if (node.name === '.keep' && node.isFolder) return;`) unsichtbar – sie kann weder geöffnet noch gelöscht werden.

**Vorschlag:** `.keep` nur dann als Ordner-Platzhalter behandeln, wenn der Pfad tatsächlich ein Verzeichnis darstellt (z. B. `content === ''` prüfen) oder das Konstrukt auf eine dedizierte Ordner-Metadaten-Datei umstellen.

---

### [ExplorerApp.ts:470-471, 737-738, 779-783] — HOCH — Fehlerbehandlung / Datenintegrität
Alle Umbenenn- und Move-Operationen folgen dem Muster: *zuerst alle neuen Dateien schreiben, dann alte löschen* – ohne `try/catch`, ohne Prüfung der Bridge-Antwort, ohne Rollback. Schlägt ein `writeFile` oder `deleteFile` fehl (Timeout, quota error), bleibt die Datei in **beiden** Orten oder in keinem existieren. Bei `renameFolder` (Zeile 777-783) betrifft dies potenziell Dutzende Dateien.

```typescript
// Aktuell (Zeile 777-783):
for (const file of affected) {
  const newFilePath = file.path.replace(oldPath, safePath);
  await this.onBridgeRequest?.({ type: 'writeFile', path: newFilePath, content: file.content });
}
for (const file of affected) {
  await this.onBridgeRequest?.({ type: 'deleteFile', path: file.path });
}
```

**Vorschlag:** (1) Jede Bridge-Antwort auf `res?.ok` prüfen. (2) Bei Fehler: bereist geschriebene Dateien wieder löschen (Rollback). (3) Ideal: Bridge-Erweiterung `renameFile` für atomaren Umbenennen.

---

### [ExplorerApp.ts:852] — MITTEL — Bug
`file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '')` entfernt **sämtliche** Nicht-ASCII-Zeichen. `Übersicht.md` → `bersicht.md`, `café.txt` → `cafetext` (Punkt bleibt, `é` verschwindet). Unicode-Filenames sind praktisch unverwendbar; zwei unterschiedliche Dateien können denselben Namen erhalten.

**Vorschlag:** Nur wirklich problematische Zeichen (Path-Trenner, Steuerzeichen) entfernen; Unicode-Buchstaben/Ziffern via `/\p{L}|\p{N}/u` zulassen.

---

### [ExplorerApp.ts:185-189] — MITTEL — Fehlerbehandlung
`refresh()` hat kein `try/catch`. Ein Werfen der Bridge (z. B. IndexedDB korrupt) lässt die Exception ungebunden in `mount()` (Zeile 182) oder in Drag-Drop-Handler (Zeile 157) laufen – uncaught-Promise-Rejection.

**Vorschlag:** `try { … } catch (e) { this.showStatus(...); }` um die Bridge-Aufrufe.

---

### [ExplorerApp.ts:84-85, 88-102] — OK (kein Leck)
Document-Level-Listener (`click`, `keydown`) werden in `build()` (Konstruktor) angehängt und korrekt in `unmount()` entfernt. Kein Leck.

---

### [ExplorerApp.ts:303] — NIEDRIG — Performance
`a.path.localeCompare(b.path)` ist 10-100× langsamer als `a.path < b.path ? -1 : …`. Bei 10k Dateien in Verbindung mit dem fehlenden Debounce (siehe oben) spürbar.

**Vorschlag:** `a.path < b.path ? -1 : a.path > b.path ? 1 : 0`.

---

### [ExplorerApp.ts:839] — NIEDRIG — Bug
`new Blob([…], { type: 'text/plain' })` – der Download hat immer `text/plain` als MIME-Typ, egal ob es eine `.png`, `.pdf` oder `.html`-Datei ist. Browser zeigen dadurch keinen korrekten Öffnungs-Dialog.

**Vorschlag:** MIME-Type aus der Datei­endung ableiten (z. B. kleine Lookup-Map oder `file.type` beim Upload speichern).

---

## TextEditorApp.ts

### [TextEditorApp.ts:568-571] — HOCH — Performance (große Dateien)
```typescript
this.gutterEl.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
```
Bei einer 100 000-Zeilen-Datei: 100 000 DOM-Knoten + ein ~1 MB HTML-String werden in einem einzigen Frame gebaut. Browser freeze­n spürbar (50-200 ms+).

**Vorschlag:** Virtuelle Zeilen­nummern: nur die sichtbar­en Zeilen rendern (basiert auf `scrollTop`/`clientHeight`), oder Canvas/WebGL-basierte Gutter. Alternativ: `contenteditable`-frei mit einer `<div>` und `background: repeating-linear-gradient` für die Linien + absolute-Positionierung nur für sichtbare Nummern.

---

### [TextEditorApp.ts:107-112, 127-138] — HOCH — Performance (große Dateien)
`Prism.highlight(code, …)` wird bei **jeder** Tastatureingabe auf den **gesamten** Dateiinhalt ausgeführt. Bei einer 5000-Zeilen-TS-Datei dauert das regelmäßig 50-200 ms pro Keystroke → UI-Freeze.

**Vorschlag:** (1) Debounce des Highlightings (50-100 ms nach letzter Eingabe). (2) Auf `requestIdleCallback`/`requestAnimationFrame` auslagern. (3) Für sehr große Dateien (>100 kB) Highlighting deaktivieren oder nur den sichtbaren Bereich (Viewport) tokenisieren.

---

### [TextEditorApp.ts:338-347] — HOCH — Performance
```typescript
const line = this.textarea.value.slice(0, pos).split('\n').length;
```
Wird bei jedem `scrollToPosition`-Aufruf aufgerufen (also bei jeder Find/Prev/Next-Operation). `slice(0, pos)` kopiert bis zu den gesamten Dateiin­halt, `split('\n')` erzeugt ein riesiges Array – nur um die Zeilen­zahl bis `pos` zu zählen. Bei großen Dateien und häufiger Navigation extrem langsam.

**Vorschlag:** Zeilen-Offsets einmalig bei `load()`/`input` in ein `number[]` (kumulativ­e Offsets) vor­berechnen und per `binarySearch` die Zeile finden. Oder einfach `(value.substring(0, pos).match(/\n/g) || []).length + 1`.

---

### [TextEditorApp.ts:152-162] — NIEDRIG — Bug (Dead Code)
```typescript
if (force || this.undoStack.length === 0 || now - this.lastInputTime > this.UNDO_DEBOUNCE_MS) {
```
`this.undoStack.length === 0` ist unerreichbar: Der Stack wird in `newFile()` (Zeile 469: `['']`) und `load()` (Zeile 532: `[content]`) immer mit genau einem Eintrag initialisiert und nie geleert. Der Check ist Dead Code und suggeriert fälschlich, der Stack könnte leer sein.

**Vorschlag:** Bedingung auflösen auf `if (force || now - this.lastInputTime > this.UNDO_DEBOUNCE_MS)`.

---

### [TextEditorApp.ts:541-561] — MITTEL — Fehlerbehandlung / Race Condition
`save()` ist asynchron und enthält `await this.onBridgeRequest?.(…)`. Bei schnellem Doppelklick auf „Speichern" oder `Ctrl+S` + `Ctrl+S` laufen zwei `save()`-Aufrufe parallel; beide rufen `ensurePath()` auf (potenziell zwei `window.prompt()`-Dialoge) und schreiben nacheinander – das zweite `writeFile` kann das erste übert­reiben, ohne dass der User es weiß.

**Vorschlag:** Guard-Flag `private _saving = false`; bei bereits laufendem Save sofort returnen bzw. die zweite Request abwarten.

---

### [TextEditorApp.ts:527-539] — MITTEL — Fehlerbehandlung
```typescript
const res = await this.onBridgeRequest?.({ type: 'readFile', path: this.currentPath });
this.textarea.value = (res?.ok ? String(res.data ?? '') : '') || '';
```
Wenn `readFile` fehlschlägt (Brücke down, Date gesperrt), wird der Text­bereich auf `''` gesetzt, `savedContent = ''`, `dirty = false`, Status­anzeige „Loaded". Der User sieht eine leere Datei und kann sie **überschreiben** speichern – der Originalinhalt geht verloren.

**Vorschlag:** Bei `!res?.ok` den Ladevorgang abbrechen, Status „Load failed" setzen und `textarea.value` nicht anfassen.

---

### [TextEditorApp.ts] — NIEDRIG — DOM-Hygiene
Die Klasse implementiert `unmount?()` **nicht**. Alle Listener sind an Elemente in `this.element` gebunden und werden mit dem Element aus dem DOM entfernt – kein aktives Leck. Falls in der Zukunft globaler Listener (z. B. `beforeunload`-Warnung) hinzukommen, fehlte der cleanup-Hook.

---

## AppStoreApp.ts

### [AppStoreApp.ts:98-105, 63-68] — KRITISCH — DOM-Leak / Resource Leak
`mount()` ruft `startRefreshLoop()` auf, das ein `setInterval` (30 s) startet. Die Klasse implementiert **kein** `unmount()`. Wenn das App-Fenster geschlossen wird:
- Das `setInterval` läuft **ewig** weiter.
- Alle 30 s: `fetch()` auf remote index.json + `render()` auf ein vom DOM getrenntes Element.
- Die Closure hält `this` (ganze AppStoreApp-Instanz) am Leben → **kein GC**, ständige Netz­werk-Requests.

```typescript
// mount() Zeile 66-67:
this.startRefreshLoop();  // setInterval, nie wieder gestoppt!
this.load();
```

**Vorschlag:** `unmount(): void` implementieren, das `stopRefreshLoop()` aufruft. Zusätzlich (Defensive) `document.visibilityState` prüfen, um bei verstecktem Tab das Polling zu pausieren.

---

### [AppStoreApp.ts:438-441, 392] — KRITISCH — XSS
```typescript
private renderPermissions(perms: string[]): string {
  if (!perms.length) return t('appstore.noPermissions') || 'No permissions required';
  return `${t('appstore.permissions') || 'Permissions'}: ${perms.join(', ')}`;
}
// Zeile 392:
body.innerHTML = `… \u003cdiv class="appstore-card-perms"\u003e${this.renderPermissions(app.permissions)}\u003c/div\u003e …`;
```
`app.permissions` stammt aus dem **remoten** `index.json` (GitHub repo, öffentlich schreibbar). Ein Eintrag `["<img src=x onerror=alert(document.cookie)>"]` erzeugt:
```html
<div class="appstore-card-perms">Permissions: <img src=x onerror=alert(document.cookie)></div>
```
→ **Arbitrary JS Execution** im Kontext der PWA.

**Vorschlag:** `perms.map(p => escapeHtml(p)).join(', ')` oder die Permissions per `textContent` in separate `<span>`-Elemente einbauen.

---

### [AppStoreApp.ts:121-124] — HOCH — Bug (Manifest-Parsing)
```typescript
const match = f.content.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>[\s\S]*?<\/script>/i);
const manifest = JSON.parse(match[0].replace(/<[^>]+>/g, '').trim());
```
`match[0]` ist der **komplette** Match inkl. `<script…>` und `</script>`. `replace(/<[^>]+>/g, '')` entfernt alle Tag-ähnliche Sequenzen – **auch innerhalb der JSON-Strings**. Eine Description wie `"Supports <b>bold</b> text"` wird zu `"Supports  text"` → JSON korrupt oder `JSON.parse` wirft.

Der korrekte Parser in `appManifest.ts:33-43` verwendet `match[1]` (nur den Inhalt). Hier wird `match[0]` verwendet.

**Vorschlag:** `parseAppManifest()` aus `appManifest.ts` wiederverwenden statt eigenes Parsing zu duplizieren.

---

### [AppStoreApp.ts:172, 212] — MITTEL — Sicherheits-/Integritätsrisiko
```typescript
const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html?nocache=${Date.now()}`;
```
`app.path` kommt aus dem remote `index.json`. Ein Wert wie `../../malicious/index.html` oder `admin/secret.html` führt zu einem **anderen** als dem deklarierten File. Ohne Validierung kann der Index auf beliebige Pfade im Repo zeigen.

**Vorschlag:** `app.path` gegen ein Whitelist-/Format-Regex prüfen (z. B. `^[a-zA-Z][\w-]*\/[a-zA-Z][\w-]*$`), oder nur die `id` aus dem Index verwenden und den Pfad serverseitig ableiten.

---

### [AppStoreApp.ts:115-143] — MITTEL — Performance / Fehlerbehandlung
`refreshInstalled()` ruft `listFiles()` auf, das **alle** Dateien mit **vollem Inhalt** zurückgibt (`MemoryStore.listFiles(): Promise<{path, content}[]>`). Für einen Workspace mit 50 Dateien à 1 MB sind das 50 MB, die nur um ca. 5 App-Manifests zu parsen transferiert werden.

**Vorschlag:** Bridge-Methode `listFilePaths()` (bereits in `MemoryStore` vorhanden, see types/index.ts:91) nutzen und nur die passenden `apps/*/index.html` per `readFile` laden.

---

### [AppStoreApp.ts:137-138] — NIEDRIG — Bug
```typescript
installedAt: '',
updatedAt: '',
```
In `refreshInstalled()` werden die Timestamps immer auf leeren String gesetzt. Nach einem Reload/Refresh sind Installations- und Update-Zeiten verloren, obwohl sie bei `install()` (Zeile 189-190) korrekt gesetzt wurden.

**Vorschlag:** Timestamps in den App-Dateien persistieren (z. B. im Manifest oder als separater JSON-Sidecar) oder `refreshInstalled()` die bestehenden Werte aus `this.installed` übernehmen.

---

## SettingsApp.ts

### [SettingsApp.ts:242-247] — MITTEL — Potentielles DOM-Leak
```typescript
private renderMemoryTab(panel: HTMLElement) {
  panel.innerHTML = `…`;
  const memoryPanel = new MemoryPanel();
  panel.appendChild(memoryPanel.element);
  memoryPanel.open();
}
```
Bei jedem Tab-Wechsel zu „Memory" wird eine **neue** `MemoryPanel`-Instanz erzeugt. Das alte Panel-Element wird durch `panel.innerHTML = ''` (Zeile 124 in `renderTab`) entfernt. Falls `MemoryPanel` globale Listener (`document`, `window`) in `open()`/Konstruktor anlegt, bleiben diese haften → **Leak pro Tab-Wechsel**.

**Vorschlag:** `MemoryPanel` auf einmalige Wiederverwendung auslegen (Singleton oder `destroy()`-Methode) und in `renderMemoryTab` das alte Panel explizit auflösen, bevor ein neues erstellt wird.

---

### [SettingsApp.ts:316-325] — NIEDRIG — Robustheit
```typescript
container.insertBefore(resultEl, container.querySelector('#cfg-reset')?.parentElement || null);
```
Falls `#cfg-reset` nicht existiert (Tab umstrukturiert, i18n-Label geändert), wird `resultEl` ans **Ende** des Panels angehängt – potenziell außerhalb der visuellen Logik (nach der Danger-Zone statt neben dem Backup-Bereich). Funktioniert, ist aber fragil.

**Vorschlag:** Ein dediziertes `<div id="backup-message-slot">` im Markup vor­halten.

---

### [SettingsApp.ts:154-184] — NIEDRIG — Fehlerbehandlung
`renderLLMTab` ruft `loadConfig()` synchron auf. Falls `localStorage`/`IndexedDB` nicht verfügbar sind (Privacy-Mode, korrupter Speicher), wirft `loadConfig()` potenziell – ohne Catch bricht die gesamte Tab-Render­ung ab und zeigt eine leere/defekte UI.

**Vorschlag:** `try { config = loadConfig() } catch { config = DEFAULT_CONFIG; showWarning(); }`.

---

## appManifest.ts

### [appManifest.ts:66-77] — KRITISCH — XSS / Code-Injection
```typescript
const json = JSON.stringify(manifest, null, 2);
const block = `<script type="application/vnd.vag+json">\n${json}\n</script>`;
```
`JSON.stringify` escapet **nicht** `</script>`. Ein Beschleicher, der eine `description` wie `"x</script><script>steal()</script>"` setzt, erzeugt:
```html
<script type="application/vnd.vag+json">
{ "description": "x</script><script>steal()</script>" }
</script>
```
Das `<script>`-Tag wird vorzeitig geschlossen; der restliche Text ist **ausgeführtes JavaScript**.

**Vorschlag:** `json.replace(/</g, '\\u003c')` (oder `</g` → `<\/g`) vor dem Einbetten, um `</script>` zu neutralisieren.

---

### [appManifest.ts:71] — HOCH — Bug (`String.replace`-Meta­charaktere)
```typescript
return html.replace(existing[0], block);
```
`String.prototype.replace(String, String)` interpretiert `$`-Sequenzen in der Replacement-String: `$&` = Match, `$1` = Grupp­1, `` `$` `` = wörtliches `$`. Falls die Manifest-JSON einen String wie `"price: $&discount"` enthält, wird `$&` durch den **ganzen** alten Script-Block ersetzt → JSON komplett korrupt.

**Vorschlag:** Funktions-Form verwenden: `html.replace(existing[0], () => block)` – eliminiert alle `$`-Interpretationen.

---

### [appManifest.ts:32-38, 45-48] — MITTEL — Typsicherheit
```typescript
return { manifest: undefined as unknown as AppManifest, error: '…' };
```
Drei separate Stellen zurückgeben `undefined` unter dem Typ `AppManifest`. Das ver­letzt die Typ­ver­trags­garantie und zwingt **jeden** Caller, `error` vorher zu prüfen. Ein vergessener Check führt zu `TypeError: Cannot read properties of undefined` zur Lauf­zeit.

**Vorschlag:** Return-Typ auf `{ manifest: AppManifest; error?: undefined } | { manifest: undefined; error: string }` (discriminated union) ändern; Caller müssen dann per Typ­guard auf `error` prüfen.

---

### [appManifest.ts:51] — NIEDRIG — Robustheit
```typescript
const manifest = { ...DEFAULT_MANIFEST, ...parsed } as AppManifest;
```
Ein JSON-Wert `"permissions": null` überschreibt das Default `[]` → `manifest.permissions` ist `null`. Jeder Konsument, der `.length` oder `.map()` aufruft, crasht.

**Vorschlag:** Nach dem Spread defensive normalisieren: `manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];`

---

### [appManifest.ts:80-86] — NIEDRIG — Konsistenz
`defaultAppPath` und `InstalledAppStore.appPath` (app_store_db.ts:25-27) sind identische Lógica, aber an zwei Stellen dupliziert. Wenn sich die Pfad-Konvention ändert, muss an beiden Stellen gepatcht werden.

**Vorschlag:** `defaultAppPath` aus `appManifest.ts` in `app_store_db.ts` importieren.

---

## Zusammenfassung

Die kritischsten Funde sind der **nie gestoppte `setInterval` in AppStoreApp** (unendliche Netz­werk-Requests nach Fenster­schluss), die **XSS-Lücke in `renderPermissions`** (ungenutztes Escaping von remote­­gelieferten Permissions­strings in `innerHTML`) und die **`</script>`-Injection in `injectAppManifest`**, die durch ein einziges Manifest-Feld die gesamte PWA kompromittiert. Die Performance von Editor und Explorer skaliert bei großen Dateien nicht (Gutter-Neuaufbau, Prism-Voll­­­­-Re­­­­­­­nder pro Keystroke, fehlendes Debounce der Suche), und die Explorer-Dateioperationen mangeln an Fehlerbehandlung und atomarem Rollback. Priorisiert sollte zuerst die AppStoreApp-`unmount()`-Lücke und die XSS-Pfade geschlossen, danach die `</script>`-Injection im Manifest-Parser und die fehlenden Error-Paths im Explorer fixiert werden.
