[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m→ [0mRead web/src/apps/TextEditorApp.ts
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m→ [0mRead web/src/core/appManifest.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m✱ [0mGrep "addEventListener\(['"](window|document|blur|pagehide|visibilitychange|beforeunload)"[90m in web/src · 3 matches[0m
[0m✱ [0mGrep "interface App|unmount|destroy"[90m in web/src/types · 2 matches[0m
[0m→ [0mRead web/src/types/index.ts[90m [offset=160, limit=40][0m
Alle 5 Dateien vollständig gelesen (zusätzlich `utils/escape.ts` und die `App`-Interface-Definition für Kontext). Folgend das vollständige Review.

# Code-Review — Task 2/4: Apps

---

## 1. ExplorerApp.ts

### [ExplorerApp.ts:77-80] — SCHWEREGRAD: HOCH
**Globaler document-Listener ohne Entsorgung (DOM/Listener-Leak)**
`build()` (via Konstruktor, also *vor* der ersten `mount()`-Aufrufe) registriert `document.addEventListener('click', ...)` und `document.addEventListener('keydown', ...)`. Diese Referenzen bleiben für die gesamte App-Sitzung an `document` hängen. Da die `App`-Schnittstelle (types/index.ts:164) kein `onDestroy`/`unmount` definiert, können die Apps die Listener nie entfernen — jeder neu konstruierte `ExplorerApp` (z. B. beim Eröffnen eines zweiten Windows) hängt 2 weitere pausibel-leakende Listener an `document`, und bei jedem globalen Klick feuert ein `closeContextMenu`-Noop in einem bereits verworfenen App-Instanz.
**Vorschlag:** Listener einmalig global registrieren (modul-scope WeakMap oder Event-Delegation auf `this.element`), oder dem `App`-Interface ein freiwilliges `destroy?(): void` hinzufügen und es im WindowManager bei Fensterschließung aufrufen.

### [ExplorerApp.ts:129-131, 148, 366-372] — SCHWEREGRAD: MITTEL
**Komplette Neu-Rendering-Strategie erzeugt bei jedem Render O(n) anonyme Listener**
`render()` setzt `listEl.innerHTML = ''` und baut per `renderNode` den gesamten Baum neu — inkl. `el.innerHTML` für jeden Knoten und `el.addEventListener('click'|'contextmenu'|'dragstart'|'dragend'|...)` für jeden Eintrag. Bei einem Workspace mit tausenden Dateien (oder großen, tief verschachtelten Ordnern mit `expanded = true`) kostet das jeden Klick auf einen Knoten, jede Sucheingabe (`input`-Listener → `render()` ohne Debounce, Zeile 71-74!) und jedes `refresh()` einen vollen DOM-Aufbau plus GC-Druck. Suche bei jeder Tasteingabe neu den kompletten Baum (`collectSearchResults` ist O(n) rekursiv).
**Vorschlag:** Event-Delegation (ein `click`/`contextmenu`-Listener auf `listEl` mit `e.target.closest('[data-path]')`), Virtualisierungen-freundliche Aufteilung, und `debounce`/`requestAnimationFrame` für den Suchlistener. Listener-Anzahl wird so unabhängig von der Dateianzahl.

### [ExplorerApp.ts:773-779] — SCHWEREGRAD: MITTEL
**`downloadFile` erzeugt Blob-URLs, die durch `revokeObjectURL` sofort vor dem Browser-Click-Begleitholen entzogen sein können + kein Fehlerhandling**
`await this.onBridgeRequest...` liefert `res.data` als `String` (Zeile 771-773). Falls `data` ein Objekt oder `null` ist, wird durch `String(...)` `[object Object]` bzw. `"null"` heruntergeladen — still. `URL.createObjectURL` + `a.click()` + sofortiges `URL.revokeObjectURL` ist in Firefox/Race-Situationen fragil; besser `setTimeout(revoke, 0)` oder `a.remove()`-zuerst. Auch: kein Handling für `!file.content`-große Dateien — der komplette Content wird in JS-Speicher gehalten, um ihn per `new Blob([file.content]).size` (Zeile 210) die Länge zu ermitteln — das ist O(n) auf *jeden* Detail-Render, wenn eine große Datei aktiv ist (siehe Fund unten).
**Vorschlag:** `res.data` typ- und null-prüfen vor dem `String()`-Cast; `revokeObjectURL` asynchron (Mikro- oder Timeout) ausführen; Dateigröße von der Bridge mitliefern oder `file.content.length` (Char-Zahl) mit Hinweis statt Blob-konkretisierungen nutzen.

### [ExplorerApp.ts:206-228 (renderDetails)] — SCHWEREGRAD: MITTEL
**Detail-Leiste liest `content` für *Jede* Datei bei jedem Render (O(n·size)) und erzeugt Blob-Objekte**
`renderDetails` findet die aktivierte Datei, erzeugt aber — selbst wenn die Details später nicht sichtbar sind — bei *jeder* `render()`-Aufrufe `new Blob([file.content]).size` und `file.content.split('\n').length`. Das dupliziert den Stringinhalt (Blob kopiert intern) und ist bei `10 MB`-Datei + hoher Render-Frequenz (Suche, Ordner-Expand, Breadcrumb-Klick) spürbar teuer. Zusätzlich: `files.find(...)` + `files.some(...)` (Zeile 207) sind beide O(n) pro Render — mit `activePath`-Cache / gezieltem Map-Lookup vermeidbar.
**Vorschlag:** Größenzeile aus `file.content.length` (oder besser von der Bridge vorgegebenem Bytes-Feld) ableiten statt Blob; Dateistruktur einmalig als Map path→FileEntry pflegen, um die O(n)-Scans in O(1) zu bringen.

### [ExplorerApp.ts:712-717 (renameFolder), 762-765 (duplicateFolder), 398-412 (moveFileIntoFolder)] — SCHWEREGRAD: HOCH
**Rename/Duplicate von Ordnern kopiert alle Dateien sequenziell über die Bridge — atomarität fehlt**
`for (const file of affected) { await write(new); }` gefolgt von `for (const file of affected) { await delete(old); }`. Ein Abbruch (Bridge-Timeout, Tab-unsichtbar, Fehler) zwischt den beiden Schleifen hinterlässt *kopierte und ursprüngliche* Dateien gleicher Inhalte (Datenverlust durch „Rename“ = doppelte Daten + orphane `.keep`). Dasselbe gilt für `duplicateFolder`. `moveFileIntoFolder` hat dasselbe Muster.
**Vorschlag:** Atomic-Bridge-Operation `moveFile`/`renamePath` auf der Bridge-Seite einführen (eine Storage-Transaktion), oder minimal: alle Writes sammeln, `Promise.all` mit Fehler-Propagation ausführen, und nur wenn alle Writes OK sind, die Deletes ausführen — plus `try/finally` zur Reaktivierung des UI-Zustands.

### [ExplorerApp.ts:279-311 (renderNode, Ordner), 375-396 (attachFolderDragDrop)] — SCHWEREGRAD: MITTEL
**Drag-and-Drop: kein Schutz vor Drop *auf sich selbst* / zyklischer Selbst-Bewegung über `.keep`-Dateien + `drop`-Listener pro Ordner-Node**
`attachFolderDragDrop` registriert `dragover`/`dragleave`/`drop`/`contextmenu` pro geöffneter Ordner-Node. Bei vielen expandierten Ordnern → viele anonyme Listener (wiederholtes Fund 2). Inhaltlich: `drop` prüft `path.startsWith(`${folderPath}/`)` (Zeile 389) — das schützt nur, wenn der *dragged* Pfad ein Kind des drop-targets ist. Wird ein Elternteil-Ordner (oder das Workspace-Wurzelverzeichnis selbst, falls per `dragstart` per `dataset.path` ein Ordner-Pfad gesetzt werden könnte — aktuell `el.draggable = !node.isFolder` blockiert das) abgelehnt, gut; aber `.keep`-Dateien werden als Files behandelt und dürfen in sich selbst fallen (Zeile 267 `if (node.name === '.keep' && node.isFolder) return;` — `.keep` wird als *Ordner* übersprungen, aber bei einer *Datei* `.keep` wird sie in denselben Ordner gedroppt → Name-Kollision → Alert).
**Vorschlag:** In `drop` auch prüfen, dass `folderPath` nicht das Ziel-Elternteil von `path` ist (Schleifensperre über Pfadsegmente), und `.keep`-Zielkollision explizit abfangen; besser: Event-Delegation für Drop, wie bei Fund 2.

### [ExplorerApp.ts:125 (refresh)] — SCHWEREGRAD: MITTEL
**`refresh()` schluckt alle Bridge-Fehler und setzt `files = []` bei `!res.ok`**
`this.files = (res?.ok ? (res.data as FileEntry[]) : []) || []` — bei einem temporären IndexedDB-Timeout oder Bridge-Fehler wird die Liste *auf leer gesetzt* und `render()` zeigt „No files yet“ (Zeile 158), obwohl vorher 500 Dateien geladen waren. Für den User wirkt das wie Datenverlust.
**Vorschlag:** Bei `!res.ok` die bestehende Liste erhalten, einen sichtbaren Fehlerstatus (z. B. Statusleiste/`window.alert`/Toast) setzen, und nur bei explizitem `res.ok && Array.isArray(res.data)` die Liste ersetzen.

### [ExplorerApp.ts:40-58 (build)] — SCHWEREGRAD: NIEDRIG
**`title`-Attribute im Template ohne `escapeHtml`**
Zeile 46-50, 53: `title="${t('explorer.newFolder') || 'New folder'}"` — i18n-Werte werden direkt in `innerHTML` injiziert. In der Praxis sind das Konstanten aus einer lokalisierten Table, kein User-Inhalt, daher kein XSS; aber: wenn `t()` je einen Wert zurückgibt, der `"` oder `>` enthält, bricht das Attribut auseinander und ermöglicht Injektion. Gilt auch für Zeile 320: `title="' + (t('explorer.edit') || 'Edit') + '"`.
**Vorschlag:** Alle `title`-/`placeholder`-Attribute über `escapeHtml()` oder — sauberer — per `el.setAttribute('title', ...)` setzen.

### [ExplorerApp.ts:117-121 (mount)] — SCHWEREGRAD: NIEDRIG
**`mount()` ruft `container.innerHTML = ''`**
Jede neue `mount()`-Aufruf vernichtet alle Kinder des Containers — inkl. etwaiger anderer App-Elemente, die dort leben. Wird `ExplorerApp` in ein geteiltes Pane eingebunden, überschreibt die Mount-Ordnung die Sichtbarkeit anderer Inhalte. Besser: `while (this.element.parentNode !== container) this.element.remove()` / reine append, und die `innerHTML = ''` dem Aufrufer überlassen.

### [ExplorerApp.ts:364-371] — SCHWEREGRAD: NIEDRIG
**HTML-Edit-Button setzt `activePath` *nach* `onOpenFile`, nicht vor**
Zeile 367-369: `this.activePath = node.path; this.onOpenFile?.(node.path); this.render();` — das ist korrekt ordnend; im Gegenzug Zeile 329-335 (Click ohne Button) setzt `activePath` vor `onOpenFile`/`runHtml` und rendert *danach* — konsistent, aber: bei einem langsamen HTML-Run (Zeile 331 `runHtml` ist async ohne `await`!) feuert `this.render()` (Zeile 335) parallel zum `readFile`-Promise. Kein Bug, sondernRace-Prädisposition, wenn `onOpenFile` die Editor-Instanz synchron neu belegt.
**Vorschlag:** `runHtml` entweder `await`-en mit `disabled`-Zustand während des Lade, oder die UI-Action explizit sequenziell machen.

---

## 2. TextEditorApp.ts

### [TextEditorApp.ts:107-112, 127-138] — SCHWEREGRAD: HOCH
**Prism-Highlight auf *jedem* `input`-Event ohne Debounce → O(n) Parse + innerHTML-Injektion pro Tastendruck**
`textarea.addEventListener('input', ...)` → `highlightCode()` → `Prism.highlight(code, ...)` + `codeEl.innerHTML = highlighted`. `Prism.highlight` ist CPU-intensiv (Tokenizing-Regex) und `innerHTML`-Setzen bei großen Dateien (1 MB+) blockiert die Mainthread pro Eingabecharakter. `updateGutter` (Zeile 542-547) baut *ebenfalls* bei jeder Zeilenzahländerung den kompletten Gutter-HTML-String neu (O(zeilen²) wegen `Array.from(...).join('')`). Bei einer 50k-Zeilen-Datei + Tipp = Frame-Drops.
**Vorschlag:** `highlightCode` per `requestAnimationFrame` oder `debounce(100-250 ms)` ausführen und das Highlighten in einen Web Worker (`prismjs` ist Worker-kompatibel) verlagern; Gutter per CSS `counter`/`-webkit-line-clamp`-frei generieren (einmalige `DocumentFragment`-Generierung, inkrementelle Anhängen von Zeilen bei Verlängerung statt voller Rebuild).

### [TextEditorApp.ts:132] — SCHWEREGRAD: MITTEL
**`Prism.highlight`-Ergebnis direkt per `innerHTML` injiziert — Prism escapet, aber kein `type="text/plain"` auf dem Pre-Element**
`Prism.highlight` liefert schon escape-tem HTML (intern ersetzt Prism `<`, `>`, `&`), daher kein klassisches XSS; aber: da `highlightEl` ein `<pre>` ohne `type="text/plain"` ist und der Inhalt dynamisch kommt, ist die Abhängigkeit von Prism-Internalien (Escape-Verhalten) implizit. Wenn `currentLang` je ein Sprach-ID liefert, das `Prism.languages` *nicht* enthält, fällt Zeile 129 in den `else`-Zweig (Zeile 134-136), dort `textContent` — korrekt. Edge Case: `languageForPath` (Zeile 22-45) liefert bei `path.match(/\.([^.]+)$)/` einen Ext-Wert, der nicht in der Map ist → `null` → Plain-Text, OK. Echter Rest-Risiko: Prism-Plugin-/Komponente, die `keepMarks` o. Ä. verwendet, könnte `innerHTML`-unsichere Sequenzen erzeugen; hier nicht der Fall, daher **MITTEL** nur als Fragilität.
**Vorschlag:** Explizit auf `highlightEl.setAttribute('type','text/plain')` verzichten *oder* das Ergebnis vor der Injektion über `DOMParser` validieren/normalisieren — defensive Tiefe.

### [TextEditorApp.ts:152-162 (recordInput), 164-183 (undo/redo)] — SCHWEREGRAD: MITTEL
**Undo-Stack speichert `this.textarea.value` (ganzen String) in jedem Stack-Slot — O(n·m) Speicher bei großen Dateien**
`undoStack.push(this.textarea.value)` mit `UNDO_DEBOUNCE_MS = 300` — jede 300 ms aktive Eingabe push den *kompletten* Text. 50 Eingaben × 5 MB = 250 MB String-Kopien. `redoStack = []` wird bei jeder Eingabe neu allokiert (Zeile 160), auch wenn er leer ist.
**Vorschlag:** Inkrementelles Undo (Diff/Chunk-basierend, z. B. `codegraph`-ähnlich) oder mindestens eine hart-limited `undoStack.length > 20`-Spalte (aktuell 50) und `redoStack` per in-place `.length = 0` statt Neuanlage.

### [TextEditorApp.ts:217-232 (findAll)] — SCHWEREGRAD: MITTEL
**`findAll` wird synchron auf dem *vollen* Text-Buffer ausgeführt und wird bei *jedem* `input`-Event des Suchfeldes neu aufgerufen**
Zeile 244-247: `findInput.addEventListener('input', () => { currentIndex = 0; findAll(); })` — ohne Debounce. Bei einer 10 MB-Datei + 3-Suchstring wird bei jeder Taste des Benutzers im Find-Input `text.indexOf` linear über den ganzen Buffer gescannt → O(n) pro Key. Auch `matches`-Array kann bei „a“ in 1 MB-Text 1 Mio. Einträge haben (Speicher).
**Vorschlag:** `findAll` debounce (100 ms), Trefferliste cap-ten (z. B. max 10.000) mit „(gekappt)“-Indikator, und `indexOf`-Schleife per `break` bei Erreichen der Cap.

### [TextEditorApp.ts:252-283 (replaceOne/replaceAll)] — SCHWEREGRAD: MITTEL
**`replace-all` setzt `textarea.value = newText` *ohne* `recordInput(false)`-Pfad, aber mit `recordInput(true)` — korrekt; dennoch: kein `onSave`-Callback und kein Undo-Punkt *vor* der Ersetzung**
`replaceAll` (Zeile 269-283) führt `this.textarea.value = newText` direkt zu, dann `recordInput(true)`. Das `recordInput(true)` push den *neuen* Wert; der *alte* Wert ist der `undoStack.undoStack[last]` (Zeile 158 ersetzt) — d. h. Undo nach ReplaceAll *kann* den alten Stand wiederherstellen, *wenn* vorher ein Input stattgefunden hat. Falls die *erste* Aktion im Dokument ein ReplaceAll ist, ist `undoStack.length === 1` (Initial aus `load()`, Zeile 507), und `undo()` (Zeile 164-165: `if (this.undoStack.length <= 1) return;`) verweigert den Undo → **Data Loss** für das erste ReplaceAll nach dem Öffnen.
**Vorschlag:** In `recordInput`, wenn `undoStack.length === 1`, den *aktuellen* Wert *vor* der Ersetzung pushen (d. h. `recordInput` aufrufen *bevor* `value` geändert wird, oder in `replaceAll`/`replaceOne` explizit `this.undoStack.push(this.textarea.value)` *vor* der Mutation).

### [TextEditorApp.ts:264-266] — SCHWEREGRAD: NIEDRIG
**`replaceOne`: `findAll()` wird erst *nach* der Ersetzung aufgerufen; `selectMatch(currentIndex + 1)` darauf aufbauend nutzt *veraltete* `matches`**
Zeile 265-266: `findAll(); selectMatch(currentIndex + 1);` — `findAll` aktualisiert `matches` (neue Positionen), aber `currentIndex` + 1 bezieht sich auf die *neue* matches-Liste, was korrekt ist; jedoch: wenn die Erhebung die Anzahl der matches *ändert* (Ersetzung um einen kürzeren String), kann `currentIndex + 1` > `matches.length` werden. `selectMatch` nimmt `mod matches.length` (Zeile 236), das ist OK; aber `currentIndex` ist vor `mod`-Operation auf den alten Wert gescratched — kein Bug, nur fragil. **NIEDRIG**.

### [TextEditorApp.ts:386-414 (Tab-Handling)] — SCHWEREGRAD: NIEDRIG
**Shift+Tab-Entzerraumung setzt `setRangeText` auf `lineStart..start` — wenn die Zeile *kürzer* ist als `tabSize` Leerzeichen, wird die ganze Vorzeile gelöscht statt nur die vorhandenen Leerzeichen**
Zeile 395-404: `before.startsWith(' '.repeat(tabSize))` → `setRangeText(before.slice(tabSize), ...)`; `before.startsWith('\t')` → `setRangeText(before.slice(1), ...)`; sonst: `before.match(/^ +/)` → `setRangeText(before.slice(leading[0].length), ...)` — der letzte Zweig (Zeile 403) entfernt *alle* führenden Leerzeichen (potentiell mehr als `tabSize`), das ist inkonsistent mit den ersten beiden Zweigen (die genau `tabSize` resp. 1 Tab entfernen).
**Vorschlag:** Einheitliche Logik: `min(leadingSpaces, tabSize)` Entziehen, `setRangeText(before.slice(removeCount), ...)`.

### [TextEditorApp.ts:495-499, 502-514 (openFile/load)] — SCHWEREGRAD: MITTEL
**`openFile` ist *nicht* sequenziell mit `load` — `onOpenFile` wird *vor* `load()` aufgerufen und `load()` ist async, aber *nicht* `await`-et**
Zeile 498-499: `this.onOpenFile?.(path); this.load();` — `load()` ist ein `async` ohne `await`. Wenn `onOpenFile` synchron einen *anderen* Pfad erneut öffnet (z. B. Explorer → Editor-Cascade), überlappt das `readFile`-Promise mit dem zweiten `load`; letztes-Write-gewinnt im `textarea.value`, und `savedContent`/`dirty`-Flag können aus dem *alten* `load` stammen → unsichtbarer Dirty-State / falscher Saved-Inhalt.
**Vorschlag:** `await this.load()` in `openFile` (bzw. einen `loadSeq`-Counter, mit dem veraltete Loads abgebrochen werden).

### [TextEditorApp.ts:516-536 (save)] — SCHWEREGRAD: NIEDRIG
**`save()` setzt `this.currentPath = path` (Zeile 519) *vor* dem Bridge-Call; bei `res.ok === false` ist `currentPath` bereits auf den neuen Pfad gesetzt, aber `savedContent`/`dirty` bleiben unverändert — `onSave` wird nicht gefeuert, aber `setPathDisplay` zeigt den neuen Pfad als „gespeichert“ ohne `●`**
Inkonsistenz: User sieht neuen Pfad in der Header-Leiste, aber Editor ist noch dirty — `setPathDisplay` wird nicht erneut nach dem Fehlschlag aufgerufen, daher zeigt die Zeile den *alten* State + neuen Pfad. Minorer UI-Bug. **NIEDRIG**.
**Vorschlag:** `save()` auf Erfolg/`res.ok` prüfen *und* `setPathDisplay()` erneut aufrufen (oder `currentPath` erst nach成功 setzen).

### [TextEditorApp.ts:542-547 (updateGutter)] — SCHWEREGRAD: MITTEL
**Gutter-HTML-String wird per `Array.from({length: lines}).map(...).join('')` pro Zeilenzahländerung neu erzeugt**
Bei einer Datei mit 100k Zeilen + Einfügen einer Zeile in Zeile 50 → 51k neue `<div>`-Elemente per `innerHTML`. Sehr teuer. Siehe Fund 1 (Performance).

### [TextEditorApp.ts:107-124] — SCHWEREGRAD: NIEDRIG
**`recordInput` wird im `input`-Listener *vor* `refreshDirty`/`updateGutter`/`highlightCode` aufgerufen — korrekt; aber: `undo`/`redo` (Zeile 170-172, 179-181) setzen `textarea.value` *ohne* `input`-Event → `recordInput` wird *nicht* aufgerufen → Gutter und Highlight werden manuell synchronisiert (Zeile 171-172, 181-182) — korrekt, aber: `updateLanguage` wird bei Undo/Redo *nicht* aufgerufen, d. h. wenn die Sprache zwischendurch über `onOpenFile` geändert wurde, bleibt die *alte* Sprache aktiv. **NIEDRIG**.

### [TextEditorApp.ts:79, 93, 105, 391] — SCHWEREGRAD: NIEDRIG
**`loadConfig().editorTabSize` wird an drei Stellen unabhängig gelesen und `tab-size` inline per `style="tab-size: ${tabSize}"` gesetzt (Zeile 93) + `this.highlightEl.style.tabSize = String(tabSize)` (Zeile 105) + `const tabSize = loadConfig().editorTabSize ?? 2` in `handleKeydown` (Zeile 391) — drei unabhängige Config-Lesungen, die sich inkonsistent verhalten können**
Wenn `editorTabSize` während der Editor-Sitzung geändert wird (eigentlich nur über Settings möglich, die neu laden), divergiert die Tab-Größe zwischen Textarea-`tab-size`-CSS, Highlight-`tab-size`-CSS und Tab-Insert-Weite. **NIEDRIG** (wenn Settings neu rendert, ist das kein Problem; ansonsten fragil).
**Vorschlag:** `tabSize` einmalig zu `private tabSize: number` machen und bei `mount()`/`setData()` aktualisieren.

---

## 3. AppStoreApp.ts

### [AppStoreApp.ts:81-94 (load)] — SCHWEREGRAD: HOCH
**`load()` wird (a) bei `mount()`, (b) vom 30-sek-Timer, (c) vom Refresh-Button aufgerufen — drei parallele Aufrufe sind möglich; jeder erzeugt eine `fetch` + `render()`, und der *letzte* `render()` gewinnt — aber: `refreshInstalled()` (Zeile 89) liest *alle* Workspace-Dateien + parst deren HTML, und `render()` baut die komplette Grid-UI neu. Bei `n` parallelen Laden + `m` installierten Apps → O(n·m) redundante Parsing + DOM-Rebuilds**
Konkretes Szenario: User klickt „Refresh“ während der 30s-Timer `load()` triggert → beide laufen parallel, beide `await fetch`, beide `render()`; der spätere `render` überschreibt den früheren. `setInstalled`/`install`-Status kann in der Zwischenzeit in `status='installing'` stehen, aber `load()` setzt `status='loading'` (Zeile 76) — **UI-State-Korruption**: ein laufender Install-Prozess wird visuell durch den parallelen Load auf „loading“ zurückgesetzt, dann wieder `'idle'` (Zeile 90), was den User irregeführt (Install „hängt“) oder — schlimmer — `updateAll`/`install` setzen `status='installing'` *nach* dem `load()`-Rückkehr → `render()` zeigt „loading“ statt „installing“.
**Vorschlag:** Load-/Refresh-Idempotenz per Guard (z. B. `if (this.status === 'loading' || this.status === 'installing') return;` am Anfang von `load()`), oder einen `loadSeq`-Counter mit dem veraltete Loads verworfen werden.

### [AppStoreApp.ts:98-105 (startRefreshLoop)] — SCHWEREGRAD: HOCH
**`setInterval`-Refresh-Loop wird in `mount()` gestartet, aber nie gestoppt — kein `unmount`/`destroy`-Hook, kein `clearInterval` bei App-Schließung**
`stopRefreshLoop` existiert (Zeile 107-112), wird aber *nur* durch `startRefreshLoop` selbst aufgerufen (Zeile 99), nie von außen. Wird das AppStore-Fenster geschlossen und neu geöffnet, startet ein *zweites* `setInterval` und das erste läuft weiter → doppelter Fetch-+Render-Zyklus alle 30 s, dauerhaft akkumulierend.
**Vorschlag:** App-Interface um `unmount?(): void` erweitern; AppStoreApp implementiert `unmount` = `stopRefreshLoop()`. Alternativ: den Timer in den WindowManager verlagern.

### [AppStoreApp.ts:172, 212] — SCHWEREGRAD: HOCH
**`app.path` wird direkt in eine URL injiziert — bei manipulierbarem/fremden `index.json` (GitHub-Repo ist öffentlich editierbar via Fork, oder MITM auf `raw.githubusercontent.com`) Pfad-Injektion / SSRF-artige URL-Fälschung**
Zeile 172: `` `https://raw.githubusercontent.com/.../apps/${app.path}/index.html?nocache=${Date.now()}` `` — wenn `app.path` = `../../other/index.html` oder `other?x=1` enthält, wird die URL zu einer anderen Ressource (CORS durch raw.githubusercontent.com blockiert den *Lesen*, aber der *Absender* der Request ist immer noch `vibeAgentGo` — bei einer `file://`-PWA mit Service Worker kann eine solche Request-Generierung Cache-/CSP-Probleme auslösen; bei einem `data:`- oder `javascript:`-Manipulation der `path` (weniger wahrscheinlich) wäre es XSS-nach. Realistisches Risiko: `path` aus `index.json` kommt von einem *GitHub-Raw-Host* mit `no-cache`, d. h. der Fetch geht an `raw.githubusercontent.com` — ein `path` wie `../../secrets` würde an `raw.githubusercontent.com/vibeopsde/vAG-Apps/main/secrets` laufen → *404*, kein Schaden. Aber `path` mit `../../vAG-Apps/main/someother/repo-file` könnte eine *andere* Datei aus demselben Repo lesen. **HOCH**, weil die Validierung fehlt.
**Vorschlag:** `app.path` serverseitig *und* clientseitig gegen `^[\w\-]+(/[\w\-\/]+)?$` validieren; `URL`-Objekt nutzen (`new URL(base)` + `pathname`-Manipulation) statt String-Konkatenation.

### [AppStoreApp.ts:263-270 (render header), 341, 358, 360, 364, 375-436 (renderAppCard)] — SCHWEREGRAD: MITTEL
**Remote-Inhalte (`app.name`, `app.description`, `app.category`, `app.author`, `app.icon`, `app.permissions`) werden über `escapeHtml` in `body.innerHTML` injiziert (Zeile 388-400) — korrekt; *aber*: `renderPermissions` (Zeile 438-441) macht `perms.join(', ')` *ohne* `escapeHtml` und injiziert das in `body.innerHTML` (Zeile 392: `${this.renderPermissions(app.permissions)}`) — **XSS-Risiko**: `permissions` ist ein `string[]` aus `index.json` (remot, öffentlich) — ein `permission`-Wert wie `</div><script>alert(1)</script>` würde *nach* dem `escapeHtml` (das nur die *andere* Interpolation escapet, nicht `renderPermissions`-Rückgabe) *direkt* in `innerHTML` landen, da `${this.renderPermissions(...)}` *nicht* escaped wird.
**Vorschlag:** `renderPermissions` per `escapeHtml(perms.join(', '))` escapen, *oder* den gesamten `body.innerHTML` durch `textContent`-basierte DOM-Konstruktion ersetzen.

### [AppStoreApp.ts:114-145 (refreshInstalled)] — SCHWEREGRAD: MITTEL
**`refreshInstalled` parst *jeden* `apps/*/index.html`-Content per regex + `JSON.parse(match[0].replace(/<[^>]+>/g, '').trim())` — `replace(/<[^>]+>/g,'')` ist eine rohe HTML-Tag-Stripper, die an HTML-Attributen mit `>` in Strings, Entities (`&lt;`), oder selbst-nicht-HTML-Content (z. B. `</script>`-Injection) scheitert; und *wichtig*: das Regex `/<script\s+type="application\/vnd\.vag\+json"[^>]*>[\s\S]*?<\/script>/i` — `[^>]*` nach `type="..."` wird *greedy-interpretiert* an `>` — korrekt für Attribute ohne `>`; aber: wenn das Manifest-JSON selbst ein `</script>`-String enthält (z. B. in `description`), bricht das Regex *früh* ab → `JSON.parse` scheitert → App wird *stumm* übersprungen (Zeile 140-141) — User sieht die App nicht als installiert, obwohl sie es ist.
**Vorschlag:** `parseAppManifest` (aus `core/appManifest.ts:32`) wiederverwenden (das existiert bereits! Zeile 33 identischem Regex), oder `DOMParser` mit `document.importNode` nutzen, um sicher zu parsen. **Doppelt gemeldet**: `parseAppManifest` wird *anderswo* aufgerufen (vermutlich in `installApp`-Bridge), aber `refreshInstalled` hat *eigene* Inline-Implementierung — Inkonistenz.

### [AppStoreApp.ts:322-328 (category buttons)] — SCHWEREGRAD: NIEDRIG
**`btn.textContent = cat;` (Zeile 323) — korrekt (kein XSS); *aber*: `cat` ist `string` aus dem Remote-Index (Zeile 88). `textContent` ist sicher, *deshalb* kein Fund, sondern nur erwähnenswert, dass `escapeHtml` hier bewusst fehlt — OK.

### [AppStoreApp.ts:58-61 (setInstalled), 63-68 (mount)] — SCHWEREGRAD: NIEDRIG
**`setInstalled` rendert *bevor* `store` geladen ist**
Zeile 58-61: `setInstalled` setzt `this.installed` und ruft `this.render()` auf. Wenn `this.store === null` (nicht geladen): `getUpdatableApps()` (Zeile 153-158) gibt `[]` zurück, `getInstalledApps()` (Zeile 161-164) gibt `[]` — d. h. `renderInstalledContent` (Zeile 353-373) zeigt „No apps installed yet“ *obwohl* `installed` Map voll ist — **Falscher Zustand** für den User, bis `load()` erfolgreich `store` setzt.
**Vorschlag:** `setInstalled` sollte `render()` nur aufrufen, wenn `this.store` bereits gesetzt ist; oder `render()` in `setInstalled` weglassen und stattdessen `load()` den ersten `render` nach `store`-Setzen triggern (der `render` am Ende von `load()`).

### [AppStoreApp.ts:167-201 (install), 203-239 (updateAll)] — SCHWEREGRAD: NIEDRIG
**`install`/`updateAll`: `this.status = 'installing'` + `render()` (Zeile 168-169 / 207-208) — aber: *kein* `try/finally` um `status` zurückzusetzen bei *unbehandeltem* Fehler (z. B. `this.bridge` wirft, `refreshInstalled` wirft), und `install` hat `catch(e)` (Zeile 196-199) der `status='error'` setzt — *aber* wenn `refreshInstalled` (Zeile 194) *vor* dem `catch` einen ungesicherten Fehler wirft, fliegt der Fehler aus `install` heraus (kein `try`-Block drumherum? — nein: Zeile 171 `try` bis Zeile 199 `catch`; `refreshInstalled` ist *innerhalb* des `try` → OK, `catch` fängt das. *Aber*: `updateAll` (Zeile 203-239) hat *keinen* `try` um den `for`-Loop als Ganzes — jeder `catch` ist pro-Iteration (Zeile 232-234), aber `refreshInstalled` (Zeile 236) und `render` (Zeile 238) sind *außerhalb* des `for` und *ohne* `try` → wenn `refreshInstalled` wirft, `status='installing'` bleibt *ewig* → UI ist *permanent* auf „Installing…“ gefroren.
**Vorschlag:** `updateAll` in `try/finally` hüllen, `finally` setzt `status = status === 'installing' ? 'idle' : status`.

---

## 4. SettingsApp.ts

### [SettingsApp.ts:57-69 (mount), 67-109 (renderShell)] — SCHWEREGRAD: HOCH
**`renderShell` wird bei *jeder* `mount()`-Aufrufe aufgerufen (Zeile 62) und ersetzt `container.innerHTML` (Zeile 72) — *plus* `this.renderTab` (Zeile 63). Das erzeugt eine unendliche Menge an Event-Listenern pro remount: `container.querySelectorAll('.settings-tab').forEach(btn => btn.addEventListener(...))` (Zeile 103-108) — aber: da `container.innerHTML = ...` die *alten* Tabs *vernichtet*, sind die alten `btn`-Elemente *bereits* aus dem DOM → die alten Listener sind *automatisch* weg (GC-fähig). Daher *kein* klassischer Listener-Leak; *aber*: der `switchTab`-Closure (Zeile 104-107) hält `container` (Parameter) und `this` (SettingsApp-Instanz) in Referenz — wenn die App *niemals* unmounted wird (kein `destroy`-Hook im `App`-Interface!), hält jede `mount()`-Aufrufe *ein* Closure-Referenz auf die *alte* `container`-DOM-Kette, auch wenn `container` aus dem Wurzel-DOM entfernt wurde → **DOM-Leak**: die entfernten Settings-Panels (einschließlich ggf. MemoryPanel-Elemente, Zeile 142-147) werden nicht freigegeben.
**Vorschlag:** `App`-Schnittstelle um `unmount?(): void` erweitern; SettingsApp implementiert `unmount` = `this.element.innerHTML = ''` + `this.container = null`.

### [SettingsApp.ts:126-144 (renderTab)] — SCHWEREGRAD: MITTEL
**`renderTab` setzt `panel.innerHTML = ''` (Zeile 124) und rendert *dann* den Tab-Content — aber: wenn `renderWorkspaceSection` / `renderBackupSection` / `renderDangerZoneSection` / `MemoryPanel` asynchrone Work (fetch/IDB) starten, halten sie Closures auf `panel`/`container`; bei schnellem Tab-Wechsel (User klickt 5x pro Sekunde) laufen 5 parallele Work-Flüsse und schreiben in *verschiedene* `panel`-Referenzen, die *alle* auf dasselbe `panel`-Element zeigen → **Race**: letzte-Write-gewinnt, aber *vorherige* `fetch`/`fetchBackup`-Callbacks feuern in die *bereits* entfernten Elemente → „ghost“-Updates.
**Vorschlag:** Per-Tab-`AbortController`-Token, der bei Tab-Wechsel abgebrochen wird; oder `renderTab` synchron abwarten (Promise-basierend), bevor der nächste Tab gerendert wird.

### [SettingsApp.ts:316-325 (showBackupMessage)] — SCHWEREGRAD: MITTEL
**`container.querySelector('#cfg-backup-result')` — `#cfg-backup-result` ist ein *ID*-Selector, der im *gesamten* Document *einzigartig* sein muss; aber: `id`-Attribute sind *nicht* dokument-scope, sondern *global* — wenn zwei SettingsApp-Instanzen (zwei Windows) gleichzeitig existieren, *beide* `showBackupMessage` suchen nach `#cfg-backup-result` *im gesamten `container`* (Zeile 317: `container.querySelector`), wobei `container` = *SettingsApp's `panel`* — *innerhalb des Panels* ist `#cfg-backup-result` eindeutig, *deshalb* kein Bug; *aber*: `container.querySelector('#cfg-reset')?.parentElement` (Zeile 321) — `#cfg-reset` wird in `renderBackupSection` (externes Modul) erzeugt, und wenn *zwei* SettingsApp-Instanzen existieren, *beide* haben ein `#cfg-reset` in *ihrem* Panel — *lokal* eindeutig, OK. Nur erwähnenswert: ID-basierte DOM-Suche ist *fragil* bei mehreren Instanzen, auch wenn sie hier lokal funktioniert.
**Vorschlag:** `data-*`-Attribute oder `:scope`-Relative-Selektoren statt IDs für interne Element-Verdrahtung.

### [SettingsApp.ts:128-239 (renderLLMTab / renderAppearanceTab)] — SCHWEREGRAD: NIEDRIG
**`saveConfig({ ...config, ... })` (Zeile 173-181, 237) — `config` wird *einmalig* zu Beginn des Tabs geladen (Zeile 155, 187) und als Basis für `{...config, ...}` verwendet; wenn zwischen dem Laden und dem Speichern *anderer* Code `config` mutiert (z. B. LLM-Section-Component schickt einen eigenen `saveConfig`), gehen Änderungen *stumm* verloren**
**Vorschlag:** `saveConfig`-Callback mit *frischem* `loadConfig()`-Snapshot aufrufen, oder eine *Merge*-Strategie, die nur die *explizit* geänderten Felder überschreibt.

### [SettingsApp.ts:142-147 (renderMemoryTab)] — SCHWEREGRAD: NIEDRIG
**`new MemoryPanel()` + `memoryPanel.open()` (Zeile 144-146) — wenn der User *zweimal* auf „Memory“-Tab klickt, werden *zwei* `MemoryPanel`-Instanzen erzeugt (`panel.innerHTML = ''` vernichtet die erste, aber die *Closure* hält `memoryPanel` in Referenz) — *wenn* `MemoryPanel.open()` asynchrone Work (fetch/IDB) startet, die *nach* der Neuerung der zweiten Instanz *zurückkommt*, schreibt das in ein *entferntes* DOM-Element → „ghost“-Update. Siehe Fund 2 (Race).

### [SettingsApp.ts:75, 267] — SCHWEREGRAD: NIEDRIG
**`<img src="./logo-192.png" ... >` — relative URL; wenn die PWA von einer *anderen* Basis-URL geladen wird (z. B. `/settings`-Route), bricht das Logo ab. **NIEDRIG/STYLE**, aber: *kein* `decoding="async"`, *kein* `loading="lazy"` — bei langsamen Netzen blockiert das Logo-Loading den ersten Paint des Settings-Tab.

### [SettingsApp.ts:295, 298] — SCHWEREGRAD: NIEDRIG
**`<a href="https://github/vibeopsde/vibeAgentGo" target="_blank" rel="noopener">` — `rel="noopener"` ist korrekt (kein `rel="noreferrer"`-Leak, kein XSS via `window.opener`); **OK**, kein Bug.

### [SettingsApp.ts:42] — SCHWEREGRAD: NIEDRIG
**`title = t('settings.title')` (Zeile 42) — wird *beim Konstruieren* der App *einmalig* aufgelöst; wenn die Sprache *danach* geändert wird (SettingsApp → Appearance → Language Switch), bleibt `this.title` auf der *alten* Sprache → WM-Header zeigt veralteten Titel.
**Vorschlag:** `title` als `get title()`-Accessor, der `t('settings.title')` pro Zugriff auflöst.

---

## 5. appManifest.ts

### [appManifest.ts:36-38, 44-48, 53-61] — SCHWEREGRAD: HOCH
**`manifest: undefined as unknown as AppManifest` — *bewusst* typbruchende Rückgabe; jeder Caller, der `manifest.id` / `manifest.name` *ohne* die `error`-Prüfung liest, stürzt auf `TypeError: Cannot read properties of undefined`**
Zwar ist die Signatur `{ manifest: AppManifest; error?: string }` — *aber* der Vertrag „entweder `manifest` *oder* `error`“ ist *nur* dokumentiert durch die `error`-Eigenschaft; ein TypeScript-Caller, der `error === undefined` annimmt, wird *crashen*. *Doppelte Meldung*: Zeile 36-38 (kein Match), Zeile 44-48 (invalid JSON), Zeile 53-61 (missing id/name, invalid category) — *alle vier* Pfade liefern `undefined as unknown as AppManifest`.
**Vorschlag:** Signatur auf ein *Discriminated Union* umstellen: `type ManifestResult = { manifest: AppManifest; error?: never } | { manifest?: never; error: string }` — der TypeScript-Compiler zwingt dann jeden Caller zur `error`-Prüfung *bevor* `manifest` gelesen wird.

### [appManifest.ts:33, 69] — SCHWEREGRAD: MITTEL
**`/<script\s+type="application\/vnd\.vag\+json"[^>]*>([\s\S]*?)<\/script>/i` — `[^>]*` nach `type="..."` ist *non-greedy* und *kann* Attribute mit `>` in Strings überspringen (z. B. `data-x="a>b"`), *oder* — wichtiger: wenn das Manifest selbst ein *selbst-schließendes* `<script type="vnd.vag+json"/>` oder ein *attribut mit `"`-Break* enthält, bricht das Regex *früh* oder *spät* ab. *Aber* der eigentliche Bug: `([\s\S]*?)` ist *non-greedy* — bei *mehreren* `script`-Tags mit demselben `type` nimmt es *das erste* — korrekt; *aber*: wenn das Manifest-JSON ein *`</script>`*-String enthält (z. B. in `description: "foo</script>bar"`), bricht das Regex *vor* dem echten `</script>` ab → `JSON.parse` scheitert → App wird als invalid gemeldet.
**Vorschlag:** Das Manifest-JSON im `index.json` durch `JSON.stringify` *vor* der Insertion *sicherstellen*, dass kein `</script>`-String vorkommt (oder `&lt;/script&gt;`-Entität verwenden); *oder* das Regex durch `html.lastIndexOf('</script>')`-basierte Suche ersetzen.

### [appManifest.ts:51] — SCHWEREGRAD: MITTEL
**`{ ...DEFAULT_MANIFEST, ...parsed } as AppManifest` — `parsed` ist `Partial<AppManifest>`; wenn `parsed.category` *falsch* ist (z. B. `category: "Hacking"`), *wird* es durch `DEFAULT_MANIFEST.category = 'Utilities'` *nicht* überschrieben, weil `parsed.category` existiert — *und* die Prüfung auf Zeile 56-61 *prüft* `manifest.category` *nach* dem Spread — korrekt. *Aber*: `parsed.permissions` — wenn `parsed.permissions = []` (leeres Array), *überschreibt* es `DEFAULT_MANIFEST.permissions = []` (identisch) — OK. Wenn `parsed.permissions = null` (JSON `null`), *überschreibt* es `DEFAULT_MANIFEST.permissions = []` mit `null` → `manifest.permissions = null` → jeder Caller, der `manifest.permissions.map(...)` aufruft, *crasht*.
**Vorschlag:** `permissions: Array.isArray(parsed.permissions) ? parsed.permissions : (DEFAULT_MANIFEST.permissions ?? [])` — explizite Array-Prüfung.

### [appManifest.ts:66-78 (injectAppManifest)] — SCHWEREGRAD: HOCH
**`JSON.stringify(manifest, null, 2)` wird direkt in das Template-String injiziert (Zeile 68); `JSON.stringify` *escapet* `"`-Zeichen in String-Werten, *aber* nicht `</script>`-Sequenzen in String-Werten (z. B. `manifest.description = "</script><img onerror=alert(1)>"`) → `injectAppManifest` erzeugt `<script type="vnd.vag+json">{"description":"</script><img onerror=alert(1)>"}...` → **XSS**: Das `</script>` bricht das `<script>`-Tag auf, und `<img onerror=...>` wird *als HTML* interpretiert und *ausgeführt*.**
Dies ist ein **klassischer Manifest-Injection-Vector**. `parseAppManifest` (Zeile 43) macht `JSON.parse` und *vergleicht* dann — *aber* `injectAppManifest` *vertraut* dem `manifest`-Objekt, *ohne* `</script>`-Sequenzen zu entgiltigen.
**Vorschlag:** Nach `JSON.stringify` *vor* der Insertion: `json = json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')` — *oder* `JSON.stringify` mit *eigenem* Replacer, der `<` → `\u003c` und `>` → `\u003e` in *jeder* String-Wert konvertiert. **KRITISCH** in dem Sinne, dass ein *bösartiges* Manifest (via AppStore) *ausgeführt* werden kann.

### [appManifest.ts:30] — SCHWEREGRAD: NIEDRIG
**`ALLOWED_CATEGORIES` ist *hartkodiert*; `normalizeCategory` (Zeile 80-81) *normalisiert* unbekannte zu `'Utilities'`, *aber* `parseAppManifest` (Zeile 56-61) *lehnt* unbekannte Kategorien *ab* (statt sie zu normalisieren) — *inkonsistent*: `normalizeCategory` *existiert*, *wird* aber *nie* in `parseAppManifest` aufgerufen. Ein Manifest mit `category: "Hacking"` *scheitert* bei `parseAppManifest`, *während* `normalizeCategory` es *still* zu `'Utilities'` macht — *drei* verschiedene Kategorien-Handhabungen im selben Modul.
**Vorschlag:** `parseAppManifest` sollte `normalizeCategory` *aufrufen* und *nicht* *ablehnen*, oder `normalizeCategory` *entfernen*, um eine *eindeutige* Policy zu haben.

### [appManifest.ts:84-86 (defaultAppPath)] — SCHWEREGRAD: MITTEL
**`apps/${manifest.category}/${manifest.id}` — `manifest.category` ist *valdiert* (aus `ALLOWED_CATEGORIES`), *aber* `manifest.id` ist *nicht* validiert; eine `id` wie `../../etc/passwd` oder `a/b/c` erzeugt einen *Pfad-traversing* Pfad, der bei `installApp`-Bridge *außerhalb* des `apps/`-Verzeichnisses schreiben würde.
**Vorschlag:** `manifest.id` gegen `^[\w\-]+$` validieren, *oder* `defaultAppPath` *vor* der Return-Periode auf `path.basename(id)` kürzen.

---

## Zusammenfassung

Die geprüften Apps enthalten eine **Kombination aus kritischen Sicherheits- und Stabilitätsproblemen**: `appManifest.ts:66-78` erlaubt **Manifest-Injection mit `</script>`-Escape** (KRITISCH), `AppStoreApp.ts` **läuft ein nie gestopptes `setInterval`** (HOCH Listener-Leak) und **injiziert remote `app.path` unvalidiert in URLs** (HOCH); `ExplorerApp.ts` und `TextEditorApp.ts` leiden unter **O(n)-Listener-Multiplikation und fehlendem Debounce** bei Rendering/Highlighting, was bei großen Dateien zu **Frame Drops und Memory-Leaks** führt; `SettingsApp.ts` hat **keinen `unmount`-Hook**, wodurch **DOM-Closures** bei Tab-Wechseln **ghost-Updates** erzeugen. Die drei dringendsten Fixes sind: (1) `</script>`-Escaping in `injectAppManifest`, (2) `unmount?(): void` in der `App`-Schnittstelle + `clearInterval`/`AbortController`, (3) Debounce/Worker für Prism-Highlight und Gutter-Rendering.
