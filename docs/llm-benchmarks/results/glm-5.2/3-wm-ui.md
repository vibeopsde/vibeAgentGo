[0m
> build · ollama/glm-5.2
[0m
[0m→ [0mRead web/src/core/window_manager.ts
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m→ [0mRead web/src/components/OnboardingWizard.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m→ [0mRead web/src/utils/markdown.ts
[0m✱ [0mGrep "onClose|onBlur|onFocus|destroy|unmount|cleanup|dispose"[90m in web/src/types · 3 matches[0m
[0m✱ [0mGrep "interface App\b|interface AppWindow|OpenWindowOptions|WindowManagerEventMap"[90m in web/src/types · 4 matches[0m
[0m→ [0mRead web/src/types/index.ts[90m [offset=160, limit=60][0m
[0m✱ [0mGrep "ViewTab|view\.title|views\.push|new RenderPanel|renderPanel\.render"[90m in web/src · 9 matches[0m
[0m✱ [0mGrep "onClose\s*[:(]"[90m in web/src · 3 matches[0m
[0m→ [0mRead web/src/apps/ProgramApp.ts[90m [offset=180, limit=20][0m
[0m✱ [0mGrep "addEventListener|setInterval|setTimeout"[90m in web/src/apps · 15 matches[0m
Ich habe jetzt alle nötigen Dateien gelesen. Hier das vollständige Code-Review.

---

# Code-Review: Window Manager + UI

## SECTION [window_manager.ts:181-182] — HOCH — Operator-Precedence-Bug bei Fenster-Positionierung

**Problem:** Bei der Default-Positionierung von Desktop-Fenstern:
```js
element.style.left = `${opts.x ?? 40 + this.windows.size * 20}px`;
element.style.top  = `${opts.y ?? 40 + this.windows.size * 20}px`;
```
`??` hat niedrigere Priorität als `+`, daher wird dies geparst als `opts.x ?? (40 + this.windows.size * 20)` — was intendiert ist. **Aber:** wenn `opts.x === 0` (gültiger Wert, linke Kante), fällt `??` korrekt durch. Das eigentliche Problem ist, dass dasselbe Muster in `openWindow` bei `win.x`/`win.y` (Zeile 248-249) **anders** gelöst ist: dort steht `opts.x ?? 40` (ohne Cascade). Im `win`-Objekt wird also `x: opts.x ?? 40` gespeichert, während das visuelle Element `40 + windows.size*20` erhält. Das bedeutet `win.x` ist nicht synchron mit der tatsächlichen Element-Position nach Kaskade. Spätere Operationen (`maximizeWindow` → `restoreBounds = {x: win.x, ...}`, `restoreWindow`) verwenden `win.x` und setzen das Fenster an eine **andere** Position als ursprünglich gerendert. Nach einem Maximize→Restore-Zyklus springt das Fenster.

**Verbesserung:** Konsistent vorab berechnen:
```js
const fallbackX = 40 + this.windows.size * 20;
const fallbackY = 40 + this.windows.size * 20;
const x = opts.x ?? fallbackX;
const y = opts.y ?? fallbackY;
// dann x/y für element.style UND win.x/win.y verwenden
```

---

## SECTION [window_manager.ts:181-182] — MITTEL — Race: `this.windows.size` als Cascade-Offset veraltet beim späten `set()`

**Problem:** `this.windows.size` wird in Zeile 181/182 gelesen, aber `this.windows.set(id, win)` erfolgt erst in Zeile 257. Bei **synchronen, schnellen** `openWindow`-Aufrufen (z. B. Schleife, die mehrere Fenster öffnet) erhalten alle denselben Cascade-Offset, weil die Map zum Zeitpunkt der Positionsberechnung noch nicht aktualisiert ist. Fenster überlappen perfekt.

**Verbesserung:** Einen eigenen Monoton-Zähler `openCounter` führen und `40 + openCounter * 20` verwenden, diesen vor dem `set()` inkrementieren.

---

## SECTION [window_manager.ts:225 + 207-210] — HOCH — Doppelte `pointerdown`-Listener mit konfligierendem setPointerCapture

**Problem:** Die Window-Titelleiste (`bar`) hat `pointerdown` → `startDrag(e, id)`, und dort wird `(e.target).setPointerCapture(e.pointerId)` auf dem **Bar-Element** aufgerufen (Zeile 528). Gleichzeitig hat das gesamte `element` einen `pointerdown`-Listener (Zeile 225) → `focusWindow(id)`. Da Events bubbeln, feuert bei einem Drag-Start **erst** der Bar-Listener (capture auf Bar), dann der Element-Listener (focus). Das ist idempotent, aber: `setPointerCapture` auf dem Bar-Element lenkt alle nachfolgenden `pointermove`/`pointerup` an die Bar. Die Drag-Handler sind aber auf `document` registriert (Zeile 550-552). Mit aktivem Pointer-Capture auf der Bar feuern `document`-Listener weiterhin, **aber** wenn die Bar während des Drags entfernt wird (z. B. `closeWindow` eines anderen Fensters, das denselben Pointer hätte), kann `releasePointerCapture` auf einem **entfernten** Knoten fehlschlagen (Zeile 543) → `InvalidStateError`.

**Verbesserung:** Pointer-Capture auf dem `element` (Fenster) statt auf der Bar setzen, oder Capture weglassen und nur `document`-Listener verwenden (die bereits vorhanden sind). Zudem in `onPointerUp` prüfen, ob `e.target` noch im DOM ist: `if (e.target instanceof Node && e.target.isConnected)` vor `releasePointerCapture`.

---

## SECTION [window_manager.ts:528, 543, 641, 654] — KRITISCH — `e.target` vs `e.currentTarget` bei Pointer-Capture

**Problem:** In `startDrag` (Zeile 528) und `startResize` (Zeile 641) wird `(e.target as HTMLElement).setPointerCapture(...)` verwendet. `e.target` ist das **innerste** Element, das den Hit-Test bestanden hat — bei der Titelleiste kann das ein `<span>` (Icon/Title) sein, nicht die Bar selbst. Das `pointerup`-Event mit Capture wird dann an dieses innere Element geliefert. In `onPointerUp` (Zeile 543) wird wieder `(ev.target as HTMLElement).releasePointerCapture(e.pointerId)` gerufen — `ev.target` beim `pointerup` ist aber u. U. ein **anderes** Element als beim `pointerdown` (z. B. wenn das Icon während des Drags ausgetauscht/entfernt wurde). `releasePointerCapture` auf einem Element, das den Capture nie gehalten hat, wirft `NotFoundError`.

**Verbesserung:** Statt `e.target` das Element referenzieren, auf dem der Listener registriert ist (`e.currentTarget`), oder — besser — eine Closure-Variable `const captureTarget = e.currentTarget as HTMLElement;` einführen und `setPointerCapture`/`releasePointerCapture` konsistent auf `captureTarget` aufrufen.

---

## SECTION [window_manager.ts:534-552] — KRITISCH — Event-Listener-Leak bei Drag ohne `pointerup`

**Problem:** `onPointerMove`/`onPointerUp` werden auf `document` registriert. Entfernung erfolgt **nur** in `onPointerUp`. Wenn jedoch:
- der Browser den `pointerup` verschluckt (bekannter Bug bei manchen Touch-Treibern / Browser-Switch in den Hintergrund),
- ein `pointercancel` auf einem anderen Pointer als dem Capture-Pointer feuert (der Listener feuert, entfernt sich, aber `pointerup` kommt nie),

…dann bleiben `pointermove`-Listener auf `document` **aktiv**. Bei jedem weiteren Drag werden neue Listener hinzugefügt, nie entfernt → Memory- und CPU-Leak (`updateSnapPreview` läuft bei jedem Mausmove im Dokument, auch nach Fenster-Schließung). Da `win` per Closure gehalten wird, wird auch das geschlossene Fenster-Element **nicht** GC'd.

**Verbesserung:**
1. In `closeWindow` prüfen, ob ein Drag/Resize für diese `id` läuft, und ggf. Listener entfernen (Track via `private activeDrag: {move, up, id} | null`).
2. `pointercancel` und `pointerup` auf denselben Handler zeigen lassen (bereits so), aber zusätzlich einen `visibilitychange`-Listener oder `blur`-Fallback auf `window` installieren, der den Drag abbricht.
3. In `onPointerMove`/`onPointerUp` frühzeitig returnen, wenn `win.element` nicht mehr `isConnected`.

---

## SECTION [window_manager.ts:59-64, 66-69] — HOCH — Globale `resize`/`scroll`-Listener nie entfernt → Leak bei SPA-Remount

**Problem:** Im Konstruktor werden `this.spaces.addEventListener('scroll', …)` und `window.addEventListener('resize', …)` mit **anonymen Arrow-Functions** registriert. Es gibt keine `destroy()`/`dispose()`-Methode, die diese entfernt. Wird der WindowManager (z. B. bei Hot-Reload, SPA-Transition, Test-Setup) neu instanziiert, bleiben die alten Listener am `window`-Objekt aktiv → kumulierende `reflowMaximizedWindows`-Aufrufe, Referenzen auf alte (entfernte) `this.element`-Bäume → Memory-Leak.

**Verbesserung:** Eine `destroy()`-Methode einführen, die beide Listener mit gespeicherten Referenzen entfernt; Hot-Reload-Code muss `destroy()` aufrufen.

---

## SECTION [window_manager.ts:157-161, 187-194] — KRITISCH — XSS via `icon`/`title` in `bar.innerHTML`

**Problem:** In der Mobile-Space-Bar (Zeile 157) und Desktop-Window-Bar (Zeile 187) wird:
```js
bar.innerHTML = `<span ...>${icon}</span><span ...>${title}</span>...`
```
`icon` und `title` stammen aus der App-Factory (`metadata.title`, `metadata.icon`) bzw. aus `opts.title` (Zeile 141). `opts.title` ist nutzer- bzw. datengetrieben (z. B. Dateiname als Fenstertitel im TextEditorApp). Weder `icon` noch `title` werden escaped. Ein Titel wie `<img src=x onerror=alert(1)>` oder `</span><script>…</script>` wird direkt ins DOM injiziert. Gleiches gilt für `createDockIcon` (Zeile 484): `btn.innerHTML = \`…${icon}…${title}…\``.

**Verbesserung:** `escapeHtml(icon)` und `escapeHtml(title)` in allen drei Stellen verwenden. `title` sollte zudem via `textContent` gesetzt werden, wo möglich (Dock-Label).

---

## SECTION [window_manager.ts:288-321] — MITTEL — `onClose` ist `boolean | Promise<boolean>`, aber Rückgabe wird nicht `await`ed

**Problem:** Der Typ `App.onClose?: () => boolean | Promise<boolean>` erlaubt asynchrone Close-Confirmation (z. B. "ungespeerte Änderungen — wirklich schließen?"). In `closeWindow` (Zeile 293-296):
```js
const result = app.onClose();
if (result === false) return false;
```
Wenn `onClose` ein Promise zurückgibt, ist `result` ein Promise-Objekt (truthy, `!== false`), das Fenster wird **sofort** geschlossen, bevor die asynchrone Bestätigung abgelaufen ist. Die UI zeigt keinen Confirm-Dialog, und Promise-Rejections werden ignoriert (unhandled).

**Verbesserung:** `closeWindow` als `async` deklarieren und `const result = await Promise.resolve(app.onClose());` verwenden. Alternativ `onClose` synchron erzwingen und den Promise-Typ entfernen.

---

## SECTION [window_manager.ts:288-321] — MITTEL — Modifikation der Map während Iteration in `unregisterApp`

**Problem:** `unregisterApp` (Zeile 123-127) iteriert `for (const [id, win] of this.windows)` und ruft innerhalb `this.closeWindow(id)` auf, das `this.windows.delete(id)` ausführt. Map-Iteration während gleichzeitiger Löschung ist in ES2015 zwar **spezifikationskonform** (gelöschte Entries werden übersprungen), aber die Logik ist fragil: `closeWindow` kann (über `onClose`) weitere Fenster öffnen oder schließen, was die Iteration verfälscht. Bei der jetzigen Implementierung riskiert man, dass neu geöffnete Fenster übersprungen oder doppelt verarbeitet werden.

**Verbesserung:** Zuerst die zu schließenden IDs sammeln (`const ids = [...this.windows.entries()].filter(...).map(([id]) => id)`), dann außerhalb der Iteration schließen.

---

## SECTION [window_manager.ts:298] — NIEDRIG — `app.element?.remove()` doppelt mit `win.element.remove()`

**Problem:** `app.element` wird beim Mounten (Zeile 233) in `contentEl` appended, ist also Kind von `win.element`. `win.element.remove()` (Zeile 299) entfernt den gesamten Baum inkl. `app.element`. Das separate `app.element?.remove()` (Zeile 298) ist redundant — es kann zudem dazu führen, dass App-spezifische Cleanup-Listener (z. B. ResizeObserver im App-Code) fälschlich ein `DisconnectedCallback` feuern, bevor die eigene `onClose`-Logik läuft. Reihenfolge: `onClose` → `app.element.remove` → `win.element.remove`. Bei Apps, die im `onClose` DOM-Querys auf `app.element` machen, ist das Element da; das passt. Aber redundant ist es.

**Verbesserung:** `app.element?.remove()` entfernen — `win.element.remove()` reicht.

---

## SECTION [window_manager.ts:376-400] — MITTEL — Race in `focusWindow` bei reentrante Aufrufen

**Problem:** `focusWindow` liest `this.activeWindowId` (Zeile 379), entfernt `focused` vom Vorgänger, ruft `prevApp?.onBlur?.()` auf (Zeile 383) — **synchron, aber `onBlur` kann beliebigen Code ausführen**, inkl. `focusWindow` für ein anderes Fenster (z. B. eine App, die beim Blur den Fokus zurückholen will). In diesem Fall ist `this.activeWindowId` noch der alte Wert, der Re-Entrant-Call überschreibt ihn, und der äußere Call schreibt dann den ursprünglichen `id` drüber — Fokus-Deskriptions und `zIndex`-Reihenfolge werden inkonsistent.

**Verbesserung:** `onBlur`/`onFocus` erst nach vollständigem Update von `activeWindowId` und `zIndex` aufrufen (also am Ende der Methode), oder eine Reentrancy-Guard-Flag setzen.

---

## SECTION [window_manager.ts:489-499] — MITTEL — `isProgrammaticScroll`-Guard unsicher bei mehreren gleichzeitigen `scrollToSpace`

**Problem:** `scrollToSpace` setzt `isProgrammaticScroll = true`, plant aber `= false` erst nach 400 ms ein. Wird innerhalb dieser 400 ms ein **anderer** programmatischer Scroll getriggert (z. B. Nutzer klickt Dock-Icon → `focusWindow` → `scrollToSpace` für anderes Fenster), wird der zweite Timeout gesetzt, aber der **erste** Timeout feuert nach 400 ms und setzt `isProgrammaticScroll = false` — **während** der zweite Scroll noch läuft. User-Scroll-Events während der zweiten Animation triggern nun `updateActiveSpaceOnScroll` und können `focusWindow` für das falsche Space aufrufen → Fokus-Sprung mitten in der Animation.

**Verbesserung:** Statt boolean einen Zähler oder Token verwenden: `private scrollGuardToken = 0;` — bei jedem `scrollToSpace` einen neuen Token speichern, und das Timeout prüft, ob noch derselbe Token gilt, bevor es den Guard aufhebt.

---

## SECTION [window_manager.ts:494] — MITTEL — `scrollIntoView` ohne `block`-Option verschiebt ggf. ganze Seite

**Problem:** `space.scrollIntoView({ behavior: 'smooth', inline: 'start' })` spezifiziert kein `block`. Default ist `'start'`, was bei manchen Layouts dazu führt, dass nicht nur der horizontale Scroll-Container, sondern auch ein vertikaler Vorfahr gescrollt wird (z. B. body) — das Window/dock springt. Gerade wenn der WindowManager in eine bestehende Seite eingebettet ist, entsteht ein unerwarteter vertikaler Scroll.

**Verbesserung:** `{ behavior: 'smooth', inline: 'start', block: 'nearest' }` verwenden.

---

## SECTION [ChatPanel.ts:198-210] — MITTEL — `escapeHtml` auf Data-URL-Image unzureichend

**Problem:** In `appendUser`:
```js
html += `<img src="${escapeHtml(a.content)}" alt="${escapeHtml(a.name)}" ...>`;
```
`a.content` ist für Images eine Data-URL (`data:image/png;base64,...`). `escapeHtml` ersetzt `"` → `&quot;`, was das Attribut sicher macht. **Aber:** Data-URLs können in einigen Browsern sehr lang werden und der gesamte HTML-String via `innerHTML` gesetzt — das ist ineffizient und bei großen Bildern fehleranfällig. Sicherheitsproblem ist es nicht (Data-URL kann nicht scripten), aber: wenn `a.content` versehentlich kein `data:`-Schema hat (z. B. durch manipulierten Upload-Reader), könnte `src="javascript:..."` stehen. `escapeHtml` verhindert das **nicht** (javascript:-URLs enthalten keine HTML-Special-Chars).

**Verbesserung:** Vor dem Einsetzen prüfen: `if (a.type === 'image' && a.content.startsWith('data:image/'))` — sonst als Date-Icon rendern. Alternativ `<img>` via `createElement` + `img.src = a.content` setzen (Browser filtern `javascript:`-URLs im `src`-Property-Setter).

---

## SECTION [ChatPanel.ts:220, 254, 287] — HOCH — `data-raw`-Attribut kollidiert mit Quotes bei Markdown-Injection

**Problem:** In `appendSystem` (Zeile 220), `appendAssistant` (Zeile 254) und `appendStreamDelta` (Zeile 287):
```js
el.innerHTML = `<div class="msg-content" data-raw="${escapeHtml(text)}">${renderMarkdown(text)}</div>`;
```
`escapeHtml` ersetzt `"` → `&quot;`, damit das Attribut sicher ist. **Aber:** der **Markdown-Output** (`renderMarkdown(text)`) wird **ungeprüft** in das `innerHTML` eingesetzt. `renderMarkdown` nutzt zwar `DOMPurify`, erlaubt aber `href`-Attribut. Ein Markdown-Link `[x](javascript:alert(1))` → `<a href="javascript:alert(1)">x</a>` wird von DOMPurify **nicht** blockiert, weil `javascript:` nicht im Tag-Filter steht (nur `href` als Attribut erlaubt ist, das Schema aber nicht geprüft wird — DOMPurify default blockt `javascript:` eigentlich; **aber** die Konfiguration überschreibt `ALLOWED_ATTR`, was u. U. Schema-Filter abschwächt). Verifikation: DOMPurify blockt `javascript:`-URLs per Default auch bei gesetztem `ALLOWED_ATTR`, aber die explizite ALLOWED_TAGS-Liste **deaktiviert** DOMPurifys `FORBID_ATTR`-Default-Logik teilweise. Verhalten muss getestet werden.

**Verbesserung:** Explizit `FORBID_ATTR: ['style', 'srcset']` und `ALLOW_DATA_ATTR: false` setzen, sowie `ALLOWED_URI_REGEXP: /^(?:https?|mailto|ftel|data:image)/i` hinzufügen, damit `javascript:`-Links sicher blockiert sind.

---

## SECTION [ChatPanel.ts:273-291] — MITTEL — `appendStreamDelta` kann Stream nach `finalizeStream`/`clear` nicht erkennen

**Problem:** `appendStreamDelta` prüft `if (!this.streamEl) { this.startStream(); }`. Wenn ein Stream finalisiert wurde (`this.streamEl = null`, Zeile 311) und dann **verspätet** ein weiteres Delta eintrifft (Race: asynchroner SSE-Handler, der noch nicht abgebrochen wurde), wird **automatisch ein neuer** Assistant-Message-Stream gestartet — ohne dass der Caller dies beabsichtigt. Resultat: eine leere/telweise gefüllte Bubble erscheint.

**Verbesserung:** Ein Flag `private streamingActive = false;` in `startStream`/`finalizeStream` setzen; in `appendStreamDelta` nur starten, wenn `streamingActive`, sonst Delta verwerfen oder loggen.

---

## SECTION [ChatPanel.ts:283-290] — NIEDRIG — Debounce-Timer wird nicht in `clear()`/`finalizeStream` nach Final-Render null gesetzt (bereits korrekt, aber Race)

**Problem:** In `finalizeStream` (Zeile 300-307) wird der Timer korrekt null gesetzt. In `clear()` (Zeile 190-193) wird jedoch **nicht** `this.streamRenderTimer` gelöscht. Ruft ein Caller `clear()` während ein Debounce-Render läuft (50 ms), feuert der Timer nach `clear()` und greift auf `this.streamEl` zu, das gerade `null` gesetzt wurde → guarded (Zeile 285 `if (this.streamEl)`), also harmlos, aber ein stale `streamRenderTimer`-Handle bleibt.

**Verbesserung:** In `clear()` ebenfalls `if (this.streamRenderTimer) { clearTimeout(this.streamRenderTimer); this.streamRenderTimer = null; }`.

---

## SECTION [ChatPanel.ts:122-160] — NIEDRIG — `FileReader.onerror` ohne finale Anzeige bei `readAsText`-Encoding-Fehlern

**Problem:** `FileReader.onerror` wird nur bei echten Lese-Fehlern getriggert. Binäre Dateien, die als `text` gelesen werden (z. B. `.log`-Datei mit Null-Bytes), produzieren keinen Error, sondern einen String mit `\u0000`-Zeichen, der dann via `escapeHtml` als sichtbarer Müll in der Attachment-Liste landet.

**Verbesserung:** Für als `text` klassifizierte Dateien zumindest prüfen, ob Ergebnis NUL-Bytes enthält, und ggf. als `pdf`-Icon (generic) rendern.

---

## SECTION [ChatPanel.ts:24] — NIEDRIG — Keine `destroy()`/Detach-Methode

**Problem:** `ChatPanel` registriert Listener auf `this.inputEl`, `this.sendBtn`, `fileInput`, `menuBtn`. Nach `element.remove()` sind diese zwar GC-fähig, **aber** externe References (z. B. `onSubmit`, `onStop` Callbacks vom AppController) bleiben an die ChatPanel-Instanz gebunden. Wenn der AppController die Instanz nicht nullt, bleiben die Closures lebendig.

**Verbesserung:** `destroy()`-Methode, die alle Callback-Props (`onSubmit`, `onStop`, …) auf `null` setzt und den Render-Timer cleart.

---

## SECTION [RenderPanel.ts:80-103] — KRITISCH — Globaler `message`-Listener nie entfernt + nicht auf `event.source` gefiltert

**Problem:** `attachMessageListener` registriert `window.addEventListener('message', …)` **ohne Referenz** auf die Handler-Funktion — kann nie entfernt werden. Bei jedem `new RenderPanel()` (z. B. Hot-Reload, Multi-Window) kumulieren Listener. Schlimmer: Es wird **nicht geprüft**, ob `event.source === this.iframe.contentWindow`. Jeder andere iframe (z. B. Ads, Third-Party-Widgets, eine zweite RenderPanel-Instanz) kann `vibeAgentGoBridgeRequest: true` senden und erhält Zugriff auf `this.onBridgeRequest` → **Cross-iframe-Bridge-Hijacking**: ein bösartiges oder kompromittiertes View ruft `readFile`/`writeFile`/`sendMessage` im Namen des Nutzers.

**Verbesserung:**
1. Handler-Referenz speichern, `destroy()` einführen.
2. **Zwingend:** `if (event.source !== this.iframe.contentWindow) return;` als erste Zeile im Listener.
3. Statt `'*'` als `postMessage`-targetOrigin (Zeile 115/123) die eigene Origin angeben.

---

## SECTION [RenderPanel.ts:128-173] — HOCH — Bridge-Proxy erlaubt uneingeschränkten Dateizugriff aus sandboxiertem iframe

**Problem:** Das `bridgeProxyScript` exponiert `readFile(path)` / `writeFile(path, content)` an den iframe-Inhalt. Das iframe hat `sandbox='allow-scripts'` (Zeile 60) — keine `allow-same-origin`, was gut ist. **Aber:** die Bridge selbst läuft im **parent** mit voller Origin-Privilegie. Es gibt **keine Pfad-Validierung** oder Sandbox im `onBridgeRequest`-Handler — jeglicher HTML-Inhalt, der via `srcdoc` geladen wird (und der wiederum aus der KI-Antwort stammt!), kann beliebige Dateien lesen/schreiben. KI-generierter HTML-Code könnte `vibeAgentGo.writeFile('../sensitive', …)` aufrufen. Das `sandbox`-Attribut schützt nur vor Same-Origin-Cookies, **nicht** vor der privilegierten Bridge.

**Verbesserung:**
- Im `onBridgeRequest` einen **Allowlist**-Pfad-Filter erzwingen (z. B. nur innerhalb eines projektbezogenen `workdir`).
- `writeFile` nur nach Nutzer-Bestätigung erlauben.
- Alternativ Bridge komplett deaktivieren und nur explizite Captive-APIs (kein Dateizugriff) anbieten.

---

## SECTION [RenderPanel.ts:199-235] — KRITISCH — `setupLogCapture` injiziert `title` via `JSON.stringify` — aber `title` in `postMessage`-Empfänger ungeprüft

**Problem:** `JSON.stringify(title)` in Zeile 210 ist sicher im injizierten Script. **Aber:** der `message`-Listener (Zeile 81-102) vertraut `data.title` ungeprüft und reicht es an `appendLog(data.title, …)` weiter. `appendLog` sucht `this.views.find(v => v.title === title)` — ein Angreifer-iframe kann Logs mit **beliebigem Titel** injizieren und so Logs in fremde Views einschleusen (Daten-Inkonsistenz, potentiell XSS in einer Log-Anzeige, die `title` als HTML rendert).

**Verbesserung:** Im Listener `if (event.source !== this.iframe.contentWindow) return;` (siehe oben) — dann ist nur das eigene iframe autorisiert.

---

## SECTION [RenderPanel.ts:293] — HOCH — `iframe.srcdoc = …` bei jedem `renderActiveView` neu gesetzt → Reload-Flackern + Memory

**Problem:** Bei jedem Tab-Wechsel (und bei jedem `render()`-Aufruf des Panels) wird `this.iframe.srcdoc` neu zugewiesen — auch wenn der **aktive View** derselbe ist (z. B. nach Log-Anhang, nach Tab-Schließen eines anderen Tabs). Das iframe lädt komplett neu, verliert Scroll-Position, State und laufende Animationen. Zudem wird `view.html` (potenziell groß) als String kopiert. Da `srcdoc` keinen Caching-Mechanismus hat, wächst der Memory bei vielen View-Wechseln (Browser halten alte `srcdoc`-Strings).

**Verbesserung:** Vor dem Neusetzen prüfen: `if (this.iframe.dataset.title === view.title) return;` — und nur bei tatsächlichem Wechsel neu setzen. Oder das iframe pro View cachen (`Map<string, HTMLIFrameElement>`).

---

## SECTION [RenderPanel.ts:237-272] — MITTEL — Tab-`closeBtn` ist `<span>` mit Click-Listener, nicht keyboard-accessible

**Problem:** Der Tab-Schließen-Button ist ein `<span class="tab-close">×</span>` (Zeile 259) — nicht fokussierbar, kein `role="button"`, kein `tabindex`. Tastatur-Nutzer können Tabs nicht schließen.

**Verbesserung:** `<button class="tab-close" aria-label="Close">×</button>` verwenden, oder `tabindex="0"` + `keydown`-Listener für Enter/Space.

---

## SECTION [OnboardingWizard.ts:32-38, 174-262] — HOCH — `render()` überschreibt `innerHTML` ohne Event-Listener zu entfernen → Leak bei jedem Step-Wechsel

**Problem:** Jede `render*`-Methode setzt `this.element.innerHTML = …` (Zeile 33, 49, 96) oder appended `card` mit `innerHTML = …` (Zeile 179, 240). Vorher registrierte Listener (z. B. `modelSelect.addEventListener('change', …)` aus Schritt 3) werden beim Wechsel auf Schritt 4 vom DOM entfernt, aber der GC kann die Closure erst freigeben, wenn auch die `llmResult`-Referenz verschwindet. `this.llmResult` (Zeile 23) wird **nur** in `renderLLMConfig` neu zugewiesen — nie null gesetzt. Beim Zurück-Navigieren (Step 4 → 3) wird es überschrieben, aber Referenzen auf alte `modelSelect`/`modelManual`-Closures aus `updateNextButton` (Zeile 201) leben im `llmResult` weiter, bis überschrieben. Bei wiederholtem Vor/Zurück-Klicken **kumulieren** nicht entfernte DOM-Listener-Referenzen.

**Verbesserung:** In `render()` vor dem `innerHTML = ''` explizit `this.llmResult = null;` setzen, und in den Section-Renderern alle dynamischen Listener tracken und in einer `cleanup()`-Methode entfernen.

---

## SECTION [OnboardingWizard.ts:152-172] — MITTEL — `restoreBackup` entfernt `onComplete`-Reihenfolge-Race

**Problem:** Bei erfolgreicher Restore: `setTimeout(() => window.location.reload(), 600)` (Zeile 167). In diesen 600 ms kann der Nutzer auf "Next"/"Back" klicken, was `this.render()` aufruft, neue Listener registriert und dann mitten im Aufbau der neuen Step-DOM durch `reload()` abgebrochen wird. Kein echtes Leak, aber UX-Race.

**Verbesserung:** Nach erfolgreicher Restore das Wizard-Element deaktivieren (`this.element.style.pointerEvents = 'none'` + Overlay) oder eine Flag `this.isRestoring = true`, die in `render()` früh zurückkehrt.

---

## SECTION [OnboardingWizard.ts:6] — NIEDRIG — `import { saveConfig, loadConfig }` side-effect bei Modul-Load

**Problem:** `private config = loadConfig();` (Zeile 22) wird im Konstruktor ausgeführt — `loadConfig` macht `localStorage.getItem`. Bei deaktiviertem `localStorage` (z. B. Privacy-Browser, file://-Kontext) wirft das. Kein try/catch.

**Verbesserung:** `loadConfig` sollte try/catchintern haben; oder im Wizard einen Fallback `loadConfig() ?? {}` abfangen.

---

## 3-Satz-Zusammenfassung

Die kritischsten Probleme sind drei **XSS-/Sicherheitslücken**: ungefilterte `icon`/`title`-Werte im Window Manager (`window_manager.ts:157-194, 484`), der ungeprüfte `message`-Listener ohne `event.source`-Validierung in `RenderPanel.ts:80-103` (Bridge-Hijacking aus beliebigen iframes möglich), sowie die privilegierte Datei-Bridge ohne Pfad-Allowlist (`RenderPanel.ts:128-173`), die KI-generiertem HTML-Inhalt vollen Dateizugriff gewährt. Hinzu kommen mehrere **Event-Listener-Leaks** bei Drag/Resize ohne Pointer-Up-Garantie (`window_manager.ts:534-552`) und nie entfernte globale `resize`/`scroll`/`message`-Listener ohne `destroy()`-Methode in WindowManager und RenderPanel. Abschließend finden sich **Race Conditions** bei reentrantem `focusWindow` (`onBlur` kann Fokus zurückholen), bei der `isProgrammaticScroll`-Guard-Logik (Timer-Kollision bei schnellem Space-Wechsel), beim nicht-`await`eten asynchronen `onClose`-Promise und beim automatischen Neustart eines beendeten Streams durch späte Deltas in `ChatPanel.appendStreamDelta`.
