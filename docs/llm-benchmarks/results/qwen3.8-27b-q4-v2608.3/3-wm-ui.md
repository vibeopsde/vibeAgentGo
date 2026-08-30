[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/window_manager.ts
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m→ [0mRead web/src/components/OnboardingWizard.ts
Let me check the markdown and escape utilities to properly assess the XSS risk.
[0m✱ [0mGlob "web/src/utils/*.ts"[90m 4 matches[0m
[0m→ [0mRead web/src/utils/markdown.ts
[0m→ [0mRead web/src/utils/escape.ts
Let me verify one potential null-deref in OnboardingWizard against the actual LLM section component.
[0m✱ [0mGrep "cfg-model"[90m in web/src · 9 matches[0m
# Code-Review — Window Manager + UI

## `web/src/core/window_manager.ts`

### 1. [window_manager.ts:157-159, 187-194, 485] — XSS (innerHTML mit unescaped `${title}`/`${icon}`)
**Schweregrad: KRITISCH**
`bar.innerHTML`, `element.innerHTML` (Desktop/Titlebar) und `createDockIcon()` injizieren `title` und `icon` **unescaped** in HTML. Der Wert für `title` ist dynamisch: Er wird bei `openWindow` aus `opts.title`/`app.title` gelesen und kann über `updateWindowData(id, { title })` (Zeile 403-422) zur Laufzeit durch App-/LLM-Daten gesetzt werden — und bei jedem `updateDock()`-Aufruf (`focusWindow`, `closeWindow`, `openWindow`) erneut über `createDockIcon` in den Dock gezeichnet. Ein LLM-generierter Titel wie `<img src=x onerror=...>` führt zu Codeausführung in der **Haupt-App** (un-sandboxed) — volle Kontrolle über Config, Bridge und API-Keys.
**Vorschlag:** `title`/`icon` zwingend mit `escapeHtml(...)` (oder `textContent`-Aufbau) rendern; idealerweise nie `innerHTML` für benutzeraus-/modellgesteuerte Werte verwenden. `createDockIcon` komplett auf `document.createElement` + `textContent` umstellen.

### 2. [window_manager.ts:637-663] — Resize aktualisiert `win.width`/`win.height`-Modell nicht
**Schweregrad: MITTEL (funktioneller Bug)**
`startResize` schreibt nur `win.element.style.width/height` (651-652), aber nie `win.width`/`win.height`. Die Modellwerte bleiben auf dem Vor-Resize-Size stale. Folge: `maximizeWindow` speichert `restoreBounds` aus den stale Werten (345) → bei `restoreWindow`/`reflowMaximizedWindows` wird die **falsche Größe** wiederhergestellt.
**Vorschlag:** Am Ende von `onPointerUp` die finale `offsetWidth/offsetHeight` in `win.width`/`win.height` schreiben (analog zu `snapWindow`, 588-591).

### 3. [window_manager.ts:524-533] — Drag ohne `preventDefault` (Text-Selektion)
**Schweregrad: MITTEL (Touch/Drag-Handling)**
`startDrag` ruft — im Gegensatz zu `startResize` (641) — **keine** `e.preventDefault()` auf. Bei Maus-Drag über die (auswählbare) Titelzeile startet der Browser eine Textauswahl, was den Drag visuell/inkonsistent macht.
**Vorschlag:** `startDrag` wie `startResize` mit `e.preventDefault()` beginnen und/oder `.wm-window-bar { user-select: none }` setzen.

### 4. [window_manager.ts:377-401, 502-522] — Fokus-Race: `focusWindow` feuert redundanzlos & `zCounter` wächst
**Schweregrad: MITTEL (Fokus-Race)**
`focusWindow` erhöht **jeden** Aufruf `zCounter` (390) und ruft `app.onFocus()` (393), auch wenn das Fenster bereits aktiv ist. `updateActiveSpaceOnScroll` (502) und `scrollToSpace` (490) triggern über das Debounce (63) + Timer-Logik bei jeder Scroll-Erhöhung `focusWindow(id)`, selbst bei unveränderter aktiver Fläche. Ergebnis: `onFocus`-Stürme auf die App-Instanz, unendliches `zCounter`-Wachsen und auf Mobile wiederholte `scrollToSpace`-Aufrufe (398), die den Scroll-Kampf verschärfen.
**Vorschlag:** In `focusWindow` früh aussteigen, wenn `this.activeWindowId === id` und die Fläche bereits `focused` ist (z-/onFocus nicht erneut triggern). `updateActiveSpaceOnScroll` nur aufrufen, wenn sich die nächstgelegene Fläche tatsächlich geändert hat.

### 5. [window_manager.ts:59-64, 490-500] — `isProgrammaticScroll`-Guard (400 ms) unterdrückt echte User-Scrolls
**Schwegrad: MITTEL (Touch-Handling)**
Der Guard ist zeitbasiert (400 ms, 497-499): Innerhalb dieses Fensters verwirft der `scroll`-Listener (61) **alle** genuine User-Swipes, weil `isProgrammaticScroll === true`. Der Nutzer kann also kurz nach jedem Program-Scroll nicht mehr selbst swipen. Umgekehrt: Wenn der `smooth`-Scroll langsamer dauert, läuft der Guard ab, bevor der Scroll endet → `updateActiveSpaceOnScroll` greift auf einen Zwischenzustand.
**Vorschlag:** Guard nicht per Timeout, sondern per `scrollend`-Event (oder Vergleich `scrollLeft` mit Ziel und `isProgrammaticScroll` zurücksetzen, wenn das Ziel erreicht ist) setzen; User-Interaktionen (z.B. via `pointerdown`/`touchstart` auf `.wm-spaces`) den Guard sofort resetten.

### 6. [window_manager.ts:288-300] — `closeWindow`: `app.onClose()` ohne try/catch
**Scheregrad: NIEDRIG (Robustheit)**
Wird `app.onClose()` (293-295) werfen, bricht `closeWindow` mit unbehobener Exception ab, **bevor** `win.element.remove()`, `delete` der Maps und `emit('window_closed')` laufen. Inkonsistenter Zustand + verwaiste DOM-Knoten.
**Vorschlag:** `onClose()` in try/catch einfassen; Fehler loggen und dennoch weiter mit dem Teardown fahren (außer, die App signalisiert explizit `false`).

### 7. [window_manager.ts:59, 66] — Konstruktor-Listener ohne `dispose()`
**Schweregrad: NIEDRIG (Listener-Leak)**
`window.addEventListener('resize')` und `this.spaces.addEventListener('scroll')` werden nie entfernt; es existiert keine `dispose()`-Methode. Solange der WindowManager app-lebenszyklus-weit existiert, unkritisch — aber ein vollständiges App-Tearing-down lässt diese hängen.
**Vorschlag:** `dispose()` hinzufügen, der beide Listener entfernt (und `scrollTimer`/`setTimeout`-Handles klärt).

---

## `web/src/components/RenderPanel.ts`

### 8. [RenderPanel.ts:113-133, 144-165] — Bridge: unbeschränkte `readFile`/`writeFile`-Pfade an ungetrusted-Html
**Schwegrad: HOCH (Security, Defense-in-Depth)**
`isAllowedBridgeRequest` akzeptiert für `readFile`/`writeFile`/`listFiles` **beliegige String-Pfade** ohne Allowlist/Sandbox-Check. Die `vibeAgentGo`-Bridge (167-212) wird in jede `render`-Instanz (LLM-generierte View) injiziert. Jedes XSS/JS in einer View — oder ein kompromittiertes Host-`onBridgeRequest` — bekommt damit einen vollständigen, unbeschränkten Dateilese-/Schreibkanal auf dem Host. Der eigentliche Schutz liegt implizit im (nicht sichtbaren) `onBridgeRequest`-Handler; die `RenderPanel` selbst bietet **keine** Padschutz.
**Vorschlag:** In `isAllowedBridgeRequest` einen expliziten, projektweiten Pfad-Prefix-/Allowlist-Check erzwingen (z.B. nur `workspace/`), `listFiles` auf denselben Bereich beschränken, und die `BridgeHandler`-Signatur um einen `requestSource`-Parameter erweitern, damit der Handler den Ursprungs-iframe prüfen kann. Zusätzlich `postMessage` mit dem konkreten `source.origin` statt `'*'` antworten (148, 154, 162).

### 9. [RenderPanel.ts:318-337, 81-111] — Tab-Wechsel resettet `srcdoc` → in-flight Bridge-Requests gehen verloren
**Schwegrad: MITTEL (Race/Funktionalität)**
`renderActiveView` setzt bei jedem Tab-Wechsel `this.iframe.srcdoc` neu (336), was den kompletten iframe-Kontext neu lädt. `handleBridgeRequest` ist **asynchron** (144-164); während ein Request im Flight ist, wechselt der Nutzer den Tab → `source.postMessage(...)` auf einen bereits zerstörten `contentWindow` → no-op oder unhandled rejection; die `pending`-Map in der alten Seite hält das Promise bis Timeout.
**Vorschlag:** iframe-Instanz pro `ViewTab`-Titel persistent halten (Cache) und nicht bei jedem `renderActiveView` neu laden; `postMessage`-Ziel auf `event.data.source` bzw. einen stabilen Proxy verweisen; in der bridge-proxy-Timeout-Erfassung (30 s, 197) bereits gelöschte `pending`-Einträge sauber auflösen.

### 10. [RenderPanel.ts:81-111, 135-142] — `window`-`message`-Listener ohne garantierte `dispose()`
**Schwegrad: MITTEL (Listener-Leak)**
Jede `RenderPanel`-Instanz registriert permanent einen globalen `window`-`message`-Listener (110). `dispose()` (135-142) entfernt ihn zwar korrekt, wird aber ausschließlich aufgerufen, wenn der Host es tatsächlich tut — ein vergessener `dispose` (z. B. wenn das `window_manager.closeWindow` die App instanz nicht sauber aufräumt) führt zu dauerhaft hängenden globalen Listeners pro geöffneter View.
**Vorschlag:** `messageHandler` auf `event.source === this.iframe.contentWindow` einschränken und zusätzlich einen `WeakRef`/`id`-basierten Match nutzen; dokumentieren, dass `dispose()` vor `element.remove()` (z.B. bei Window-Schließen) aufgerufen werden muss — besser: `dispose()` idempotent + automatisch bei `beforeunload` triggern.

### 11. [RenderPanel.ts:304-311] — Tab-Close schließt **alle** Tabs mit identischem Titel
**Schwegrad: NIEDRIG (Funktionalität)**
`this.views.filter((v) => v.title !== view.title)` entfernt Duplikate. Zwei Views mit gleichem Titel lassen sich nicht individuell schließen; nur eine bleibt übrig.
**Vorschlag:** `ViewTab` um ein eindeutiges `id`-Feld ergänzen und die Close-Logik darauf basieren; `activeTitle` durch `activeId` ersetzen.

---

## `web/src/components/ChatPanel.ts`

### 12. [ChatPanel.ts:41-47] — Enter/Shift+Enter semantik invertiert
**Schwegrad: MITTEL (UX/Funktional)**
`e.key === 'Enter' && e.shiftKey → send()` in `keydown` (42-43). Konvention (und nahezu jede andere Chat-UI) ist: **Enter** sendet, **Shift+Enter** macht Zeilenumbruch. Die Implementierung ist gespiegelt. Entweder war das gewollt, dann: im Code explizit dokumentieren + `title`-Hint auf den Button setzen; unwahrscheinlicher Fall: Bug.
**Vorschlag:** Invertieren: `Enter` (ohne Shift) → `this.send()`; `Shift+Enter` → `e.preventDefault()` **nicht** aufrufen (Textarea-default). Falls gewollt, `title="Enter: Newline, Shift+Enter: Send"` am `sendBtn` setzen.

### 13. [ChatPanel.ts:105-115, 53-59] — Kein Doppel-Send-Guard, `attachments`-Klarstellung ist Kontrakt-brüchig
**Schwegrad: NIEDRIG (Race)**
Schneller Doppelklick auf `send`/Enter feuert `onSubmit` zweimal mit denselben `attachments`. Die `isStopped`-Flag (55) schützt nur vor `onStop`. `send()` selbst setzt keinen `sending=true`-Guard zurück.
**Vorschlag:** `send()` mit `if (this._sending) return; this._sending = true; try { ... } finally { this._sending = false; }` umhüllen; alternativ `onSubmit` als Promise erwartende API mit `.then(() => this.clearAttachments())` im Caller.

### 14. [ChatPanel.ts:190-193, 283-291] — `clear()` verwirft ausstehenden `streamRenderTimer` nicht
**Schwegrad: NIEDRIG (Hygiene)**
`clear()` setzt `streamEl = null` (192) und `messagesEl.innerHTML = ''` (191), lässt aber den eventuell schwebenden 50-ms-Debounced-Timeout (284) laufen. Der Callback prüft zwar `if (this.streamEl)` (285), aber das ist nur Zufall — eine spätere `appendStreamDelta` zwischen zwei `clear()`-Aufrufen würde einen überstürmten Re-Render auf die neue `streamEl` ausführen.
**Vorschlag:** `clear()` beginnt mit `if (this.streamRenderTimer) { clearTimeout(this.streamRenderTimer); this.streamRenderTimer = null; }` (genauso wie `finalizeStream`, 300-302).

### 15. [utils/markdown.ts:39] — `target="_blank"` ohne `rel="noopener"` erlaubt (Reverse-Tabnabbing)
**Schwegrad: NIEDRIG (Security)**
`ALLOWED_ATTR` inkludiert `target` und `href`; DOMPurify entfernt `javascript:`-URIs, erlaubt aber `<a target="_blank" href=...>` ohne `rel="noopener nofollow"`. Eine LLM-generierte Antwort kann damit `window.opener`-Zugriff auf die Haupt-App über ein neues Tab erzwingen.
**Vorschlag:** `ALLOWED_ATTR: ['href','title','target','class']` beibehalten und post-sanitize via DOMPurify-Hook jedem `<a target="_blank">` ein `rel="noopener nofollow"` hinzufügen; Alternativ `target` aus `ALLOWED_ATTR` entfernen (sauberer).

---

## `web/src/components/OnboardingWizard.ts`

### 16. [OnboardingWizard.ts:198-199, 202, 211-212, 214, 262] — `as HTMLXxx`-Casts ohne Nullprüfung
**Schwegrad: NIEDRIG (Robustheit)**
`modelSelect`/`modelManual` werden via `querySelector(...)` + `as HTMLSelectElement` geholt und direkt verwendet (`.value`, `.addEventListener`). `SettingsLLMSection.ts:53,56` rendert beide IDs zwar, aber die `as`-Casts sind fragil — bei jeder Umstrukturierung von `renderLLMConfigSection` wird daraus eine Nullref.
**Vorschlag:** `as`-Cast entfernen, mit `?? null` und `if (!modelSelect) return;` defensiv programmieren (wie bereits korrekt in `SettingsLLMSection.ts:203-204` gemacht).

### 17. [OnboardingWizard.ts:223] — `saveLLM()` fällt auf **stale** `llmResult` zurück
**Schwegrad: NIEDRIG (Korrektheit)**
`readLLMConfigFrom(this.element) ?? this.llmResult` — `this.llmResult` ist das Ergebnis der **initialen** `renderLLMConfigSection`-Auswertung, also der Startzustand, nicht der aktuelle Formular-Stand. Fällt `readLLMConfigFrom` auf `null` (ungültige Form), wird still und leise die alte Config gespeichert.
**Vorschlag:** Fallback auf `?? null` und bei `!cfg` eine `appendError`-Meldung statt `this.llmResult` (initiales Snapshot) verwenden.

### 18. [OnboardingWizard.ts:162-167, 22, 232] — `this.config` wird nie aus `config`-Store neu gelesen
**Schwegrad: NIEDRIG**
`private config = loadConfig()` (22) wird einmalig am Konstruktor gesetzt. Nach `restoreBackup → importZip` wird zwar `window.location.reload()` (167) gefiret, das ist aber ein Umweg: Innerhalb der Wizard-Instanz gibt es keinen Mechanismus, eine externe Config-Änderung (z.B. Multi-Tab-Szenario) einzulesen.
**Vorschlag:** In `complete()`/`saveLLM()` vor dem Speichern `this.config = { ...this.config, ...loadConfig() }` machen.

---

## 3-Satz-Zusammenfassung

Der kritischste Befund ist die unescaped `innerHTML`-Injection von `title`/`icon` im `window_manager.ts` (157-159, 187-194, 485), die über dynamische LLM-/App-Titel zu einer Vollausführung in der un-sandboxed Haupt-App führt (KRITISCH). Als zweitschwerster Punkt: Die `RenderPanel`-Bridge akzeptiert unbeschränkte `readFile`/`writeFile`-Pfade für ungetrusted iframe-HTML ohne Pfad-Allowliste (HOCH). Der Rest ist eine Mischung aus mittelgewichten Funktions-/UX-Fehlern (invertiertes Enter-Senden, staled Resize-Modellwerte, Fokus-Race-Logs, touch-Scroll-Suppression) und robustheitstechnischen Schwächen (fehlende `dispose()`s, fehlende Nullsafetys, async Bridge-Orphaning).
