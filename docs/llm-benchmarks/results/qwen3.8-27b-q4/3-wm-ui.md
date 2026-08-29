[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/window_manager.ts
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m→ [0mRead web/src/components/OnboardingWizard.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m→ [0mRead web/src/utils/markdown.ts
[0m→ [0mRead web/src/components/SettingsLLMSection.ts
## Code-Review — Window Manager + UI

---

### SECTION [web/src/components/RenderPanel.ts:210] — KRITISCH
**Problem:** `captureScript` erzeugt das Skript per String-Interpolation mit `title: ${JSON.stringify(title)}`. `JSON.stringify` escape `"` und Control-Chars, aber **nicht** `</`. Enthält der Tab-`title` die Zeichenkette `</script><script>alert(1)</script>` (Tab-Titel stammen häufig aus LLM-Output oder Dateinamen), wird das äußere `<script>`-Element vorzeitig geschlossen und der injizierte Code läuft im iframe. Da der sandboxed-iframe `allow-scripts` hat und die Bridge (`vibeAgentGo.writeFile/readFile/sendMessage`) aufrufen kann, wird daraus eine **Arbitrary-File-Read/Write-Attacke** über die Bridge.
**Vorschlag:** Die `</`-Sequenz sicher machen, z. B. `JSON.stringify(title).replace(/</g, '\\u003c')`, oder besser: `title` nicht hartkodieren, sondern über einen sauberen Kanal übergeben (z. B. `iframe.contentWindow.postMessage({title})` nach Load oder als `document.title`/Dataset setzen und im Skript via `document.currentScript.dataset.title`/DOM lesen).

---

### SECTION [web/src/components/RenderPanel.ts:80-103, 105-126] — KRITISCH
**Problem:** `attachMessageListener()` registriert einen **globalen `window`-`message`-Listener**, der eingehende Objekte ohne jegliche Validierung von `event.origin` und ohne Prüfung, ob `event.source` tatsächlich zu `this.iframe.contentWindow` gehört, direkt an `onBridgeRequest` weiterleitet. Jede beliebige Frame/Quelle (anderer iframe, embedded View) kann also `{vibeAgentGoBridgeRequest:true, request:{type:'writeFile',path:'...',content:'...'}}` posten und damit **beliebige Dateien lesen/schreiben**, Speicher abfragen oder Chat-Nachrichten injizieren. Gleicher Schwachpunkt bei den Log-Nachrichten (jeder Frame kann an `view.logs` schreiben).
**Vorschlag:** Vor der Verarbeitung prüfen: `if (event.source !== this.iframe.contentWindow) return;`, zusätzlich `event.data.request.type` auf eine Whitelist einschränken und Feldtypen validieren. `source` als verlässliche Bindung an den Panel-iframe verwenden.

---

### SECTION [web/src/components/RenderPanel.ts:77, 80] — HOCH
**Problem:** Der in `attachMessageListener()` gesetzte `window`-Listener wird **nie entfernt** — die Klasse hat weder `dispose()`/`destroy()` noch eine Aufschlüsselung der Listener. Jede zweite `RenderPanel`-Instanz hängt einen weiteren globalen Listener an `window`; alle Instanzen empfangen außerdem jede Message. Bei mehreren offenen Views/Tab-Wechseln ist das ein **Listener-Leak** plus Cross-Talk zwischen Panels.
**Vorschlag:** `dispose()`-Methode implementieren, die den globalen Listener per gespeicherter Referenz entfernt (bzw. eine zentrale Bridge-Hub-Klasse mit Register/Unregister nutzen). Listener auf den konkreten `iframe.contentWindow`-Kontext einschränken statt auf das globale `window`.

---

### SECTION [web/src/components/RenderPanel.ts:108, 115, 121] — MITTEL
**Problem:** `source.postMessage(..., '*')` versendet Bridge-Responses (Dateiinhalte, Config, Memories) mit **Target-Origin `'*'`**. Sobald eine Frame den Kontext verlässt/ersetzt wird, können sensible Daten an eine andere Origin geliefert werden.
**Vorschlag:** Exakte Origin der `iframe.contentWindow` als zweites Argument übergeben (`event.origin` bzw. `this.iframe.contentWindow`-Origin, bei `srcdoc` ist `'*'` unvermeidbar — umso wichtiger, dass `event.source === this.iframe.contentWindow` geprüft wird; siehe KRITISCH-Fund).

---

### SECTION [web/src/core/window_manager.ts:157-161, 187-194] — HOCH
**Problem:** Die Window-Bar wird via `bar.innerHTML = \`...${icon}...${title}...\`` aufgebaut, **ohne `escapeHtml`**. `title` kann aus `opts.title` stammen (Aufrufer-gesteuert) oder aus App-Metadaten. Enthält er HTML/`onerror`/`<script>`, wird es injiziert. Auffällig: `updateWindowData()` (Zeile 419-420) setzt den Titel korrekt per `textContent` — hier in `openWindow()` fehlt die Escape gerade bei der Initialanlage.
**Vorschlag:** Bar per DOM-API (`document.createElement` + `textContent` für Icon/Title) bauen oder `icon`/`title` vor der `innerHTML`-Interpolation mit `escapeHtml` escapen. Einheitlich wie in `updateWindowData()`.

---

### SECTION [web/src/core/window_manager.ts:59-69] — MITTEL
**Problem:** Der Konstraktor setzt `window.addEventListener('resize', ...)` und `spaces.addEventListener('scroll', ...)`. Beide werden **niemals entfernt**; das `listeners`-Register (on/off, Zeile 34-36, 96-108) ebenso. Ein `WindowManager`-Tearing (HMR, SPA-Navigation) hinterlässt permanent hängende globale Listener und alle registrierten Handler → **Memory-/Event-Leak**.
**Vorschlag:** `dispose()`-Methode bereitstellen: beide Listener mit gespeicherten Referenzen entfernen, `scrollTimer` aufräumen, `listeners` leeren.

---

### SECTION [web/src/core/window_manager.ts:523-553, 636-662] — MITTEL
**Problem:** `startDrag`/`startResize` hängen `pointermove`/`pointerup`/`pointercancel` an `document` und entfernen sie nur in `onPointerUp`. Setzt `setPointerCapture` auf `e.target` (e. g. ein Kind-`<span>` im Bar). Wird das Fenster während der Geste geschlossen/entfernt (Race mit `closeWindow`), kann `pointerup` ausbleiben → die **`document`-Listener hängen weiter** und `onPointerMove` arbeitet auf einem detached Element.
**Vorschlag:** Geste-State (aktives `id` + Listener-Fns) zentral in einer Instanz speichern; zentrale `endGesture()`-Fkt, die von `onPointerUp` **und** `closeWindow`/`dispose` aufgerufen wird. Guard in `onPointerMove` per `this.windows.has(id)` oder `document.contains(win.element)`. `{ once:true }` für `pointerup`/`pointercancel`.

---

### SECTION [web/src/core/window_manager.ts:288-321] — MITTEL
**Problem:** `closeWindow` entfernt DOM und ruft nur `app.onClose()` auf. Ein App-Objekt, das in `mount` eigene `window`-/`document`-Listener, Timers oder Subscriptions angelegt hat, hat **keinen `unmount`/`dispose`-Hook** — bei fehlendem `onClose` wird nichts aufgeräumt → Listener/Timers-Leaks pro Fenster.
**Vorschlag:** Vertrag um `app.onUnmount?.()` / `app.dispose?.()` erweitern und nach `onClose` aufrufen; App-Authoren dokumentieren/Pflicht machen.

---

### SECTION [web/src/core/window_manager.ts:489-499] — MITTEL
**Problem:** `scrollToSpace` nutzt einen hartkodierten 400 ms-Guard `isProgrammaticScroll`. Mehrere schnelle Fokuswechsel überlagern die Timer (nicht abgebrochen); ein **echter Nutzer-Scroll innerhalb dieser 400 ms wird als Programm-Scroll verworfen** → `updateActiveSpaceOnScroll` springt übers Board, falsche aktive Space bleibt gesetzt.
**Vorschlag:** Vorherigen Timeout-Handle speichern und bei neuem Aufruf klären; besser: `scrollend`-Event (moderne Browser) oder Positions-Toleranz (Nur dann als User-Scroll werten, wenn `scrollLeft` sich > Schwelle vom Ziel bewegt).

---

### SECTION [web/src/core/window_manager.ts:573-592, 338-356] — NIEDRIG
**Problem:** Nach „Maximieren → an Kante Snappen“ ist `win.maximized=false` gesetzt, aber `restoreBounds` enthält weiterhin die **vorherige (maximierten) Geometrie**. Ein spätes Maximieren überschreibt `restoreBounds` mit der halbbreiten Snapped-Geometrie — die ursprüngliche Fenstergröße geht verloren, „Restore“ liefert Snapped-Zustand.
**Vorschlag:** Beim Snappen `restoreBounds` konsistent pflegen (vorherige echte Bounds behalten) oder einen expliziten `snapped`-State einführen, der bei Restore berücksichtigt wird.

---

### SECTION [web/src/components/ChatPanel.ts:105-120, 122-161] — HOCH
**Problem:** `handleFiles` liest Dateien **asynchron** (`FileReader.onload` pusht erst in `this.attachments`). Klickt der Nutzer „Senden“ (Zeile 114), bevor alle Reads fertig sind, geht `send()` mit **unvollständigen Anhängen** raus. Noch schlimmer: Ein `clearAttachments()` (vom Caller) zwischen Read-Start und Read-Fertig-Stellung leert das Array, aber die nachfolgenden `onload`-Kallbacks **pushen die Dateien wieder hinein und rendern sie** → „Geister-Anhänge“, die der User bereits entfernt hat.
**Vorschlag:** Senden erst ermöglichen, wenn alle Reads abgeschlossen sind (z. B. `Promise.all`/Counter), `send()` bei in-flight Reads blocken, oder bei `clearAttachments()` in-flight-Callbacks via Generation/Guard-Counter verwerfen, statt blind zu pushen.

---

### SECTION [web/src/components/ChatPanel.ts:105-115] — MITTEL
**Problem:** `send()` leert `this.inputEl.value` (Zeile 108) und **lässt `this.attachments` unverändert**, verlässt sich auf den Caller, `clearAttachments()` zu rufen. Wirft `this.onSubmit` (Zeile 114) synchron, rückt der Caller nie auf; der nächste Send-Versuch resubmitet **dieselben Anhänge** (Input ist aber leer) → Doppelexekution.
**Vorschlag:** Semantik „clear-after-success“ implementieren: erst `attach` an den Callback übergeben, danach (oder in `finally` bei Fehler klar kommuniziert) den Array-Zustand deterministisch setzen; oder ein Fehlerpfad, der Anhänge bewusst behält + UI-Hinweis gibt.

---

### SECTION [web/src/components/ChatPanel.ts:283-290] — MITTEL
**Problem:** `appendStreamDelta` triggert bei jedem Delta (debounced 50 ms) ein **komplettes `renderMarkdown(dataset.raw)`** — d. h. über die ganze Antwortlange. Für lange Streams ist das O(n²)-Parse-Cost → sichtbare Jankers/CPU-Spike (insbesondere in Kombination mit `scrollToBottom()` + `isNearBottom()`-Layout-Reads).
**Vorschlag:** Inkrementelles Parsing (z. B. nur den letzten Block neu rendern, oder `marked` mit `WalkTokens`/partiellem Parser), oder Render-Intervall skalieren (100-250 ms), oder `requestAnimationFrame` + `contain: layout` auf `.msg-content` setzen.

---

### SECTION [web/src/utils/markdown.ts:39] — NIEDRIG
**Problem:** `ALLOWED_ATTR` enthält `target` (für `<a target="_blank">` aus Markdown/Raw-HTML), aber **kein `rel="noopener"`**. Ohne `rel` kann ein externaler Tab auf `window.opener` zugreifen (Reverse-Tabnabbing). `DOMPurify` holt dies in neueren Versionen teilweise per Default nach — ist aber nicht explizit garantiert.
**Vorschlag:** `DEFAULT_SANITIZER`/`ALLOWED_ATTR` um keine `target`-Attribute ohne `rel` lassen, oder `FORBID_ATTR: ['target']` bzw. im Sanitizer `ADD_ATTR: ['rel']` sicherstellen, dass `rel="noopener noreferrer"` gesetzt wird.

---

### SECTION [web/src/components/ChatPanel.ts:203] — NIEDRIG
**Problem:** `appendUser` speichert den vollen (Base64) Dateiinhalt (bis 10 MB → ~13 MB String) in einer `<img src="...">`-Attribut- bzw. `data-`-basierten Darstellung im DOM. Bei mehreren großen Temp-Dateien in einer Session → **nennenswerter DOM-/Memory-Footprint**.
**Vorschlag:** Statt rohem Base64 im DOM einen `URL.createObjectURL(file)` verwenden (lebenslang) und bei `clear()`/Fenster-schließen `URL.revokeObjectURL` aufrufen.

---

### SECTION [web/src/components/OnboardingWizard.ts:152-172] — MITTEL
**Problem:** `restoreBackup` ist asynchron (`await manager.importZip(file)`), es gibt aber **keine In-Flight-Guard**. Ein schneller zweiter Klick auf „Restore“ öffnet erneut den File-Picker; zwei konkurrierende Imports schreiben gleichzeitig in die Config → Race-Condition/inkonsistenter Zustand.
**Vorschlag:** In-Flight-Flag (`this._restoring = true`, am Ende `= false`) setzen, Button/UI-Element zwischenzeitlich deaktivieren; oder `importZip`-Promise in eine Queue packen.

---

### SECTION [web/src/components/OnboardingWizard.ts:23, 162-172] — NIEDRIG
**Problem:** Der asynchrone `restoreBackup`-Continuation (inkl. `setTimeout(()=>location.reload(),600)`) hält nach erfolgreichem Import noch 600 ms die Welt an. Wird die Wizard-View in der Zeit entfernt, schreibt der Code auf einem **detached DOM-Element** und triggert dennoch `location.reload()` — unerwartetes Reload aus einer bereits „weg“ gewesenen View.
**Vorschlag:** `setTimeout`-ID speichern und per `clearTimeout()` räumen (z. B. in einem `dispose()`); `window.location.reload()` nur feuern, wenn `document.contains(this.element)` noch true.

---

### SECTION [web/src/components/OnboardingWizard.ts:222-235] — NIEDRIG
**Problem:** `saveLLM` verwendet `alert()` (Zeile 228) zur Validierung. In einem sandboxed/iframe- oder kiosk-Umfeld kann `alert` blockieren oder unterdrückt sein; die Validierung ist damit nicht robust und liefert kein lokalisierbares, UI-basiertes Feedback.
**Vorschlag:** Inline-Error-Element (z. B. das vorhandene `#cfg-test-result`-Pendant) setzen statt `alert()`.

---

## Zusammenfassung (3 Sätze)

Das kritischste Problem ist die **RenderPanel-Bridge**: die unescape-`</script>`-Injektion über `title` (KRITISCH) kombiniert mit der fehlenden Prüfung von `event.origin`/`event.source` macht die sandboxed-iframe-Bridge von jeder Quelle aus für **Arbitrary File Read/Write** angreifbar. Die übrigen Funde sind vor allem **Event-/Memory-Leaks** (fehlende `dispose()` in `WindowManager` und `RenderPanel`, hängende Drag/Resize-Document-Listener, keine App-Teardown-Kette) sowie eine **asynchrone Race-Condition in `ChatPanel.handleFiles`**, die Anhänge doppelt sendet oder nach dem Löschen wieder auferstehen lässt. Priorität für die Fix-Liste: (1) RenderPanel-Bridge härten + `title`-Escape, (2) `dispose()`/Listener-Cleanup in `WindowManager` & `RenderPanel` ergänzen, (3) `ChatPanel`-Anhänge auf eine synchrone/gesicherte Queue umstellen.
