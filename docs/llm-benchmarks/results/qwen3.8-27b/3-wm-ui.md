[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/core/window_manager.ts
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m→ [0mRead web/src/components/OnboardingWizard.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m→ [0mRead web/src/utils/markdown.ts
[0m✱ [0mGrep "AppWindow|restoreBounds|onClose|onFocus|onBlur"[90m in web/src/types · 5 matches[0m
[0m✱ [0mGrep "chat\.(placeholder|fileTooLarge|removeAttachment|copyCode)|'chat'"[90m in web/src/i18n · 8 matches[0m
Let me check a few supporting files to confirm findings.
[0m→ [0mRead web/src/types/index.ts[90m [offset=155, limit=60][0m
**Code-Review: Window Manager + UI (window_manager.ts, ChatPanel.ts, RenderPanel.ts, OnboardingWizard.ts)**

---

## FUND 1 — [web/src/core/window_manager.ts:542-552] Schweregrad: HOCH
**Event-Listener-Leak bei Drag (Touch/pointercancel)**
In `startDrag` rufen die Cleanup-Handler `(ev.target as HTMLElement).releasePointerCapture(e.pointerId)` **vor** dem Entfernen der `document`-Listener auf (Zeile 543, analog bei `startResize` Zeile 654). Nach `pointercancel` (beim Touch-Scrolling üblich) ist der Pointer inaktiv und `releasePointerCapture` wirft `InvalidPointerIdError` — der throw bricht den Handler ab, bevor die `removeEventListener`-Aufrufe laufen. Resultat: `pointermove`/`pointerup`-Listener akkumulieren an `document` (ein Handler-Leak pro abgebrochenem Drag) und `onPointerMove` schreibt weiterhin `startLeft+dx` in `win.element.style` bei jeder Bewegung.
**Vorschlag:** Cleanup in einen `finally`-Block bzw. `try { releasePointerCapture } catch {}` umwickeln; `removeEventListener`-Aufrufe müssen bedingungslos ausgeführt werden. Alternativ: Da `setPointerCapture` ohnehin retargetet, die `document`-Listener streichen und die Handler direkt auf das Capture-Element hängen.

---

## FUND 2 — [web/src/core/window_manager.ts:288-302] Schweregrad: HOCH
**Race Condition: asynchrone `onClose` wird ignoriert, DOM wird unter dem Handler gerissen**
Der Typ `App.onClose` erlaub `boolean | Promise<boolean>` (types/index.ts:177), aber `closeWindow` prüft `if (result === false) return false;` — ein zurückgegebener Promise ist nie strikt `=== false`. Ein App, das das Schließen asynchron verhindert (z. B. „Unge Speicherte Änderungen?" prompt mit await), wird trotzdem sofort geschlossen: `win.element.remove()` (Zeile 299) und das Leeren aller Maps laufen, während `onClose` noch pending ist → uncaught rejections, `onFocus/onBlur`-Callbacks eines Zersetzten, und der Veto-Flag des Apps wird stillschweigend umgangen.
**Vorschlag:** `closeWindow` asynchron machen: `const result = await app.onClose?.(); if (result === false) return false;` (außerhalb bleibt fire-and-forget möglich) und sicherstellen, dass während eines laufenden Closes keine zweite `closeWindow`-Aufrufe für dieselbe id parallel laufen (in-flight-Set).

---

## FUND 3 — [web/src/components/RenderPanel.ts:80-103] Schweregrad: KRITISCH
**Globale `message`-Listener: Duplex-Bridge-Ausführung + Leak bei Fensterschließung + fehlende Source-Prüfung**
Jede `RenderPanel`-Instanz hängt einen permanenten `window.addEventListener('message', …)` an und filtert nur nach `vibeAgentGoBridgeRequest === true` — **ohne zu prüfen, ob `event.source` das eigene `iframe.contentWindow` ist**. Konse­quenzen:
1. Sämtliche RenderPanels im App (WM-Fenster, mehrere Preview-Akte) beantworten jede Bridge-Anfrage jedes Iframes → `onBridgeRequest` wird pro Instanz parallel ausgeführt, d. h. `writeFile`-Requests können **mehrfach** ausgeführt werden (wettlaufende, überlagernde Dateischreibungen) und das gleiche für `readFile`.
2. Das Iframe löst auf die erste Antwort (`pending.delete(id)`), aber die anderen Handler-Läufe wirken trotzdem im Dateisystem.
3. Ein `closeWindow` vom WM entfernt nur `win.element` — die globalen `message`-Listener aller geschlossener RenderPanels bleiben für die Life­time der App an `window` hängen (Memory-Leak + weiterhin aktive Bridge-Respon­der).
**Vorschlag:** Im Listener zuerst `if (event.source !== this.iframe.contentWindow) return;` prüfen. Zusa­tz­lich eine `destroy()`-Methode mit `window.removeEventListener('message', handler)` implementieren und diese aus `closeWindow` aufrufen (bzw. den WM informieren, dass er App-Instance aufgeräumt wird).

---

## FUND 4 — [web/src/core/window_manager.ts:157-161, 187-194, 484] Schweregrad: HOCH
**XSS durch ungesicherte `title`/`icon` in `innerHTML` (Fensterleiste + Dock)**
`bar.innerHTML = \`…<span class="wm-space-title">${title}</span>…\`` bzw. `…${icon}…` und in `createDockIcon` — `title` und `icon` kommen aus der App-Metadaten (`app.title`, `opts.title`, `app.icon`) und können aus Dateinamen, Agent-Aufträgen oder LLM-Antworten stammen. Ohne escapen lässt sich damit eine beliebige HTML-Injektion durchführen: `<img src=x onerror="…">` in einer App-Titel wird ausgeführt. (Im Chat selbst ist das Rendering über `renderMarkdown` + DOMPurify abgesichert — hier aber nicht.)
**Vorschlag:** `title`/`icon` mit dem vorhandenen `escapeHtml()` (utils/escape.ts) escapen, oder die Zeile mit DOM-API (`textContent`) aufbauen statt `innerHTML`.

---

## FUND 5 — [web/src/core/window_manager.ts:237-255 vs. 178-183] Schweregrad: MITTEL
**Inkonsistente Initiale-Geometrie: un­ge­clampte Element-Position, veraltete `win.x`**
`element.style.top` wird (Zeile 182) direkt aus `opts.y` gesetzt — **ohne** Clamping (unlike `preHeight` bei der Höhe). `win.y` wird hingegen clamped (Zeile 239, 249) und `win.x` immer `opts.x ?? 40` (Zeile 248), während die Element-Left-Position `40 + windows.size*20` ist. Das führt zu: (a) Fenstern, die bei großen `opts.y` außerhalb des Sichtbereichs/unter dem Dock geöffnet werden, (b) Drags, die mit `offsetLeft` funktionieren, aber `win.x/y`-Metadaten, die mit der sichtbaren Position nichts mehr zu tun haben — jedes Feature, das `win.x/y` liest (z. B. künftiges Snap-Anpassung, `restoreWindow`-Default), arbeitet mit veralteten Werten.
**Vorschlag:** `element.style.left/top` aus den bereits clamped Werten (`clampedY` bzw. clamped `x`) setzen und `win.x = clampedX;` setzen, sodass die Metadaten und die sichtbare Geometrie deckungsgleich sind.

---

## FUND 6 — [web/src/core/window_manager.ts:636-662] Schweregrad: MITTEL
**Resize: `win.width`/`win.height` werden nicht synchronisiert**
`onPointerMove` in `startResize` setzt nur `win.element.style.width/height` (Zeile 650-651) — `win.width`/`win.height` bleiben bei ihrem Initialwert (z. B. 400×300). `reflowMaximizedWindows()` und `restoreWindow()` lesen `win`-Metadaten; `maximizeWindow` speichert `restoreBounds` korrekt, aber jeder Code, der `win.width` nach einem manuellen Resize verwendet, bekommt den falschen Wert.
**Vorschlag:** In `onPointerMove` parallel zu `style.width/height` auch `win.width` und `win.height` aktualisieren.

---

## FUND 7 — [web/src/core/window_manager.ts:376-400, 501-521] Schweregrad: MITTEL
**Fokus-Race: `focusWindow` feuert bei invarianter Aktivität + mobile Scroll-Feedback-Loop**
`focusWindow` hat keine Guard `if (this.activeWindowId === id) return;` — sie wird von `element pointerdown` (Zeile 225) **und** `startDrag` (Zeile 527) bei jedem Drag-Start aufgerufen, sowie von `updateActiveSpaceOnScroll` (debounced, Zeile 519) bei jedem Scroll-Ende. Ergebnis: `zCounter` wächst unbegrenzt (Zeile 389), `window_focused` wird mehrfach für dasselbe Window emittiert, `onFocus/onBlur`-Callbacks werden unnötig getriggert, und `updateDock()` (kompletter Dock-Rebuild via `innerHTML`) wird bei jedem Drag-Scroll aufgerufen. Auf Mobiles kann der 400 ms `isProgrammaticScroll`-Guard (Zeile 496-498) vor Inertial-Scrolling ablaufen, sodass `scrollToSpace` → neuer Scroll-Event → `focusWindow` → neuer `scrollToSpace`-Zyklus entsteht (Feedback-Loop).
**Vorschlag:** In `focusWindow` `if (this.activeWindowId === id) { // z-index/klasse schon ok → early return, aber optional z-bump }` setzen; den `isProgrammaticScroll`-Guard auf das `scroll`-end-Event des Spaces legen (bzw. `requestAnimationFrame`-Pulsieren bis der Abstand konvergiert) statt auf einen festen 400 ms Timer.

---

## FUND 8 — [web/src/components/ChatPanel.ts:273-292, 190-193] Schweregrad: MITTEL
**Race: Debounce-Timer des Stream-Renders kontaminiert das nächste Stream-Element**
Der `setTimeout` in `appendStreamDelta` (Zeile 284-290) liest beim Auslösen `this.streamEl` — also das **aktuelle** Stream-Element, nicht das, für das der Timer gesetzt wurde. `clear()` (Zeile 190-193) setzt `streamEl = null` **ohne** `streamRenderTimer` zu klären. Falls zwischen `clear()` und Timer-Ab­lauf ein neues `startStream()` die nächste `streamEl` setzt, rendert der alte Timer die **alte** `dataset.raw` in das **neue** Element → der neue Assistenten-Stream startet mit dem Inhalt des vorherigen (Daten­verwechslung, ggf. sensible Inhalte aus der alten Sitzung in der neuen sichtbar).
**Vorschlag:** `clear()` sollte `clearTimeout(this.streamRenderTimer); this.streamRenderTimer = null;` aufrufen. Zusätzlich: `const el = this.streamEl; const raw = el.dataset.raw;` in den Timer-Callback schließen, damit der Timer immer auf sein ursprüngliches Element schreibt.

---

## FUND 9 — [web/src/components/ChatPanel.ts:105-115, 148-149] Schweregrad: MITTEL
**Race: `attachments` wird per Referenz übergeben, FileReader-`onload` kann sie asynchron mutieren**
`send()` (Zeile 114) übergibt `this.attachments` (Array-Referenz) an `onSubmit`. `handleFiles` (Zeile 148) pusht in dasselbe Array, sobald `reader.onload` feuert. Szenario: Nutzer hängt Dateien an → sendet sofort (z. B. via Button) → eine `FileReader`-Instanz ist noch pending. Der Caller speichert das Array für den späteren LLM-Aufruf; `onload` pusht den neuen Anhang in dasselbe Array, **nach** dem Senden. Resultat: Anhang fehlt in der gesendeten Nachricht, oder (wenn der App-Controller das Array nicht gecleart hat) wandert der Anhang in die **nächste** Nachricht.
**Vorschlag:** `send()` soll ein Snapshot bauen: `const snaps = [...this.attachments];` und `this.onSubmit(text, snaps)` übergeben; oder `handleFiles` sollte pending-FileReaders in einer separaten Warteschlange halten und nur `onload` → push in `this.attachments` **nach** dem Snapshot.

---

## FUND 10 — [web/src/components/RenderPanel.ts:275-294] Schweregrad: MITTEL
**Iframe wird bei jedem `renderActiveView` geladen — State-Verlust und Flackern**
Zeile 293: `this.iframe.srcdoc = …` wird bei **jedem** Tab-Klick und jeder `render()`-Aufrufe gesetzt, auch wenn die `activeTitle` sich nicht geändert hat. Das führt zu: Iframe-Neuladung → Konsolen-Logs werden zurückgesetzt (log-Buffer wird nicht befüllt), Live-Charts/Demolose State im View verliert, sichtbares Flackern, und die Bridge-Skripte starten neu (pending Bridge-Requests werden orphane).
**Vorschlag:** Cache des letzten `srcdoc`-Strings pro `activeTitle` halten (`lastRenderedKey = activeTitle + hash(html)`); `iframe.srcdoc` nur setzen, wenn sich der Key geändert hat.

---

## FUND 11 — [web/src/components/OnboardingWizard.ts:198-212] Schweregrad: MITTEL
**NPE-Crash wenn `#cfg-model` / `#cfg-model-manual` nicht existieren**
Zeile 198-199: `card.querySelector('#cfg-model') as HTMLSelectElement` und `#cfg-model-manual` — ohne `null`-Check. Zeile 211-212: `modelSelect.addEventListener(…)` und `modelManual.addEventListener(…)` — falls `renderLLMConfigSection` (Settings­LLM­Section.ts) die IDs nicht rendert (z. B. wegen fehlender Preset-Daten, fehlender `apiKey` im config-Objekt, oder ein Refactor), wirft das einen `TypeError: Cannot read properties of null` und **crasht** den kompletten Onboarding in Step 3 (kein Catch-Block, keine Fallback-UI).
**Vorschlag:** `const modelSelect = card.querySelector('#cfg-model') as HTMLSelectElement | null;` und `if (modelSelect) modelSelect.addEventListener(…);` / `if (modelManual) modelManual.addEventListener(…);` bzw. `?? throw` mit klarem Error-Message.

---

## FUND 12 — [web/src/core/window_manager.ts:31, 183, 389] Schweregrad: NIEDRIG
**`zCounter` wächst unbegrenzt**
`++this.zCounter` bei `openWindow` (Zeile 183) und `focusWindow` (Zeile 389) — keine Obergrenze. Nach 2^31 Fokus-Wechseln (praktisch irrelevant), aber nach hunderten Wechseln wird der `zIndex`-Wert groß genug, dass CSS-`z-index`-Kollateraleffekte (z. B. `z-index: 2147483647` in CSS als `max`) eintreten.
**Vorschlag:** Nach jedem `openWindow`-Batch `zCounter = Math.max(...values)` re-setzen (normalisieren), oder eine Kreis­lauf-Strategie (z. B. 1000er-Schritte mit Rebase).

---

## FUND 13 — [web/src/core/window_manager.ts:37-70] Schweregrad: NIEDRIG
**Kein `destroy()`-Methodus; `resize`-Listener bleibt permanent an `window`**
Zeile 66-69: `window.addEventListener('resize', …)` — kein `removeEventListener` möglich (WM hat kein `destroy()`). Wenn eine Test-Suite mehrere `WindowManager`-Instanzen erzeugt (oder ein HMR-Hot-Reload in dev), bleiben die alten `resize`-Listener an `window` hängen und verweisen auf die alten, bereits zersetzten WM-Objekte → Memory-Leak + `No-Op`-Aufrufe (bzw. Fehler wenn WM-Referenzen null sind).
**Vorschlag:** `destroy()`-Methodus mit `window.removeEventListener('resize', this._resizeHandler)` implementieren; Handler als Named-Function speichern, um ihn entfernen zu können.

---

## FUND 14 — [web/src/utils/markdown.ts:39] Schweregrad: NIEDRIG
**`target`-Attribut ohne `rel="noopener noreferrer"` (Reverse-Tabnabbing)**
`ALLOWED_ATTR: ['href', 'title', 'target', 'class']` — `target="_blank"` ist erlaubt, aber `rel` ist nicht in `ALLOWED_ATTR`. Ein LLM, das `<a href="…" target="_blank">` rendert, erzeugt ein Link-Target, das `window.opener` des neuen Tabs zugreifen kann, wenn es in einem neuen Tab öffnet.
**Vorschlag:** `rel` in `ALLOWED_ATTR` einfügen; `renderMarkdown`-Funktion sollte nach dem Sanitize `a[target=_blank]` → `rel="noopener noreferrer"` automatisch setzen.

---

## FUND 15 — [web/src/components/RenderPanel.ts:228-234] Schweregrad: NIEDRIG
**Skript-Injektion ist case-sensitiv und scheitert bei XHTML/`<HEAD>`**
Zeile 228-233: `html.includes('<head>')` und `html.replace('<head>', …)` — wenn das View-HTML `<HEAD>` (uppercase) oder `<Head>` enthält, wird weder `<head>` noch `<body>` gematcht, und das Skript wird am Anfang des Dokuments vor `<html>` injiziert (Zeile 234) → Browser rendert es als **plain text** statt als Script → Bridge und Log-Capture sind **silent-broken** (kein Error-Message, nur fehlende Funktionalität).
**Vorschlag:** `html.replace(/<head[^>]*>/i, '<head>$1' + scripts)` bzw. `html.includes(/<head/i)` mit Fall-insensitivem RegExp.

---

## FUND 16 — [web/src/core/window_manager.ts:573-616] Schweregrad: NIEDRIG
**Snap-Zonen nutzen `clientX/clientY` (viewports), `chromeBounds` arbeitet mit `window.innerHeight`**
`getSnapZone` (Zeile 595-616) nutzt `clientX <= snapThreshold` und `clientY <= snapThreshold` — das sind **Viewports**koordinaten. `chromeBounds` (Zeile 560-571) nutzt `window.innerHeight`. `.wm-desktop` ist in `.wm-root` absolutes positioniert — wenn `.wm-root` nicht die komplette Viewports abdeckt (z. B. App-Header oben, Dock unten), ist die Snap-Logik unscharf: ein Fenster, das am Top Edge der `.wm-desktop` geklickt wird, wird nicht zwingend am Top Edge der Viewports erkannt.
**Vorschlag:** `getSnapZone` soll `.wm-desktop.getBoundingClientRect()` verwenden und die Thresholds relativ dazu berechnen; `chromeBounds` sollte die tatsächliche `.wm-root`-Größe messen, nicht `window.innerHeight`.

---

## FUND 17 — [web/src/components/ChatPanel.ts:195-214] Schweregrad: NIEDRIG
**`appendUser` kopiert Base64-`dataURL` per `innerHTML` in das DOM — Speicherbloat bei großen Anhängen**
Zeile 203: `html += \`<img src="${escapeHtml(a.content)}" …\`` — `a.content` ist eine Base64-`dataURL` (bis 10 MB → ~14 MB Base64). `el.innerHTML = html` erzeugt einen ~14 MB-String in JS-Heaps, dann parst der Browser das `img` aus dem HTML. Bei 10 großen Anhängen pro Sitzung: hundert MB-String im DOM, `scrollToBottom` wird langsamer (Layout-Reflow auf 100 MB-HTML-Dokument).
**Vorschlag:** `img`-Element via DOM-API erzeugen (`const img = document.createElement('img'); img.src = a.content;`), nicht per `innerHTML`.

---

## Zusammenfassung (3 Sätze)

Die kritischsten Funde sind das Fehlen einer `event.source`-Prüfung in `RenderPanel`'s `message`-Listener (KRITISCH, HOCH), das Fehlen von `try/catch` um `releasePointerCapture` in `window_manager` (HOCH), und das ungesicherte `innerHTML` für `title`/`icon` in `window_manager` (HOCH, XSS). Zusätzlich gibt es Race Conditions bei asynchronen `onClose`-Callbacks (HOCH), bei Chat-Stream-Timern (MITTEL), und bei `attachments`-Referenzübergaben (MITTEL), sowie ein fehlender `destroy()`-Methodus in `RenderPanel` und `window_manager`, der zu Memory-Leaks bei Fensterschließung führt (HOCH/NIEDRIG). Insgesamt: Die Architektur ist sauber, aber es fehlen defensive Guards (null-Checks, `try/catch`, `destroy()`, `event.source`-Prüfung) an den kritischen Stellen.
