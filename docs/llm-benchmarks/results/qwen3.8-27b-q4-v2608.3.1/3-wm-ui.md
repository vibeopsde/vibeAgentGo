[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/window_manager.ts
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m→ [0mRead web/src/components/OnboardingWizard.ts
[0m→ [0mRead web/src/utils/markdown.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m✱ [0mGrep "onClose\??\s*:"[90m in web/src · 0 matches[0m
# Review — Task 3/4: Window Manager + UI

## web/src/core/window_manager.ts

### FUND 1 — [window_manager.ts:638-664] — HOCH
**Fenster-Resize synchronisiert `win.width/height/x/y` nie.** `startResize` ändert nur `win.element.style.*` (Zeile 652-653) und schreibt den Model-State `win.width/height` nicht zurück. Konsequenz: `maximizeWindow` (Zeile 346) speichert `restoreBounds` aus dem veralteten State — ein nach dem manuellen Resizing gemaximiertes Fenster wird beim Restore auf die **alte** Größe zurückgesetzt.
**Vorschlag:** In `onPointerUp` von `startResize` nach dem Entfernen der Listener `win.width = win.element.offsetWidth; win.height = win.element.offsetHeight;` schreiben (analog zu `snapWindow`, Zeile 589-592).

### FUND 2 — [window_manager.ts:544-551, 655-660] — HOCH
**Pointer-Listener-Leak bei Drag/Resize.** `(ev.target).releasePointerCapture(e.pointerId)` kann werfen, wenn das Ziel-DOM-Knoten-Element zwischen `pointerdown` und `pointerup` aus dem Dokument entfernt wurde (Fenster wurde z. B. während des Drags über `closeWindow`/Andere-Instanz geschlossen). Die Exception bricht den Handler ab, **bevor** `document.removeEventListener(...)` (Zeile 546-548) ausgeführt wird → `pointermove`/`pointerup`-Listener bleiben permanent an `document` hängen (Memory-Leak + tote Drags, die weiter Snap-Vorschau schreiben, da `win` per closure referenziert bleibt).
**Vorschlag:** Listener-Erneuerung in `try/finally` packen; `releasePointerCapture` in `try/catch` oder vorher per `element.isConnected` prüfen. Zusätzlich: in `onPointerMove`/`onPointerUp` `if (!win || !win.element.isConnected) return;` prüfen, damit ein geschlossenes Fenster kein Zombie-Drag mehr auslöst.

### FUND 3 — [window_manager.ts:289-323] — HOCH
**Race Condition / fehleranfälliger Teardown in `closeWindow`.** Drei Probleme:
1. `app.onClose()` (Zeile 295) wird synchron geadelt, liefert aber in der Praxis oft ein `Promise`: `result === false` ist bei asynchronem Veto **nie `true`**, das Fenster wird dennoch geschlossen, während die App noch aufräumt → Race mit `app?.unmount?.()` (Zeile 301).
2. `app.unmount()` wird **nach** `win.element.remove()` (Zeile 300) aufgerufen — Framework-Cleanup, das von im DOM befindlichen Elementen ausgeht, sieht ein bereits entferntes DOM.
3. Wirft `onClose()` bzw. `unmount()` eine Exception, erreicht die Map-Bereinigung (Zeile 302-304) nie → Fenster bleibt in `windows`/`instances`/`windowData` hängen (Dock-Icon bleibt, `launchOrFocus` findet es, aber das Element fehlt), d. h. **feste Memory-Leak**.
**Vorschlag:** Reihenfolge `onClose → unmount → element.remove()`; alles in `try/finally`, `finally` räumt Maps und emits `window_closed` auf; asynchrone `onClose` per `await` unterstützen (Methode asynchron machen) oder explizit synchrone API vorschreiben und dokumentieren.

### FUND 4 — [window_manager.ts:73-87] — HOCH
**Fenster wechseln nie die Schicht bei Mobile↔Desktop-Switch.** `updateModeClass` (Resize-Listener Zeile 67) toggled nur die Sichtbarkeit von `.wm-desktop`/`.wm-spaces`. Ein in Mobile-Modus geöffnetes Fenster lebt in `.wm-space` ohne `wm-window-bar`-Drag-Handler, ohne `resize`-Handle, ohne `dblclick`-Maximize — nach dem Wechsel auf Desktop ist es ein verwaistes, unfähiges Element. Umgekehrt: Desktop-Fenster, die nach dem Switch zu Mobile versteckt werden, haben keine `wm-space-bar` und sind dort nicht erreichbar (kein schließendes Element).
**Vorschlag:** Beim Moduswechsel vorhandene Fenster migrieren (bzw. neu bauen): bei Mobile→Desktop `wm-window`-Chrome um `contentEl` herum nachbauen incl. Listenerneubindung, bei Desktop→Mobile die `wm-space`-Struktur um `contentEl` erstellen. `contentEl` in beiden Fällen beibehalten, die App-Instanz ist ja die gleiche.

### FUND 5 — [window_manager.ts:491-501] — MITTEL
**Race bei der Programm-Scroll-Guard `isProgrammaticScroll`.** `scrollToSpace` setzt `isProgrammaticScroll = true`, die 400ms-Timeout wird aber nie zurückgesetzt, wenn ein zweiter programmatischer Scroll folgt. Der **allererste** Timeout feuert dann zu früh (oder zu spät) und beendet die Guard — mittendrin in einer noch laufenden `scrollIntoView({behavior:'smooth'})` kann das User-Scroll-Event (Zeile 60-65) durchrutschen → `updateActiveSpaceOnScroll` (Zeile 503) ruft `focusWindow` gegen den laufende Scroll an → Fokus-Fight / Sprung zurück.
**Vorschlag:** Timeout-ID in `this.scrollGuardTimer` speichern, bei jedem `scrollToSpace` vorher `clearTimeout`, Guard erst mit dem letzten Timeout aufheben. Oder auf das `scrollend`-EventListener (mit Fallback-Timeout) umstellen.

### FUND 6 — [window_manager.ts:325-330] — MITTEL
**`minimizeWindow` verlässt Fokus/Dock-Stale.** Es wird nur das `minimized`-Class/Flag gesetzt — `activeWindowId` zeigt weiterhin auf das minimierte Fenster, die `.dock` wird nicht aktualisiert (`updateDock`, Zeile 437, markiert Zeile 454 auf Basis von `activeWindowId`), und `window_focused` wird für das *nächste* Fenster gefeuert. Visuell: Dock zeigt das falsche Fenster als aktiv, `onBlur` für das minimierte Fenster wird nie gerufen.
**Vorschlag:** Nach dem Minimieren die nächste offene Fenster fokussieren (analog `closeWindow` Zeile 306-318), `onBlur` aufrufen und `updateDock()` triggern; oder das Minimieren bewusst als Zustand definieren und `updateDock` entsprechend anpassen (aktive Markierung auf Dock-Icon statt Fenster halten).

### FUND 7 — [window_manager.ts:60-71] — MITTEL
**Kein `dispose()`; permanente Document-/Window-Listener.** `window.addEventListener('resize', …)` (Zeile 67) und der `scroll`-Listener auf `this.spaces` (Zeile 60) werden nie entfernt; ein zweiter `WindowManager` (HMR im Dev-Full-Reload, Multiinstanzen-Tests) erzeugt zusätzliche Listener, die auf die erste Instanz zeigen. Vergleich: `RenderPanel.dispose()` existiert bereits und ist das Muster, das hier fehlt.
**Vorschlag:** `dispose()` hinzufügen, der `resize`- und `scroll`-Listener sowie `scrollTimer`/`scrollToSpace`-Timeouts aufräumt und alle offenen Fenster via `closeWindow` schließt.

### FUND 8 — [window_manager.ts:253, 391] — NIEDRIG
**`zCounter` wächst unbegrenzt.** Jede Fokussierung (Zeile 391) erhöht ihn; bei langen Sessions oder vielen Fokuswechseln (Scroll-Events auf Mobile feuern `focusWindow` per Debounce) wird die Zahl beliebig groß. Praktisch harmlos, aber `String(++this.zCounter)` wird immer größer; CSS/Performance-Effekte bei extremen Größen sind möglich.
**Vorschlag:** Beim Fokussieren auf `Math.max(...values)+1` normalisieren, oder gelegentlich (z. B. nach `closeWindow`) auf die aktuelle max-Z-Ordung re-baseline.

### FUND 9 — [window_manager.ts:111-139] — NIEDRIG
**App-Faktorie wird zweimal aufgerufen.** `registerApp` (Zeile 112) erzeug für die Metadaten ein Objekt `factory()` und verweist es weg; `openWindow` (Zeile 139) erzeugt pro Fenster erneut. Wenn die Faktorie Seiteneffekte hat (State-Initialisierung, Netzwerk-Konfiguration, Logging), läuft sie zweimal und die Metadaten-Instanz ist isoliert.
**Vorschlag:** Metadaten statisch aus der App-Definition beziehen (z. B. `factory.metadata`, oder eine `getAppMetadata(appId)` getrennt von `createInstance(appId)`), damit keine Instanz weggeworfen wird.

### FUND 10 — [window_manager.ts:418-423] — NIEDRIG
**Fenster-Titel-Update funktioniert nur auf Desktop.** `updateWindowData` (Zeile 421) sucht `.wm-window-title`, das auf Mobile-`Space`s nicht existiert (dort `.wm-space-title`, Zeile 158-160). `win.title` im State wird aktualisiert, aber die sichtbare Beschriftung in Mobile bleibt veraltet, bis `updateDock` den Dock-Label aktualisiert — Inkonsistenz zwischen Dock und Titelbar.
**Vorschlag:** In beiden Varianten der Titelmulden-Suchkette (`.wm-window-title, .wm-space-title`) suchen, oder eine `setTitle()`-Methode auf dem Fenster, die das je nach Container-Element anwendet.

---

## web/src/components/ChatPanel.ts

### FUND 11 — [ChatPanel.ts:41-47, 53-59, 105-115] — HOCH
**Send-Tastatur-Pfad bypass das Läufer-Guard.** `send()` (Zeile 105) wird sowohl vom Button-Klick (Zeile 53-59, hier wird `isStopped` geprüft) als auch vom `keydown`-Handler (Zeile 41-46, **ohne** `isStopped`-Prüfung) gerufen. Während eines Läufer/Streams kann der Nutzer also mit `Shift+Enter` weiterhin senden, während der Button korrekt in einen Stop-Button wechselt. Inkonsistente Zustand — und wenn der Aufrufer `send` während eines Läufer-Runs annimmt (was der Button blockiert), entsteht ein dritter Lauf neben dem laufenden.
**Vorschlag:** In `send()` selbst am Anfang `if (this.isStopped) return;` stellen, damit beide Einträge (Button + Tastatur) denselben Guard teilen. Der Button-Klick kann dann direkt `send()` aufrufen und die `Stop`-Ableitung zentralisieren.

### FUND 12 — [ChatPanel.ts:122-161, 117-120] — MITTEL
**Async FileReader-Race: Geister-Attachments.** `handleFiles` liest Dateien asynchron (Zeile 137-153). Wenn der Nutzer die Dateien anklickt und im kurzen Zeitfenster **vor** dem `reader.onload` den Senden drückt, ruft der Caller `clearAttachments()` (Zeile 117) auf — dann feuert `reader.onload` noch und pushet das Attachment **nach** der Clear (Zeile 148). Ergebnis: Attachment bleibt in `this.attachments` stehen, wird nie gesendet (weil `send` schon gerufen wurde), aber zeigt in der UI an.
**Vorschlag:** `reader.onload`/`onerror` gegen die aktuelle `this.attachmentsEl`-Referenz oder gegen ein `generation/sequence`-Token prüfen, das bei `clearAttachments()` erhöht wird; oder `send()` auf `this.attachments.length === 0 || (alle `loaded`)` warten, und bei hängenden Readern auf `isStopped`-Status prüfen.

### FUND 13 — [ChatPanel.ts:190-193, 260-292] — MITTEL
**`clear()` cancelled den hängenden `streamRenderTimer` nicht.** `clear()` (Zeile 190) setzt `streamEl` auf `null`, aber der 50ms-Debouncer (Zeile 283-290) ist noch im Pool. Wenn `startStream()` (Zeile 260) dazwischen aufgerufen wird, gibt es zwei Stream-Elemente, und der alte Timer, wenn er gegen `this.streamEl` (neues Element) schreibt, rendert den **neuen** `dataset.raw` in den neuen `.msg-content` — das Verhalten ist zufällig (je nach Timing). Zusätzlich: `appendStreamDelta` auf einem Stream, der schon per `clear()` gelöscht wurde, startet per Zeile 275-276 einen neuen Stream ohne vorherige Finalisierung → alte `data-streaming='true'`-Elemente bleiben im DOM.
**Vorschlag:** In `clear()` den Timer explizit clären: `if (this.streamRenderTimer) { clearTimeout(this.streamRenderTimer); this.streamRenderTimer = null; }` vor dem Setzen `streamEl = null`.

### FUND 14 — [ChatPanel.ts:220-224, 254-258] — MITTEL
**XSS-Fläche im `data-raw`-Attribut.** `appendSystem` (Zeile 220) und `appendAssistant` (Zeile 254) setzen `data-raw="${escapeHtml(text)}"`. `escapeHtml` (Utils/Escape:6-12) escaped `&`, `<`, `>`, `"`, `'` — das schützt das Attribut. **Aber**: `renderMarkdown` (utils/markdown:6-40) erlaubt `ALLOWED_ATTR: ['href','title','target','class']` inkl. `target`, und setzt **kein** `rel="noopener noreferrer"`. Ein Markdown-Link mit `target="_blank"` aus einer Assistant/Tool-Nachricht erzeugt einen Tab-Nabbing-Vektor (das neue Fenster kann `window.opener.location` setzen).
**Vorschlag:** `DOMPurify`-Hook `afterSanitizeAttributes` in `renderMarkdown` setzen, der `target="_blank"`-Links automatisch `rel="noopener noreferrer"` hinzuaddiert; oder `target` aus `ALLOWED_ATTR` streichen.

### FUND 15 — [ChatPanel.ts:36], 303-306] — NIEDRIG
**`finalizeStream` kann auf `null` casten.** Die Zeile 304-305: `const ce = this.streamEl.querySelector('.msg-content') as HTMLElement; ce.innerHTML = …` — wenn `.msg-content` nicht mehr existiert (z. B. ein App-Rebuild, oder wenn ein Tool-Call das Stream-Element ersetzt), ist `ce === null` und `.innerHTML` wirft eine `TypeError`. Da das in einem `setTimeout`-Callback (Zeile 284) bzw. in `finalizeStream` läuft, ist es unvermeidlich.
**Vorschlag:** `const ce = this.streamEl?.querySelector('.msg-content') as HTMLElement | null; if (ce) { ce.innerHTML = …; }`.

### FUND 16 — [ChatPanel.ts:41-47, 273-292] — NIEDRIG
**Semantik `Enter` vs. `Shift+Enter` ist invertiert.** Standard-Chat-UX (und die meisten LLM-Tools) verwenden `Enter` = Senden, `Shift+Enter` = Zeilenumbruch. Hier ist es umgekehrt: `Enter+Shift` sendet (Zeile 42-44), reines `Enter` fügt eine Zeile ein (Zeile 46-47). Das ist im Code beabsichtigt, kollidiert aber mit der Nutzererwartung und macht die `isStopped`-Bypass (Fund 11) schwerer nachvollziehbar.
**Vorschlag:** Semantik invertieren: `if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }` und die Kommentierungen anpassen.

---

## web/src/components/RenderPanel.ts

### FUND 17 — [RenderPanel.ts:113-133, 144-165] — KRITISCH
**Brücke erlaubt ungefilterte `readFile`/`writeFile` durch untrusted HTML.** Die IFrame-Content ist **LLM-generiert** (bzw. von beliebigen Quellen), wird aber mit voller Brücken-API (`readFile`, `writeFile`, `getMemory`, `sendMessage`) geladen (Zeile 201-208 in `bridgeProxyScript`). `isAllowedBridgeRequest` (Zeile 113-133) validiert nur das Typpattern der Anfrage, **nicht** den Pfad oder die Aktion. Ein LLM-Prompt-Answer, das ein `<script>` enthält, das `vibeAgentGo.writeFile('/root/.ssh/authorized_keys', …)` aufruft, wird verarbeitet. Das IFrame-Sandbox (`allow-scripts`, keine `allow-same-origin`) schützt nur gegen DOM-Access, nicht gegen Brücken-Nutzung.
**Vorschlag:** `isAllowedBridgeRequest` um eine **Pfad-Allow-Liste** ergänzen (z. B. nur `/tmp/vibeAgentGo/`), `writeFile` auf read-only für `getMemory`/`getConfig` beschränken, und eine **Benutzerbestätigungs-UI** für `writeFile`/`sendMessage` (ähnlich wie bei `run_app`). Alternativ: Brücke nur für `getMemory`/`listFiles`/`getConfig` öffnen, `readFile`/`writeFile`/`sendMessage` an eine explizite, beständige API binden.

### FUND 18 — [RenderPanel.ts:135-143, 144-165] — MITTEL
**Asynchrone `handleBridgeRequest` kann nach `dispose()` posten.** `handleBridgeRequest` ist `async` (Zeile 144), `this.onBridgeRequest(request)` (Zeile 153) kann hängen (z. B. langsamer Dateizugriff). Wenn `dispose()` (Zeile 135-142) zwischendurch gerufen wird, wird `this.iframe.remove()` ausgeführt, aber die hängende Promise feuert doch noch `source.postMessage(...)` (Zeile 154) gegen `event.source`, das nun verwaist ist → `postMessage` auf ein entfernendes `WindowProxy` wirft eine Exception (uncaught, in der Asynchronen-Function).
**Vorschlag:** `let disposed = false;` als Flag in `dispose()` setzen, und in `handleBridgeRequest` nach dem `await` prüfen: `if (disposed || !this.iframe.isConnected) return;`. Alternativ: `AbortController` verwenden, der bei `dispose()` abortet.

### FUND 19 — [RenderPanel.ts:318-337] — MITTEL
**Tab-Wechsel rendert das IFrame komplett neu.** `renderActiveView` (Zeile 318) setzt bei **jedem** `render()`-Aufruf `this.iframe.srcdoc = …` (Zeile 336). Das bedeutet:
1. **Zustandsverlust:** Jede Ansicht im IFrame (Formulare, JS-State, Scroll-Position) wird beim Tab-Wechsel komplett neu geladen.
2. **Ressourcen:** Das alte Dokument wird geladen, das neue auch — im Übergang zwei Dokumente gleichzeitig.
3. **Brücken-Race:** Wenn das alte IFrame eine hängende Brücken-Anfrage hat, und `srcdoc` neu gesetzt wird, ist die `pending`-Map im alten Dokument isoliert; die Antwort kommt an, aber das Dokument ist schon fort → `pendingReq.resolve/reject` wird nie gerufen, der `setTimeout` (Zeile 193-197 im Brückenscript) läuft noch 30s und hält den IFrame im Hintergrund.
**Vorschlag:** Wenn sich die `activeTitle` ändert, aber der `view.title` gleich ist, `srcdoc` **nicht** neu setzen. Oder: mehrere IFrame pro Tab halten (eines pro `view.title`) und per `display:inline/none` wechseln, statt neu zu laden.

### FUND 20 — [RenderPanel.ts:190], 201-208] — NIEDRIG
**Brücken-`pending`-Map im IFrame wird bei Reload isoliert.** `bridgeProxyScript` (Zeile 170-211) hält eine `pending` Map und `setTimeout`-Timeouts pro Anfrage. Wenn `srcdoc` neu gesetzt wird (Fund 19), werden diese Timeouts noch 30s länger halten, während das Dokument eigentlich tot ist.
**Vorschlag:** Mit `window.addEventListener('pagehide', () => pending.clear())` die Map sauber räumen, oder die Timeout-Dauer auf etwas kürzeres (z. B. 10s) senken, und in `dispose()` die IFrame-Content explizit auf `about:blank` setzen.

---

## web/src/components/OnboardingWizard.ts

### FUND 21 — [OnboardingWizard.ts:222-235] — NIEDRIG
**`saveLLM()` fallback auf `this.llmResult` kann veraltet sein.** Zeile 223: `const cfg = readLLMConfigFrom(this.element) ?? this.llmResult;`. `readLLMConfigFrom` liest aus dem aktuellen DOM; falls es `null` zurückgibt (z. B. weil das DOM neu gerendert wurde, oder die Felder fehlen), wird `this.llmResult` als Fallback genommen — das ist ein **Schnipsel vom vorherigen** Render-Durchlauf. Wenn der Nutzer die Einstellungen zwischenzeitlich geändert hat, wird der alte Wert still gespeichert.
**Vorschlag:** Fallback entfernen, stattdessen `if (!cfg) return;` (oder `alert`), um zu garantieren, dass der aktuelle Zustand verwendet wird. `this.llmResult` sollte explizit bei `saveLLM()` aus dem DOM gelesen werden.

### FUND 22 — [OnboardingWizard.ts:152-172] — NIEDRIG
**`restoreBackup()` hat kein Timeout und kein Error-Handling um `importZip`.** Zeile 163-171: `await manager.importZip(file)` kann sehr lange dauern (große Zip, I/O), es gibt keinen Timeout und keinen Abbruch. Der `setTimeout(() => window.location.reload(), 600)` (Zeile 167) wird nicht gespeichert und kann nach einem Fenster-Schließen noch feuern.
**Vorschlag:** `importZip` in einer `Promise.race` mit einem `setTimeout` (z. B. 60s) verpacken, und den Reload-Timeout-ID in ein Feld `this._reloadTimer` speichern, das bei `onComplete()` oder einem potenziellen `dispose()` geclärt wird.

---

## Zusammenfassung

Die kritischste Lücke ist die **ungefilterte Brücken-API** in `RenderPanel` (Fund 17), wo LLM-generiertes HTML über `vibeAgentGo.writeFile`/`readFile` ohne Pfad-Validierung oder Benutzerbestätigung das Dateisystem lesen und schreiben kann — das ist eine direkte Sandbox-Escape. In `window_manager.ts` gibt es ein **Cluster aus Hover-Listener-Leaks und Race Conditions** (Funde 2, 3, 5), die bei schnellen Interaktionen (Schliessen während eines Drags, asynchrone `onClose`) zu fest verwaisten DOM-Knoten und Document-Listener führen. `ChatPanel` ist am robustesten, aber die **Tastatur-Bypass des Send-Guards** (Fund 11) und das **async FileReader-Race** (Fund 12) sollten priorisiert gefixt werden, da sie beide zu unbeabsichtigten Zustandsänderungen führen.
