[0m
> build · ollama/qwen3.8:27b
[0m
[0m# [0mTodos
[•] README/repo structure & window_manager.ts lesen
[ ] Flow (a) Fenster-Lebenszyklus nachverfolgen (open/focus/drag/resize/z-order/close/dispose)
[ ] Flow (b) Chat-Flow (Input+Anhänge, send, stream, tool-status, abort, debounce/timer)
[ ] Flow (c) App-Start-Flow (Store install/launch/iframe/worker/bridge/schließen)
[ ] Flow (d) Mobile Touch/Viewport/Keyboard
[ ] Vollständiges Review mit Zeilennummern schreiben
[0m
[0m→ [0mRead web/src/core/window_manager.ts
[0m✱ [0mGlob "web/src/apps/**/*.ts"[90m 6 matches[0m
[0m→ [0mRead web/src/components/ChatPanel.ts
[0m→ [0mRead web/src/components/RenderPanel.ts
[0m
[0m$ [0mwc -l web/src/components/OnboardingWizard.ts web/src/apps/ExplorerApp.ts web/src/apps/TextEditorApp.ts web/src/apps/AppStoreApp.ts web/src/apps/SettingsApp.ts web/src/apps/ChatApp.ts web/src/apps/ProgramApp.ts web/src/types/index.ts 2>/dev/null; ls web/src/
279 web/src/components/OnboardingWizard.ts
   875 web/src/apps/ExplorerApp.ts
   599 web/src/apps/TextEditorApp.ts
   449 web/src/apps/AppStoreApp.ts
   326 web/src/apps/SettingsApp.ts
   177 web/src/apps/ChatApp.ts
   193 web/src/apps/ProgramApp.ts
   230 web/src/types/index.ts
  3128 total
apps
components
core
i18n
main.ts
styles
types
utils
version.ts
[0m
[0m→ [0mRead web/src/apps/ChatApp.ts
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/components/OnboardingWizard.ts
[0m
[0m$ [0mls web/src/core web/src/apps; ls web/src
web/src/apps:
AppStoreApp.ts
ChatApp.ts
ExplorerApp.ts
ProgramApp.ts
SettingsApp.ts
TextEditorApp.ts

web/src/core:
AppController.ts
agent.ts
appManifest.ts
app_store_db.ts
backup.ts
cors_fetch.ts
db.ts
global_errors.ts
llm_client.ts
logger.ts
memory.ts
presets.ts
prompt_builder.ts
refs
slash_commands.ts
sounds.ts
theme.ts
tools
uuid.ts
window_manager.ts
workspace.ts
apps
components
core
i18n
main.ts
styles
types
utils
version.ts
[0m
[0m$ [0mwc -l web/src/core/AppController.ts web/src/main.ts web/src/core/agent.ts web/src/apps/ProgramApp.ts web/src/core/appManifest.ts
641 web/src/core/AppController.ts
   11 web/src/main.ts
  709 web/src/core/agent.ts
  193 web/src/apps/ProgramApp.ts
   94 web/src/core/appManifest.ts
 1648 total
[0m
[0m→ [0mRead web/src/apps/ProgramApp.ts
[0m→ [0mRead web/src/core/AppController.ts
[0m→ [0mRead web/src/main.ts
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m→ [0mRead web/src/apps/TextEditorApp.ts
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m✱ [0mGrep "RenderPanel|new SessionPanel|bridgeProxyScript|saveCheckpoint"[90m in . · 11 matches[0m
[0m→ [0mRead web/src/core/llm_client.ts
Ich habe alle vier Flüsse vollständig durch den echten Code verfolgt (window_manager, ChatPanel/ChatApp, Agent/llm_client, App Store/ProgramApp/Explorer/TextEditor, Onboarding, Mobile-Pfade). Hier das Review:

# Code-Review — FUNKTIONSDIMENSION „GUI & USER-INTERACTION"

## FLOW (a) — FENSTER-LEBENSZYKLUS

**[HIGH] F1 — Fenster-Schließen läuft NICHT durch die dispose/unmount-Kette; App-Listener-Leak**
`web/src/core/window_manager.ts:289-304` (`closeWindow`): Es wird `app?.onClose()` aufgerufen und — falls bestätigt — `win.element.remove()`; **`app.unmount()` wird nie aufgerufen**. `onClose()` ist eine Opt-in-Methode, die viele Apps nicht implementieren (z. B. `ProgramApp.ts:186-192` rät nur, `element.removeEventListener` zu entfernen, wenn das Fenster tatsächlich geschlossen wird). Damit:
- `ProgramApp.ts:179-184` (`onBlur` entfernt den `window.addEventListener('message', …)`-Listener) — wird **nie** aufgerufen, weil `unmount()` nicht existiert. Jeder geschlossene Program-Window hinterlässt einen `window`-Listener, der auf die totes `iframe.contentWindow` prüfen lässt (leak).
- `ExplorerApp.ts:88-100` (`unmount:` entfernt `document click/keydown`, `setTimeout`, ContextMenu) — wird nie aufgerufen, weil `window_manager.ts` nie `unmount()` aufruft. `closeContextMenu()` und der `document`-Listener bleiben an; nach X geschlossenen Explorern gibt es X aktive `document`-Listener.
- `AppStoreApp.ts:70-73` (`unmount:` `clearInterval`) — nie aufgerufen; das 30-s-Refresher-`setInterval` läuft **ewig** weiter, obwohl das Fenster zu ist. `web/src/apps/AppStoreApp.ts:103-110`.

**[MED] F2 — `openWindow` erzeugt pro Aufruf ZWEI App-Instanzen (Factory-Doppelaufruf)**
`web/src/core/window_manager.ts:139` (`const app = factory();`) und vorher `registerApp` (window_manager.ts:111-120) rief `factory()` bereits einmal auf, um `metadata` zu holen (`this.apps.set(appId, { factory, … })` — factory bleibt referenziert, wird aber bei jedem `openWindow` erneut aufgerufen, window_manager.ts:139). Pro Fenster entstehen 2 Instanzen; die erste ist ein Leck. Bei Apps mit State im Constructor (z. B. `AppStoreApp` mit seiner Refresher-Timer-Logik) ist das ein doppelter State.

**[MED] F3 — `closeWindow` bei `onClose === false`: Fenster bleibt, aber `activeWindowId` nicht aktualisiert; bei `minimized`-Fenster kein Fokus**
- `window_manager.ts:293-297`: Wenn `onClose()` `false` zurückgibt (TextEditor mit unspeichern Content, `web/src/apps/TextEditorApp.ts:589-594`), wird `return false` ausgeführt — **aber** der Fenster-Klick auf „×" ist bereits erfolgt und `focusWindow` war vorher aufgerufen worden. Das Fenster bleibt offen, der Nutzer bekommt keinen visuellen Hinweis, was abgebrochen wurde (nur ein `window.confirm` vorher). Kein Fehler, aber UX-Fall.
- `window_manager.ts:306-318`: Nach `closeWindow` wird `activeWindowId = null` gesetzt und dann das *höchste* `zIndex`-Fenster fokussiert. Das funktioniert, aber **wenn das geschlossene Fenster das einzige offene war**, bleibt `activeWindowId = null`; `updateDock` wird darauf basierend gerendert (window_manager.ts:437-466) — korrekt, aber `launchOrFocus` für eine App mit mehreren Fenstern würde immer das *erste* in Iterations-Reihenfolge fokussieren (window_manager.ts:280-285), nicht das zuletzt geöffnete. Inkonsequenz.

**[LOW] F4 — `zCounter` wächst monoton; `focusWindow` pro Klick `++zCounter`; keine Upper-Bound/Reset**
`window_manager.ts:391-392`: Bei jedem Fokus-Einklick steigt `zCounter`. Nach tausenden Wechseln ist `zIndex` eine große Zahl (noch CSS-Integer-sicher, aber ein möglicher Leak von CSS-Rendering-Performance, da `z-index` in `style` gesetzt wird). Kein akuter Bug, aber ein Hinweis auf fehlendes Recycling.

**[LOW] F5 — `startDrag`/`startResize` entfernen `pointercancel`-Listener, rufen aber `releasePointerCapture` nur auf `e.target`, nicht auf dem capture-Element**
`window_manager.ts:525-555` (`startDrag`) und `638-664` (`startResize`): `(ev.target as HTMLElement).releasePointerCapture(e.pointerId)` — `ev.target` bei `pointerup` kann **ein anderes** Element sein als `e.target` bei `pointerdown` (z. B. wenn sich das Fenster während des Drags bewegt). `releasePointerCapture` auf dem falschen Element ist ein no-op; der `setPointerCapture` von `pointerdown` (window_manager.ts:530 bzw. 643) bleibt aktiv und der `document`-Listener wird nur einmalig entfernt. Kein Crash, aber ein mögliches „Stickiness"-Verhalten.

---

## FLOW (b) — CHAT-FLOW

**[HIGH] F6 — Kein Input-Lock während Laufzeit; Textarea bleibt editierbar, nur der Send-Button wird zum Stop-Button**
`web/src/components/ChatPanel.ts:53-59` (`sendBtn`-Click liest `this.isStopped` — das ist falsch benannt, es bedeutet *ist running* — und ruft `onStop`, wenn true, sonst `send()`); `web/src/components/ChatPanel.ts:386-393` (`setRunning(r)` setzt `this.isStopped = running`). **Die Textarea `inputEl` ist nie `disabled`** — der Nutzer kann während einer laufenden LLM-Antwort weiter tippen und Enter drücken. `ChatPanel.ts:41-47` (keydown: nur `Enter && shiftKey` sendet; sonst Newline) — also kein versehentliches Senden, aber `ChatPanel.ts:105-115` (`send()`) hat **keinen** `isStopped`-Guard: Wenn `onSubmit` direkt aus einem Programm-Path oder Test aufgerufen wird, wird `send()` trotz `isStopped === true` ausgeführt. Der eigentliche Guard sitzt in `AppController.ts:461-464` (checkt `this.isRunning && this.agent` → `appendError('thinking…')`). Das ist ein Schutzbalkon, aber die UI selbst (ChatPanel) gibt **keinen** Hinweis, dass Input während `running` blockiert ist — `inputEl.value` bleibt editierbar, nur `appendUser` wird nicht aufgerufen.

**[MED] F7 — `streamRenderTimer`-Debounce: Wenn `appendStreamDelta` nach `finalizeStream` kommt, geht der finale Delta-Chunk verloren**
`web/src/components/ChatPanel.ts:273-292` (`appendStreamDelta` bucht einen `setTimeout(50)`-Timer) und `298-313` (`finalizeStream` macht `clearTimeout` + synchron re-render). **Aber** wenn `finalizeStream()` aufgerufen wird, *während* der 50-ms-Timer noch läuft (z. B. durch `appendAssistant` vom Agent `message`-Event, `web/src/core/AppController.ts:295-304`), wird der Timer abgebrochen und synchron geflusht — das ist korrekt. Der eigentliche Fehler: `ChatPanel.ts:283-290` — `setTimeout(() => { … this.streamRenderTimer = null; }, 50)`. Wenn in dieser 50 ms `appendStreamDelta` erneut aufgerufen wird, wird `clearTimeout(this.streamRenderTimer)` (Zeile 283) aufgerufen **bevor** der alte Timer seinen Callback ausgeführt hat — korrekt. Der eigentliche Edge-Fall: `finalizeStream()` (ChatPanel.ts:300-307) setzt `this.streamRenderTimer = null` **nach** `clearTimeout` — korrekt. Kein Bug hier, aber `ChatPanel.ts:190-193` (`clear()`) setzt `this.streamEl = null` **ohne** `finalizeStream()` zu rufen und **ohne** den Timer zu löschen — ein laufender 50-ms-Timer findet `this.streamEl` als `null`, rendert nichts, setzt `streamRenderTimer = null` — **aber** falls `appendUser`/`appendAssistant` in der Zwischenzeit aufgerufen hat, ist die UI konsistent. **Wirklicher Bug**: `clear()` lässt einen ausstehenden `streamRenderTimer` laufen; falls in dieser Zeit ein `appendStreamDelta` eintrifft (Agent-Event-Race), wird `startStream()` (ChatPanel.ts:276-277) aufgerufen und ein neues stream-Element erzeugt — für eine *geklärte* Conversations.

**[HIGH] F8 — `appendStreamDelta` nach `finalizeStream` erzeugt ein zweites Assistant-Stream-Element (UI-Duplikat)**
`web/src/components/ChatPanel.ts:273-292`: Wenn `this.streamEl == null` (nach `finalizeStream()`), ruft `appendStreamDelta` `startStream()` erneut. `web/src/core/AppController.ts:305-307` (`stream_delta`-Handler) und `web/src/core/agent.ts:339-350` (`onDelta` → `emit('stream_delta')`) — wenn das LLM-Stream in `llm_client.ts:236-241` noch einen `delta` liefert, *nachdem* der `response.tool_calls`-Pfad in `agent.ts:411-440` bereits `appendToolCall` aufgerufen hat (was `finalizeStream` auslöst, `ChatPanel.ts:315-332`), erzeugt jeder weitere `stream_delta` ein **zweites** `msg-assistant`-Element mit `data-streaming="true"`. Für Models, die nach tool_calls noch Text streamen, ist das ein sichtbarer UI-Bug (doppelte Antwort-Bubble).

**[MED] F9 — `appendToolResult` bei fehlendem `data-tool-call-id` fällt auf `lastElementChild` zurück — kann ein falsches Element treffen**
`web/src/components/ChatPanel.ts:334-364`: Wenn `id` leer ist **und** das letzte Element nicht ein `msg-tool` ist, wird ein neues `msg-tool-result`-Div angehängt (ChatPanel.ts:356-362). Das ist ein Fallback, aber bei `resumeSession` (AppController.ts:406-408, `appendToolMessage`) werden *alle* tool results nacheinander angehängt; wenn ein `tool_call`-Element vorher entfernt wurde (z. B. durch `clear()`), verweisen die IDs in `data-tool-call-id` auf nichts. `appendToolResult` findet kein passendes `<details>` und der Fallback erzeugt ein Orphan-Result.

**[LOW] F10 — `scrollToBottom(force=false)`-Heuristik (near-bottom < 80 px) kann bei langen Antworten „hängen"**
`web/src/components/ChatPanel.ts:429-437`: Wenn der Nutzer während des Streams 100 px nach oben gescrollt ist, stoppt das Auto-Scroll. Bei der nächsten `appendStreamDelta` mit `scrollToBottom()` (ChatPanel.ts:291, `force=false`) wird nicht gescrollt — korrekt. `appendStreamDelta` mit `scrollToBottom()` ohne `force` (ChatPanel.ts:291) ist *nicht* forced, `appendToolResult` (ChatPanel.ts:363) und `appendError` (ChatPanel.ts:372) sind forced. Konsistent, aber `appendUser` (ChatPanel.ts:213) ist forced — korrekt.

---

## FLOW (c) — APP-START-FLOW (Store → Install → Launch → Bridge)

**[HIGH] F11 — `AppStoreApp.load()`-Refresh-Loop läuft nach `unmount` weiter; kein `clearInterval` auf Fenster-Schließen**
`web/src/apps/AppStoreApp.ts:103-110` (`startRefreshLoop` setzt `setInterval(30s)`) und `70-73` (`unmount:` ruft `stopRefreshLoop()` auf). Da `window_manager.ts:289-304` **nie** `unmount()` auf ruft (siehe F1), läuft das `setInterval` nach Fenster-Schließen **ewig** weiter, ruft `load()` auf 30-s-Rhythmus, was `fetch()` zu GitHub auslöst (AppStoreApp.ts:86-89) und `bridge({type:'listFiles'})` (AppStoreApp.ts:120). Das ist ein dauerhafter Netzwerk-Blast und ein Leck.

**[MED] F12 — `ProgramApp.render()` hängt pro `setContent`/`setData` einen neuen `window 'message'`-Listener an, ohne den alten zu entfernen, solange das Fenster offen ist**
`web/src/apps/ProgramApp.ts:54-88` (`render()` erzeugt ein neues `iframe`, `window.addEventListener('message', this.messageHandler)` auf Zeile 87) — jede `setData`/`setContent` (ProgramApp.ts:41-52) ruft `render()` erneut auf, das ein *neues* `messageHandler` erzeugt und es *neu* an `window` registriert. Der **alte** Handler wird **nicht** entfernt (nur `onBlur`/`onClose` entfernen ihn, ProgramApp.ts:179-192). Bei einem Fenster mit N `setData`-Aufrufen gibt es N aktive `window-message`-Listener, von denen alle auf `this.iframe?.contentWindow` prüfen — der erste (veraltete) `iframe` ist zwar `null` (da `render()` `this.iframe` überschreibt, Zeile 61), aber `this.iframe?.contentWindow` auf *neue* Refs… tatsächlich: `this.iframe` wird in `render()` gesetzt (ProgramApp.ts:61); der alte Handler hat eine **eingefangene** `this.iframe` — nein, `this` ist eine Referenz, nicht der Wert. Alle Handler lesen `this.iframe` zur Laufzeit, d. h. alle N Handler zeigen auf *denselben* `iframe.contentWindow`. **Konsequenz**: Jede `vibeAgentGo`-Message wird N-mal verarbeitet (N = Anzahl `render`-Aufrufe im Leben des Fensters). `onBridgeRequest` wird N-mal aufgerufen → z. B. `writeFile` N-mal geschrieben. **Doppelte/n-fache Bridge-Ausführung** — das ist ein realer Funktions-Bug.

**[MED] F13 — `AppStoreApp.launch()` (`web/src/apps/AppStoreApp.ts:252-254`) ruft `bridge({type:'launchApp'})` auf, das in `AppController.ts:259-264` `wm.launchOrFocus(app.id)` aufruft. `launchOrFocus` fokussiert das *erste* Fenster mit dieser `appId` (window_manager.ts:280-285) — aber `launchApp` für eine **installierte** App mit `mount`-Factory (AppController.ts:607-629) erzeugt ein `ProgramApp` mit `app.permissions` — `ProgramApp.ts:75` prüft `this.allowedPermissions && !this.allowedPermissions.includes(req.type)`. Wenn `app.permissions` ein leeres Array ist, ist `allowedPermissions` truthy (`[]` ist truthy) und `includes(req.type)` ist immer `false` → **jede** Bridge-Request wird mit „Permission denied" abgelehnt, selbst wenn die App gar keine Permissions deklariert hat. Korrekt ist: leere Permissions = keine Einschränkung. Das ist ein Bug in der Permission-Logik.**

**[MED] F14 — `ProgramApp`-`iframe` wird bei `setContent`/`setData` **neu erzeugt** — jede `run_app`-Aufruf oder `setData` zerstört den vorherigen `iframe`-State, auch wenn `title` gleich ist; kein Diffing.**
`web/src/apps/ProgramApp.ts:54-88`: `container.innerHTML = ''` (Zeile 55) entfernt das alte `iframe`; `document.createElement('iframe')` (Zeile 61) erzeugt ein neues. Wenn ein `run_app`-Tool zweimal mit demselben `title` aufgerufen wird (z. B. Agent rendert ein UI, dann ein Update), wird das `iframe` neu geladen — der vorherige JS-State (Formulare, Scroll-Position) ist verloren. Erwartetes Verhalten für ein „Update" wäre ein `srcdoc`-Update auf demselben `iframe`.

**[LOW] F15 — `ProgramApp.wrapHtml` injectiert `window.config` (AppController-config) mit `apiKey: '[REDACTED]'` in jeden Sandbox-`iframe`-App; `corsFetch`-Proxy ist für alle Apps sichtbar**
`web/src/apps/ProgramApp.ts:90-176`: `safeConfig` (Zeile 92) enthält `baseUrl`, `model`, `searchProvider`, etc. — das ist für Apps mit `getConfig`-Permission redundant, aber wird **auch** ohne Permission injiziert (Zeile 155 `window.config = ${configJson}`). Eine Malicious-App könnte `window.config.apiKey` lesen (erhalte `[REDACTED]`, aber `baseUrl` + `model` sind exponiert). Das ist ein minimales Information-Leak.

---

## FLOW (d) — MOBILE (Touch / Viewport / Keyboard)

**[MED] F16 — Mobile `wm-spaces`-Scroll: `scrollIntoView` mit `behavior:'smooth'` (window_manager.ts:496) + `isProgrammaticScroll`-Guard 400 ms (window_manager.ts:491-501) — wenn der Nutzer während der 400 ms manuell scrollt, wird der `scroll`-Event auf Zeile 60-65 *verworfen* (`return`) → `updateActiveSpaceOnScroll` wird nicht aufgerufen, das *falsche* Space bleibt aktiv. Nach 400 ms ist der Guard reset, aber der nächste `scroll`-Event (debounced 120 ms) korrigiert es. Zwischen 0–520 ms kann die UI am falschen Space stehen.**

**[MED] F17 — Mobile Keyboard-Überlagerung: `wm-space`-Elemente haben `height` per CSS (vermutlich `100dvh` oder `100vh`); wenn die Soft-Keyboard das Viewport reduziert, wird `chromeBounds().availableHeight` (window_manager.ts:567-572) nicht neu berechnet, weil `resize`-Event (window_manager.ts:67-70) nur bei *Fenster*-Resize, nicht bei `visualViewport`-Resize (Keyboard) feuert. `reflowMaximizedWindows` (window_manager.ts:469-481) ist mobile-irrelevant (Frühe Rückgabe, Zeile 470). Die Chat-`textarea` (`ChatPanel.ts:37-39`) + `autoResize` (ChatPanel.ts:100-103) wächst mit `scrollHeight` — wenn das Keyboard die Viewport-Höhe reduziert, bleibt die `textarea` auf ihrer alten `height`, und `scrollToBottom` (ChatPanel.ts:434-437) scrollt an `scrollHeight` vorbei. **Kein `visualViewport.addEventListener('resize')`** in ChatPanel oder window_manager.**

**[MED] F18 — `ChatApp.toggleSessions` (`web/src/apps/ChatApp.ts:67-77`) + `backdrop` (ChatApp.ts:56-57): Auf Mobile (≤ 640 px, ChatApp.ts:30) schließt der `backdrop`-Klick den Drawer. Aber `ChatApp.ts:74-76` — `if (next) this.sessionPanel.open();` — wenn der Drawer bereits offen ist und `backdrop` geklickt wird, wird `toggleSessions(false)` aufgerufen, `next = false`, `sessionPanel.open()` **nicht** aufgerufen. Korrekt. **Aber**: `ChatApp.ts:82-88` (`mount`) ruft `this.sessionPanel.open()` auf **und** `if (window.innerWidth > 640) this.toggleSessions(true)`. Auf Mobile: `sessionPanel.open()` wird aufgerufen (lädt Sessions), der Drawer bleibt geschlossen. Das ist korrekt, aber `sessionPanel.open()` ist ein `async`-Call? — wenn es `fetch`/`localStorage` macht, ist der Call während `mount` (synchron) ein Race: Der `SessionPanel`-Constructor + `open()` wird in `mount` (ChatApp.ts:82) aufgerufen, **bevor** das Fenster fokussiert wurde (`focusWindow` kommt nach `mount` in window_manager.ts:231-268). Wenn `open()` ein `setState`/`render` triggert, das auf `this.element` operiert, das erst in `mount` in den DOM eingebunden wurde (ChatApp.ts:81 `container.appendChild(this.element)`) — korrekt, aber `sessionPanel.open()` wird **zweimal** aufgerufen: einmal in `mount` (ChatApp.ts:82), und ein zweites Mal in `toggleSessions(true)` (ChatApp.ts:75), wenn der Nutzer auf Mobile auf den Hamburger klickt. `SessionPanel.open()` ist idempotent? — unklar, möglicher doppelter `fetch`.**

**[LOW] F19 — `wm-space-bar`-Schließen-Button (`web/src/core/window_manager.ts:161-166`): `e.stopPropagation()` + `closeWindow(id)`. Auf Mobile kann ein kurzer Touch den Button treffen **und** gleichzeitig einen `pointerdown` auf `wm-space` triggern, das `focusWindow` aufruft (window_manager.ts:226 `element.addEventListener('pointerdown', () => this.focusWindow(id))`) — aber das ist das *gleiche* Element, also wird das Fenster *geclosed* und *gefokussiert* in derselben Microtask. `focusWindow` nach `closeWindow` → `win = this.windows.get(id)` ist `null` (window_manager.ts:379-380) → `return`. Kein Crash, aber ein unnötiger Fokus-Event.**

---

## ZUSAMMENFASSUNG (3 Sätze)

Die UI-Robustheit ist **durchwachsen**: Der Fenster-Lebenszyklus (open/focus/drag/resize/close) ist funktional stabil, aber das **Fehlern des `unmount()`-Aufrufs in `window_manager.ts:closeWindow`** lässt `document`-, `window`- und `DOM`-Listener in geschlossenen Fenstern zurück (F1) und hält `setInterval`-Loops (F11) am Leben — das ist der schwerwiegendste Robustheits-Defekt. Im Chat-Flow ist die Input-Sperre **inkonsistent** (F6: `isStopped`-Flag nur im Send-Button, nicht in der Textarea) und das `streamRenderTimer`-Debounce + `finalizeStream`-Race (F7/F8) kann bei Models mit post-tool-calls-Tailing-Text **doppelte Assistant-Bubbles** erzeugen. Der App-Start-Flow hat einen **echten Funktions-Bug**: `ProgramApp.render()` akkumuliert `window-message`-Listener pro `setData`-Call (F12) und die Permission-Logik (F13) lehnt **alle** Bridge-Requests für Apps mit leeren Permissions ab; auf Mobile fehlen `visualViewport`-Handler (F17), sodass die Keyboard-Überlagerung die Chat-Viewport nicht anpasst. In Summe: Die UI **funktioniert** in den Happy-Paths, bricht aber bei Abbruch, parallelen Aufrufen, Fenster-Schließen während laufender Aktionen und Mobile-Keyboard **nicht sauber** auf.
