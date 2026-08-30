[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m→ [0mRead web/src/apps/TextEditorApp.ts
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m→ [0mRead web/src/core/appManifest.ts
Alle Dateien gelesen. Noch kurz das Escape-Utility verifizieren, da XSS-Bewertung davon abhängt:
[0m→ [0mRead web/src/utils/escape.ts
[0m✱ [0mGrep "unmount\(\)|closeFindReplace|removeEventListener"[90m in web/src · 18 matches[0m
[0m✱ [0mGrep "interface App"[90m in web/src/types · 2 matches[0m
[0m→ [0mRead web/src/types/index.ts[90m [offset=160, limit=25][0m
[0m✱ [0mGrep "unmount|\.onClose\("[90m in web/src · 4 matches[0m
Noch zwei kurze Verifikationen für die Leak-Einschätzung:
Noch ein Blick auf `MemoryPanel` (wird pro Tab-Wechsel neu instanziiert):
[0m
[0m$ [0mgrep -n "addEventListener\|setInterval\|setTimeout\|open\|close\|unmount\|remove" web/src/components/MemoryPanel.ts | head -40
19:  open() {
63:        btn.addEventListener('click', async (e) => {
[0m
[0m✱ [0mGrep "injectAppManifest|parseAppManifest"[90m in . · 8 matches[0m
Zwei kurze Nachprüfungen für die Severity-Einschätzung (Server-Sanitizing + Manifest-Injection-Nutzung):
[0m✱ [0mGrep "cleanPath|sanitize|\.\."[90m in internal · 0 matches[0m
[0m→ [0mRead web/src/core/app_store_db.ts[90m [offset=30, limit=85][0m
[0m→ [0mRead web/src/components/MemoryPanel.ts[90m [offset=1, limit=40][0m
[0m→ [0mRead web/src/components/MemoryPanel.ts[90m [offset=40, limit=33][0m
# Code-Review — Apps & appManifest

## web/src/apps/ExplorerApp.ts

**[ExplorerApp.ts:224–248] — MITTEL**
`collectSearchResults()` läuft bei jeder Taste der suchenden Eingabe über den kompletten Baum (`toLowerCase().includes()` zweimal pro Knoten, plus `buildTree()` neu sortiert O(n log n), plus `renderNode()` pro Knoten). Bei hundert bis tausenden Dateien entsteht per Tastendruck eine vollständige DOM-Umbau mit je eigenen Event-Listenern pro Knoten.
→ Suche debounce-n (200–300 ms), `searchQuery` bereits klein geschrieben vor dem Walk vergleichen, und DOM-Erkzeug nur für sichtbar geänderte Zweige (oder Diff-basierter Re-render).

**[ExplorerApp.ts:84–85] — MITTEL**
`document.addEventListener('click', this.onDocClick)` / `keydown` werden in `build()` gesetzt und erst in `unmount()` (Zeile 88–101) entfernt. Wenn `unmount` nicht aufgerufen wird (z. B. Fenster-Neu-Mount ohne Close, WM-Pfad ohne `unmount`), bleiben globale Listener + Closures (`this`) auf der DOM-Struktur hängen.
→ Listener stattdessen delegiert über `this.element` binden oder `unmount` in `mount`-Aufruf-Kette garantieren; zusätzlich WeakRef-Prüfung im Listener: `if (!this.listEl.isConnected) return`.

**[ExplorerApp.ts:224 + 234] — NIEDRIG**
`buildTree()` markiert `part === '.keep'` als `isFolder` (Zeile 310), was bei einem *Datei*-Knoten mit dem Namen `.keep` (nicht als Ordner) ein falsches `isFolder = true` erzeugt.
→ `isFolder` ausschließlich über `i < parts.length - 1` bestimmen; `.keep`-Datei als normalen Datei-Knoten behandeln.

**[ExplorerApp.ts:723–739, 758–788] — MITTEL**
`renameFile`/`renameFolder` erlauben `newName` aus `window.prompt` nur mit `trim()` + leading-`/`-Streifen. `..`, absoluter Pfad oder control-chars werden nicht geprüft; `assertSafePath()` (Zeile 121) wird hier bewusst nicht aufgerufen.
→ Gleiche Validierung wie `assertSafePath` (verboten: `\`, `..`, control chars, absolute Pfade) auf `cleanName` anwenden.

## web/src/apps/TextEditorApp.ts

**[TextEditorApp.ts:542–547] — MITTEL**
`updateGutter()` erzeugt `Array.from({length: lines}, …)` → innerHTML-String mit `lines` Divs (Zeile 546). Für große Dateien (z. B. 10 000+ Zeilen) pro Eingabevent; `lastGutterLines`-Guard (Zeile 544) greift nur, wenn die Zeichenzahl pro Zeile gleich bleibt, nicht aber wenn Zeilen eingefügt/gelösht werden.
→ Gitter virtualisieren (nur sichtbarer Bereich rendern) oder Zeilennummern in einzelne `<canvas>`/`<canvas>`-Spalte zeichnen; `innerHTML` bei großen Werten vermeiden.

**[TextEditorApp.ts:74–75, 111–118] — NIEDRIG**
Kein `unmount()`; die `input`/`keydown`/`scroll`-Listener (Zeile 74–75) werden nie entfernt. Wenn die App-Instanz entfernt wird, halten Closures die Textarea-DOM und Prism-Referenzen weiter.
→ `unmount()` implementieren, der die drei Listener von `this.textarea` entfernt und `this.findReplaceOverlay?.remove()` aufruft.

**[TextEditorApp.ts:127–138, 111, 131] — MITTEL**
`highlightCode()` (Zeile 129, 131) ruft `Prism.highlight` + `innerHTML` auf **jedes** `input`-Event, ohne Debounce und ohne Diffing. Bei großen Dateien (> ~50 KB) und aktiviertem Language-Modus blockiert das die Main-Thread spürbar.
→ `requestAnimationFrame`- oder `setTimeout(0)`-Debounce für `highlightCode`; optional: bei `textarea.value.length > 100_000` das Highlighten skippen und Status anzeigen.

**[TextEditorApp.ts:489–514 load()/openFile()] — NIEDRIG**
`load()` ist `async`; während die Bridge-Antwort aussteht, kann der Benutzer in die Textarea tippen. Wenn die Antwort eintrifft, wird `textarea.value` mit Server-Inhalt **ohne Dirty-Check** overwritten (Zeile 505).
→ In `load()` vor dem Overwrite prüfen `if (this.dirty || this.textarea.value !== this.savedContent) { this.savedContent = this.textarea.value; }` oder `load()` nur aufrufen, wenn `textarea.value === this.savedContent`.

## web/src/apps/AppStoreApp.ts

**[AppStoreApp.ts:82–84, 121–124] — MITTEL**
`load()` (Zeile 82–84) und `refreshInstalled()` (Zeile 124) parsen den Manifest-Block aus remote HTML mit Regex + `JSON.parse`; das Ergebnis (`StoreAppEntry.permissions`, `icon`, `description`) wird in `renderAppCard` (Zeile 388–400) per `${escapeHtml(...)}` in `innerHTML` eingefügt. `escapeHtml` (Zeile 6–12 in escape.ts) ersetzt `&`, `<`, `>`, `"`, `'` – das ist **korrekt** und verhindert XSS hier. **Aber**: `body.innerHTML` an Zeile 400 enthält `${this.renderPermissions(app.permissions)}` (Zeile 438) — die Methode `renderPermissions` (Zeile 439–441) gibt `perms.join(', ')` **ohne** `escapeHtml` zurück. Falls ein `permission`-String enthält `</div><script>…`, wird er als HTML interpretiert.
→ `renderPermissions` zurückgabe: `perms.map(escapeHtml).join(', ')`.

**[AppStoreApp.ts:438–441 renderPermissions] — HOCH**
Siehe oben: `perms.join(', ')` ohne Escape in `innerHTML`. `app.permissions` kommt aus `StoreAppEntry` (remote JSON, Zeile 87 `res.json()`). Ein böswilliger Index-Eintrag mit `"permissions": ["</div><img src=x onerror=alert(1)>"]` führt direkt zu XSS.
→ `perms.map(escapeHtml).join(', ')` in `renderPermissions`.

**[AppStoreApp.ts:64–68, 98–112] — NIEDRIG**
`mount()` ruft `startRefreshLoop()` auf, der ein `setInterval` (Zeile 100) setzt. Es gibt keine `unmount()`-Methode. Wenn die App vom WM entfernt wird, läuft das `setInterval` weiter und ruft `load()` (Zeile 102) alle 30 s auf, die `fetch()` + `render()` auf einem detached `this.element` ausführt.
→ `unmount()` hinzufügen, das `stopRefreshLoop()` aufruft.

**[AppStoreApp.ts:391, 121] — NIEDRIG**
`body.innerHTML` in `renderAppCard` (Zeile 388) enthält `${this.renderPermissions(app.permissions)}` (Zeile 392). Siehe `renderPermissions`-Fix oben. Zusätzlich: `match[0].replace(/<[^>]+>/g, '')` in `refreshInstalled` (Zeile 124) ist ein fragiler JSON-Extraktor — ein `<` oder `>` in einem JSON-String-Wert (z. B. `description: "<b>bold</b>"`) wird von der Regex `<[^>]+>` als HTML-Tag entfernt und kappt den JSON-String.
→ `parseAppManifest` aus `appManifest.ts` (Zeile 32–49) hier wiederverwenden, statt die eigene Regex-Logik.

## web/src/apps/SettingsApp.ts

**[SettingsApp.ts:148–149, 242–247] — NIEDRIG**
`renderWorkspaceTab` (Zeile 149) und `renderMemoryTab` (Zeile 244) instanrieren neue `MemoryPanel` und rufen `open()` → `getAllMemory()` (async Bridge) auf. Wenn der Tab schnell gewechselt wird (Zeile 111–118 `switchTab` → `renderTab` → `panel.innerHTML=''`), kann eine ausstehende `getAllMemory()`-Antwort noch auf einem entfernten `panel` schreiben.
→ In `loadMemory()` (MemoryPanel.ts) vor dem innerHTML-Setzen prüfen `if (!this.element.isConnected) return;`.

**[SettingsApp.ts:155–183] — NIEDRIG**
`renderLLMTab` liest `loadConfig()` (Zeile 155), rendert drei Formularelemente, und `addSaveAction` (Zeile 172) liest **alle** Felder neu aus dem DOM (Zeile 227–233) und macht `saveConfig({...config, …})`. Wenn sich `config` zwischen `loadConfig` und Save ändert (z. B. durch eine andere App, die `saveConfig` ruft), werden die alten Werte mit den neuen DOM-Werten gemixt gespeichert.
→ `saveConfig` mit vollständiger Konfiguration aus `loadConfig()` + nur den explizit geänderten Feldern; oder `loadConfig()` direkt vor `saveConfig` erneut aufrufen.

## web/src/core/appManifest.ts

**[appManifest.ts:32–51, 84–86] — HOCH**
`parseAppManifest` (Zeile 40–49) akzeptiert ein beliebiges `parsed.id`. `defaultAppPath` (Zeile 84–86) nutzt `manifest.id` direkt in einem Dateisystem-Pfad `apps/${category}/${id}`. Wenn `id = "../../etc/passwd"` oder enthält `/`/`..`, ist das eine **Path-Traversal**-Injection. `ALLOWED_CATEGORIES` (Zeile 56) validiert nur `category`, nicht `id`.
→ In `parseAppManifest` nach Zeile 53 hinzufügen: `if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) return { manifest: undefined, error: 'Invalid id format.' };`

**[appManifest.ts:45, 51] — NIEDRIG**
`parsed.icon`, `parsed.description`, `parsed.author` sind vom Typ `string` im Interface (Zeile 13–16), aber `Partial<AppManifest>` (Zeile 41) lässt `parsed` ohne Typ-Validierung zu. Wenn die API/JSON `icon: 123` liefert, ist `manifest.icon` ein `number`, und `icon.textContent = app.icon || '📦'` in `AppStoreApp.ts:384` rendert es als Text "123" – kein Crash, aber inkonsistent.
→ In `parseAppManifest` (nach Zeile 51) typen: `if (typeof manifest.icon !== 'string') manifest.icon = '📦';` analog für andere String-Felder.

---

**Zusammenfassung:** Die kritischsten Funde sind die **XSS-Lücke in `renderPermissions`** (AppStoreApp.ts:438–441, `perms.join` ohne Escape in `innerHTML`) und die **Path-Traversal in `defaultAppPath`** (appManifest.ts:84), weil `manifest.id` nicht gegen `..`/`/` validiert wird. In ExplorerApp und TextEditorApp gibt es **leere `unmount()`-Implementierungen** bzw. die fehlen ganz, was zu DOM-Leaks und ausstehenden Async-Callbacks führt. Performance-Weitenlagen (Gutter-`innerHTML`, `Prism.highlight` ohne Debounce, `buildTree` bei Such-Input-Events) skalieren nicht für große Dateien/Liste.
