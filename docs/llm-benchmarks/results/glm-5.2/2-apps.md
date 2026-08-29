[0m
> build · ollama/glm-5.2
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m→ [0mRead web/src/apps/TextEditorApp.ts
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m→ [0mRead web/src/core/appManifest.ts
# Code Review — AUFGABE 2/4: APPS

---

## KRITISCH

### SECTION [appManifest.ts:84-85] — Path Traversal über unvalidierte Manifest-ID
**Schweregrad: KRITISCH**

`defaultAppPath` konstruiert den Speicherpfad aus `manifest.category` und `manifest.id` ohne jegliche Validierung:
```ts
export function defaultAppPath(manifest: AppManifest): string {
  return `apps/${manifest.category}/${manifest.id}`;
}
```
`parseAppManifest` validiert zwar `category` gegen `ALLOWED_CATEGORIES`, aber `id` wird nur auf Existenz geprüft (`!manifest.id`), nicht auf Format. Ein bösartiges Manifest mit `"id": "../../core/memory"` würde den Pfad `apps/Productivity/../../core/memory` ergeben — also `apps/core/memory` oder tiefer. Da der `id`-Wert aus Remote-HTML (App Store) stammt, kann ein Angreifer Dateien außerhalb von `apps/` überschreiben.

**Verbesserungsvorschlag:**
```ts
const ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
if (!ID_REGEX.test(manifest.id)) {
  return { manifest: undefined as unknown as AppManifest, error: 'Invalid id format.' };
}
```
Zusätzlich `defaultAppPath` absichern:
```ts
export function defaultAppPath(manifest: AppManifest): string {
  const safeId = manifest.id.replace(/[^a-zA-Z0-9_-]/g, '');
  return `apps/${manifest.category}/${safeId}`;
}
```

---

### SECTION [AppStoreApp.ts:121-124] — BUG: Regex verwendet `match[0]` statt Capture-Group
**Schweregrad: KRITISCH**

```ts
const match = f.content.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>[\s\S]*?<\/script>/i);
if (!match) continue;
try {
  const manifest = JSON.parse(match[0].replace(/<[^>]+>/g, '').trim()) as StoreAppEntry;
```

Die Regex hat **keine Capture-Group**, daher enthält `match[0]` die gesamten `<script>...</script>`-Tags. Das nachgeschaltete `.replace(/<[^>]+>/g, '')` entfernt HTML-Tags, ist aber **fatal fragil**: Enthält das JSON in einem String-Wert `<` oder `>` (z.B. `"description": "convert a < b to a > b"`), frisst die Regex Teile des JSON-Inhalts → `JSON.parse` schlägt fehl oder produziert **falsche Daten**.

Vergleiche mit `parseAppManifest` (appManifest.ts:33), das korrekt `match[1]` mit Capture-Group `([\s\S]*?)` verwendet.

**Verbesserungsvorschlag:** Statt der fehlerhaften Inline-Regex `parseAppManifest` aus `appManifest.ts` verwenden:
```ts
import { parseAppManifest } from '../core/appManifest.js';
// ...
const { manifest, error } = parseAppManifest(f.content);
if (error || !manifest) continue;
installed.push({ ...manifest, entryContent: f.content, installedAt: '', updatedAt: '' });
```

---

### SECTION [AppStoreApp.ts:388-400,438-441] — XSS über unescapte Permissions in innerHTML
**Schweregrad: KRITISCH**

```ts
body.innerHTML = `
  ...
  \u003cdiv class="appstore-card-perms"\u003e${this.renderPermissions(app.permissions)}\u003c/div\u003e
  ...
`;
```
```ts
private renderPermissions(perms: string[]): string {
  if (!perms.length) return t('appstore.noPermissions') || 'No permissions required';
  return `${t('appstore.permissions') || 'Permissions'}: ${perms.join(', ')}`;
}
```

`renderPermissions` gibt Permission-Strings **ungeescaped** zurück, die dann via `innerHTML` gerendert werden. Die Permissions stammen aus dem Remote-Store-Index (GitHub). Alle anderen Felder (`name`, `version`, `author`, `description`) werden korrekt mit `escapeHtml()` behandelt — nur `permissions` nicht. Ein kompromittiertes Store-Repo mit `"permissions": ["<img src=x onerror=alert(document.cookie)>"]` führt zu **XSS im Haupt-Window-Kontext** mit Zugriff auf die Bridge (IndexedDB, Dateisystem).

**Verbesserungsvorschlag:**
```ts
private renderPermissions(perms: string[]): string {
  if (!perms.length) return t('appstore.noPermissions') || 'No permissions required';
  return `${t('appstore.permissions') || 'Permissions'}: ${escapeHtml(perms.join(', '))}`;
}
```

---

## HOCH

### SECTION [ExplorerApp.ts:77-80] — DOM-Leak: Document-Level Listener nie entfernt
**Schweregrad: HOCH**

```ts
document.addEventListener('click', () => this.closeContextMenu());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') this.closeContextMenu();
});
```

Diese Listener werden im Konstruktor (via `build()`) auf `document` registriert, aber **nie entfernt**. Die Klasse hat keine `destroy()`/`unmount()`-Methode. Wird `ExplorerApp` neu instanziiert (z.B. bei Workspace-Wechsel), bleiben die alten Listener aktiv — jedesmal neue. Bei `n` Instanzen feuern `n` Handler pro Document-Click. Da die Listener Closures über `this` halten, wird auch die alte Instanz am GC gehindert (Memory-Leak).

**Verbesserungsvorschlag:** Listener-Referenzen speichern und in `destroy()` entfernen:
```ts
private docClickHandler: (() => void) | null = null;
private docKeyHandler: ((e: KeyboardEvent) => void) | null = null;

// in build():
this.docClickHandler = () => this.closeContextMenu();
this.docKeyHandler = (e) => { if (e.key === 'Escape') this.closeContextMenu(); };
document.addEventListener('click', this.docClickHandler);
document.addEventListener('keydown', this.docKeyHandler);

destroy() {
  if (this.docClickHandler) document.removeEventListener('click', this.docClickHandler);
  if (this.docKeyHandler) document.removeEventListener('keydown', this.docKeyHandler);
  this.closeContextMenu();
}
```

---

### SECTION [AppStoreApp.ts:98-112] — DOM-Leak: Refresh-Interval nie gestoppt
**Schweregrad: HOCH**

```ts
mount(container: HTMLElement) {
  container.innerHTML = '';
  container.appendChild(this.element);
  this.startRefreshLoop();  // setInterval alle 30s
  this.load();
}
```

`startRefreshLoop()` startet ein `setInterval` alle 30 Sekunden. Es gibt keine `unmount()`/`destroy()`-Methode, die `stopRefreshLoop()` aufruft. Wird der App-Store-Tab geschlossen oder die App neu instanziiert, läuft das Interval weiter — `this.load()` feuert weiterhin `fetch()`-Requests an GitHub. Bei jedem neuen Mount kommt ein weiteres Interval hinzu → **akkumulierende Network-Leaks**.

**Verbesserungsvorschlag:**
```ts
unmount() {
  this.stopRefreshLoop();
}

destroy() {
  this.stopRefreshLoop();
}
```
Außerdem sicherstellen, dass der Window-Manager `destroy()` bzw. `unmount()` aufruft.

---

### SECTION [appManifest.ts:32-63] — Rückgabetyp verbirgt `undefined`-Manifest
**Schweregrad: HOCH**

```ts
export function parseAppManifest(html: string): { manifest: AppManifest; error?: string } {
  ...
  return {
    manifest: undefined as unknown as AppManifest,
    error: 'No <script type="application/vnd.vag+json"> manifest block found.',
  };
}
```

Der deklarierte Typ sagt `manifest: AppManifest` (non-optional), aber im Fehlerfall ist `manifest` tatsächlich `undefined`. Der Cast `as unknown as AppManifest` unterdrückt TypeScript. Aufrufer, die nur `result.manifest` ohne `error`-Check verwenden (was der Typ suggeriert: `error` ist optional), kriegen zur Laufzeit `undefined` und crashen mit `Cannot read property 'id' of undefined`.

**Verbesserungsvorschlag:**
```ts
export function parseAppManifest(html: string): { manifest: AppManifest | null; error?: string } {
```
oder als Discriminated Union:
```ts
export type ParseResult =
  | { manifest: AppManifest; error?: undefined }
  | { manifest: null; error: string };
```

---

### SECTION [TextEditorApp.ts:502-514] — Fehler beim Laden wird stillschweigend ignoriert
**Schweregrad: HOCH**

```ts
private async load() {
  if (!this.currentPath) return;
  const res = await this.onBridgeRequest?.({ type: 'readFile', path: this.currentPath });
  this.textarea.value = (res?.ok ? String(res.data ?? '') : '') || '';
  this.savedContent = this.textarea.value;
  ...
  this.setDirty(false);
  this.setStatus(t('editor.loaded') || 'Loaded');
}
```

Wenn `res?.ok` `false` ist (Datei nicht gefunden, Bridge-Fehler) oder `this.onBridgeRequest` `null` ist, wird der Inhalt stillschweigend auf `''` gesetzt und der Status zeigt **"Loaded"** — als ob die Datei erfolgreich geladen wurde. Der User sieht eine leere Datei, tippt, speichert, und überschreibt damit eine eigentlich existierende Datei mit Leerstring. Kein Try-Catch um den Bridge-Aufruf: eine Exception würde unbehandelt durchreichen.

**Verbesserungsvorschlag:**
```ts
private async load() {
  if (!this.currentPath) return;
  try {
    const res = await this.onBridgeRequest?.({ type: 'readFile', path: this.currentPath });
    if (!res?.ok) {
      this.setStatus(t('editor.loadError') || 'Failed to load file', true);
      return;
    }
    this.textarea.value = String(res.data ?? '') || '';
    this.savedContent = this.textarea.value;
    this.undoStack = [this.textarea.value];
    this.redoStack = [];
    this.lastInputTime = 0;
    this.updateGutter();
    this.highlightCode();
    this.setDirty(false);
    this.setStatus(t('editor.loaded') || 'Loaded');
  } catch (err) {
    console.warn('Editor load failed', err);
    this.setStatus(t('editor.loadError') || 'Failed to load file', true);
  }
}
```

---

### SECTION [AppStoreApp.ts:82-84,172-175] — Supply-Chain: Keine Integritätsprüfung remote-gefetchter Apps
**Schweregrad: HOCH**

```ts
const res = await fetch(
  `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/index.json?nocache=${cacheBuster}`,
  { cache: 'no-store' }
);
```
```ts
const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html?nocache=${Date.now()}`;
const res = await fetch(entryUrl, { cache: 'no-store' });
const entryContent = await res.text();
```

Store-Index und App-HTML werden von GitHub `raw.githubusercontent.com` geladen — ohne SRI-Hash, ohne Signaturprüfung, ohne Pinning eines bestimmten Commits (`main`-Branch). Wird das Repo kompromittiert (z.B. kompromittierter GitHub-Token, bösartiger PR), liefert der Angreifer HTML, das nach `installApp` gespeichert und bei `launchApp` ausgeführt wird — mit vollem Zugriff auf die Bridge (Dateisystem, IndexedDB). Die `cache: 'no-store'` + Cache-Buster garantieren, dass immer die neueste (potenziell bösartige) Version geladen wird.

**Verbesserungsvorschlag:** Mindestens Subresource Integrity für die App-HTML einführen:
- Store-Index enthält `integrity: "sha256-..."` pro App
- Beim Installieren: `entryContent` hashen und vor dem Speichern vergleichen
- Ideal: Apps auf einen getaggten Commit pinning (`/refs/tags/v1.2.3/` statt `/main/`)
- Langfristig: Signatur mit Public-Key-Verifikation

---

## MITTEL

### SECTION [TextEditorApp.ts:549-551] — BUG: Gutter-Scroll desynchronisiert bei Zeilenumbruch
**Schweregrad: MITTEL**

```ts
private syncGutter() {
  this.gutterEl.scrollTop = this.textarea.scrollTop;
}
```

Der Gutter hat pro logischer Zeile genau ein `<div>`, aber das Textarea bricht lange Zeilen um (soft wrap). Eine logische Zeile kann im Textarea 3 visuelle Zeilen einnehmen, im Gutter aber nur 1. `scrollTop` Werte divergieren → Gutter-Zeilennummern passen nicht mehr zum sichtbaren Code. Das gleiche Problem betrifft `scrollToPosition` (Zeile 338-347), das `lineHeight` für Scrollschätzung nutzt — bei umgebrochenen Zeilen ist die visuelle Zeilenhöhe variabel.

**Verbesserungsvorschlag:** Entweder `white-space: pre` (kein Wrap) im Textarea erzwingen, oder den Gutter virtualisieren und die Zeilennummer an der tatsächlichen Cursor-Position ausrichten (via `selectionStart` → Zeile berechnen, nicht via scrollTop).

---

### SECTION [TextEditorApp.ts:152-162] — Performance: Undo-Stack speichert volle Dokumentkopien
**Schweregrad: MITTEL**

```ts
this.undoStack.push(this.textarea.value);
if (this.undoStack.length > 50) this.undoStack.shift();
```

Jeder Undo-Eintrag ist eine komplette Kopie des Dokuments. Bei einer 2MB-Datei und 50 Einträgen = **100MB reine Undo-Daten** im Heap. `shift()` auf einem Array ist zudem O(n) — alle 50 Einträge werden bei jedem Debounce-Overflow verschoben.

**Verbesserungsvorschlag:** Diff-basiertes Undo (z.B. `diff-match-patch` oder einfache Insert/Delete-Operationen speichern), oder Stack-Größe adaptiv reduzieren bei großen Dateien:
```ts
const MAX_UNDO = this.textarea.value.length > 100_000 ? 10 : 50;
if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
```

---

### SECTION [TextEditorApp.ts:542-547] — Performance: Gutter erzeugt DOM-Knoten pro Zeile
**Schweregrad: MITTEL**

```ts
this.gutterEl.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
```

Bei 10.000+ Zeilen werden 10.000 `<div>`-Elemente erzeugt und via `innerHTML` geparst. Die `lastGutterLines`-Optimierung verhindert wiederholten Aufbau bei gleichbleibender Zeilenzahl, aber der initiale Build bleibt teuer (Layout-Thrashing, Parse-Zeit).

**Verbesserungsvorschlag:** Virtualisierten Gutter verwenden: nur sichtbare Zeilen rendern (basierend auf `scrollTop` und `clientHeight`), bei Scroll nachführen.

---

### SECTION [ExplorerApp.ts:71-74] — Performance: Kein Debounce auf Search-Input
**Schweregrad: MITTEL**

```ts
searchInput.addEventListener('input', () => {
  this.searchQuery = searchInput.value.trim().toLowerCase();
  this.render();
});
```

Jeder Tastenanschlag im Suchfeld löst `render()` aus, was `buildTree()` (Sortierung O(n log n)) + `collectSearchResults()` (Tree-Walk O(n)) + DOM-Rebuild auslöst. Bei 1.000+ Dateien und schnellem Tippen sperrt das den Main-Thread.

**Verbesserungsvorschlag:**
```ts
let searchTimer: ReturnType<typeof setTimeout> | null = null;
searchInput.addEventListener('input', () => {
  this.searchQuery = searchInput.value.trim().toLowerCase();
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => this.render(), 150);
});
```

---

### SECTION [ExplorerApp.ts:627,646,656,673-674,689,707,713,716,743,764,797] — Fehlerbehandlung: Bridge-Antworten ungeprüft
**Schweregrad: MITTEL**

Durchgehend werden Bridge-Responses nicht auf `ok` geprüft, z.B.:
```ts
// createFolder (Zeile 627)
await this.onBridgeRequest?.({ type: 'writeFile', path, content: '' });
await this.refresh();
this.expandedFolders.add(folderPath);
this.render();
```
Schlägt der Write fehl (Quota, Lock, Bridge-Error), wird die UI trotzdem aktualisiert — der Ordner erscheint, existiert aber nicht. Bei `renameFile` (Zeile 673-674) wird zuerst geschrieben, dann gelöscht — schlägt der Write fehl, der Delete aber erfolgreich (unwahrscheinlich aber möglich bei Race-Conditions), ist die Datei weg.

**Verbesserungsvorschlag:** Jede Bridge-Response prüfen:
```ts
const res = await this.onBridgeRequest?.({ type: 'writeFile', path, content: '' });
if (!res?.ok) {
  window.alert(t('explorer.writeError') || 'Failed to write file');
  return;
}
```
Bei Rename: erst Write prüfen, dann erst Delete ausführen — bei Write-Fehler Delete überspringen.

---

### SECTION [SettingsApp.ts:242-247] — Memory-Leak: MemoryPanel wird bei Tab-Wechsel nicht zerstört
**Schweregrad: MITTEL**

```ts
private renderMemoryTab(panel: HTMLElement) {
  panel.innerHTML = `<h3 class="settings-panel-title">🧠 ${t('header.memory')}</h3>`;
  const memoryPanel = new MemoryPanel();
  panel.appendChild(memoryPanel.element);
  memoryPanel.open();
}
```

Bei jedem Wechsel auf den Memory-Tab wird ein neues `MemoryPanel` instanziiert. Das alte Panel wird via `panel.innerHTML = ''` (in `renderTab`) aus dem DOM entfernt, aber `MemoryPanel` hat vermutlich eigene Listener/Timer (z.B. für Auto-Refresh von Memory-Daten), die nie abgeräumt werden — es sei denn, es hat eine `destroy()`-Methode, die hier **nicht aufgerufen** wird.

**Verbesserungsvorschlag:** Vorhandenes Panel referenzieren und zerstören:
```ts
private memoryPanel: MemoryPanel | null = null;

private renderMemoryTab(panel: HTMLElement) {
  this.memoryPanel?.destroy();  // oder .close()
  panel.innerHTML = `<h3 class="settings-panel-title">🧠 ${t('header.memory')}</h3>`;
  this.memoryPanel = new MemoryPanel();
  panel.appendChild(this.memoryPanel.element);
  this.memoryPanel.open();
}
```

---

### SECTION [appManifest.ts:33] — Edge-Case: Regex bricht bei `</script>` im JSON
**Schweregrad: MITTEL**

```ts
const match = html.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>([\s\S]*?)<\/script>/i);
```

`[\s\S]*?` ist non-greedy und stoppt beim **ersten** `</script>`. Enthält das JSON den String `</script>` in einem Feld (z.B. `"description": "Use </script> to close"`), schneidet die Regex zu früh ab → `JSON.parse` schlägt fehl mit kryptischer Fehlermeldung.

**Verbesserungsvorschlag:** Den Script-Block via DOM-Parser extrahieren statt Regex:
```ts
const doc = new DOMParser().parseFromString(html, 'text/html');
const scriptEl = doc.querySelector('script[type="application/vnd.vag+json"]');
if (!scriptEl) return { manifest: null, error: 'No manifest block found.' };
const json = scriptEl.textContent ?? '';
```

---

### SECTION [appManifest.ts:66-78] — `injectAppManifest` escapt `</script>` nicht
**Schweregrad: MITTEL**

```ts
export function injectAppManifest(html: string, manifest: AppManifest): string {
  const json = JSON.stringify(manifest, null, 2);
  const block = `<script type="application/vnd.vag+json">\n${json}\n</script>`;
```

`JSON.stringify` escapt `<` und `>` nicht. Enthält ein Manifest-Feld `</script>`, bricht das eingefügte `<script>`-Tag vorzeitig → HTML-Injection / kaputtes Dokument. Dies ist die Injektions-Seite des obigen Parse-Problems.

**Verbesserungsvorschlag:**
```ts
const json = JSON.stringify(manifest, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
```

---

## NIEDRIG

### SECTION [ExplorerApp.ts:241] — Performance: buildTree sortiert bei jedem Render neu
**Schweregrad: NIEDRIG**

```ts
const sorted = [...this.files].sort((a, b) => a.path.localeCompare(b.path));
```

`buildTree()` wird bei jedem `render()` aufgerufen (Suche, Toggle, Selektion). Die Sortierung ist O(n log n), der Baum-Bau O(n). Bei großen Workspaces könnte der Baum gecacht und nur bei `files`-Änderung neu gebaut werden.

**Verbesserungsvorschlag:** `buildTree()`-Ergebnis cachen und nur in `refresh()` invalidieren:
```ts
private treeCache: TreeNode[] | null = null;
private buildTree(): TreeNode[] {
  if (this.treeCache) return this.treeCache;
  // ... build ...
  this.treeCache = result;
  return result;
}
// in refresh(): this.treeCache = null;
```

---

### SECTION [TextEditorApp.ts:252-267] — UX-Bug: replaceOne tut stillschweigend nichts
**Schweregrad: NIEDRIG**

```ts
replaceOneBtn.addEventListener('click', () => {
  ...
  if (this.textarea.value.slice(start, end) === query) {
    this.textarea.setRangeText(replacement, start, end, 'end');
    ...
  }
  findAll();
  selectMatch(currentIndex + 1);
});
```

Die Ersetzung erfolgt nur, wenn die aktuelle Selektion exakt dem Suchbegriff entspricht. Hat der User nicht zu einem Match navigiert (z.B. direkt nach Öffnen des Overlays), passiert **nichts** — keine Rückmeldung, keine Auto-Selektion des nächsten Match. Der Klick erscheint "tot".

**Verbesserungsvorschlag:** Bei Klick automatisch zum aktuellen Match navigieren und dieses ersetzen:
```ts
replaceOneBtn.addEventListener('click', () => {
  const query = findInput.value;
  const replacement = replaceInput.value;
  if (!query || !matches.length) return;
  const pos = matches[currentIndex];
  this.textarea.setRangeText(replacement, pos, pos + query.length, 'end');
  this.recordInput(true);
  this.refreshDirty();
  this.updateGutter();
  this.highlightCode();
  findAll();
  selectMatch(currentIndex);
});
```

---

### SECTION [SettingsApp.ts:172-183] — Keine Validierung der LLM-Konfiguration beim Speichern
**Schweregrad: NIEDRIG**

```ts
this.addSaveAction(panel, () => {
  saveConfig({
    ...config,
    baseUrl: llm.baseUrl,
    model: llm.model,
    apiKey: llm.apiKey,
    ...
  });
  this.emitReload();
});
```

`baseUrl` und `model` werden ungeprüft gespeichert. Leere oder ungültige Werte führen erst später zu kryptischen Fehlern beim ersten LLM-Call. `apiKey` könnte Whitespace enthalten.

**Verbesserungsvorschlag:**
```ts
const baseUrl = llm.baseUrl.trim();
const model = llm.model.trim();
if (!baseUrl || !model) {
  this.showBackupMessage(panel, t('settings.validationError') || 'URL and model are required', 'error');
  return;
}
saveConfig({ ...config, baseUrl, model, apiKey: llm.apiKey.trim(), ... });
```

---

### SECTION [AppStoreApp.ts:255-305] — Performance: render() baut gesamten DOM neu auf
**Schweregrad: NIEDRIG**

```ts
private render() {
  this.element.innerHTML = '';
  // ... header, tabs, content komplett neu aufbauen ...
}
```

Jede Statusänderung (Loading, Error, Install, Tab-Wechsel, Filter-Wechsel) löst einen kompletten DOM-Rebuild aus. Bei 50+ Store-Apps werden 50+ Karten-DOM-Bäume bei jedem Render neu erzeugt und verworfen. Der Garbage-Collector wird频繁 aktiviert.

**Verbesserungsvorschlag:** Nur den Content-Bereich neu rendern, Header/Tabs beim ersten Render belassen:
```ts
private render() {
  if (!this.element.querySelector('.appstore-header')) {
    this.renderShell();
  }
  this.renderContent();
}
```

---

## 3-Satz-Zusammenfassung

Die kritischsten Funde betreffen **Sicherheit und Datenintegrität**: Ein Path-Traversal über unvalidierte Manifest-IDs ermöglicht das Überschreiben beliebiger Workspace-Dateien, ein Regex-Bug in `AppStoreApp.refreshInstalled` führt zu fehlerhafter Manifest-Parsing bei legitimen JSON-Inhalten, und unescapte Permissions in `innerHTML` öffnen eine XSS-Lücke über den Remote-App-Store. Die **DOM-Leak-Problematik** ist struktureller Natur — `ExplorerApp` registriert Document-Listener ohne Cleanup, `AppStoreApp` startet ein 30-Sekunden-Interval ohne Stopp-Mechanismus, und `SettingsApp` instanziiert `MemoryPanel` ohne Zerstörung beim Tab-Wechsel; keine der drei Apps implementiert `destroy()` oder `unmount()`. Bei **Performance und Fehlerbehandlung** dominieren fehlende Debouncing/Caching in `ExplorerApp`, Vollkopien im Undo-Stack des Editors, stillschweigendes Ignorieren von Bridge-Fehlern (insbesondere `load()` zeigt "Loaded" bei Fehler), und das Fehlen jeglicher Integritätsprüfung für remote-gefetchte App-HTMLs.
