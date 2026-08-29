[0m
> build · ollama/qwen3.8:27b
[0m
[0m→ [0mRead web/src/apps/ExplorerApp.ts
[0m→ [0mRead web/src/apps/TextEditorApp.ts
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m→ [0mRead web/src/core/appManifest.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m→ [0mRead web/src/types/index.ts
[0m✱ [0mGrep "onClose|unmount|destroy"[90m in web/src · 6 matches[0m
[0m
[0m$ [0mls /root/vibeAgentGo/web/src/core /root/vibeAgentGo/web/src
/root/vibeAgentGo/web/src:
apps
components
core
i18n
main.ts
styles
types
utils
version.ts

/root/vibeAgentGo/web/src/core:
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
[0m
[0m→ [0mRead web/src/core/window_manager.ts[90m [offset=270, limit=60][0m
[0m
[0m$ [0mgrep -n "addEventListener\|setInterval\|setTimeout\|removeEventListener" /root/vibeAgentGo/web/src/components/MemoryPanel.ts | head -30
63:        btn.addEventListener('click', async (e) => {
[0m
[0m$ [0mgrep -rn "parseAppManifest\|injectAppManifest" /root/vibeAgentGo/web/src --include="*.ts" | grep -v appManifest.ts; grep -n "installApp\|launchApp" /root/vibeAgentGo/web/src/core/db.ts /root/vibeAgentGo/web/src/apps/ProgramApp.ts 2>/dev/null | head -20
/root/vibeAgentGo/web/src/core/app_store_db.ts:8:import { parseAppManifest, type AppManifest } from './appManifest.js';
/root/vibeAgentGo/web/src/core/app_store_db.ts:39:      const parsed = parseAppManifest(entry.content);
/root/vibeAgentGo/web/src/core/app_store_db.ts:103:    const parsed = parseAppManifest(res.data);
/root/vibeAgentGo/web/src/core/tools/app_store_tools.ts:8:import { parseAppManifest, injectAppManifest } from '../appManifest.js';
/root/vibeAgentGo/web/src/core/tools/app_store_tools.ts:207:    const parsed = parseAppManifest(htmlContent);
/root/vibeAgentGo/web/src/core/tools/app_store_tools.ts:237:    const targetHtml = injectAppManifest(htmlContent, manifest);
[0m
[0m$ [0mgrep -n "addEventListener\|setInterval\|setTimeout\|window\.\|document\." /root/vibeAgentGo/web/src/components/SettingsLLMSection.ts /root/vibeAgentGo/web/src/components/SettingsSearchSection.ts /root/vibeAgentGo/web/src/components/SettingsBackupSection.ts /root/vibeAgentGo/web/src/components/SettingsDangerZoneSection.ts /root/vibeAgentGo/web/src/components/SettingsWorkspaceSection.ts | head -30; echo ---; grep -n "open()\|open(" /root/vibeAgentGo/web/src/components/MemoryPanel.ts | head
/root/vibeAgentGo/web/src/components/SettingsLLMSection.ts:136:  providerSelect.addEventListener('change', () => applyProviderPreset(providerSelect.value));
/root/vibeAgentGo/web/src/components/SettingsLLMSection.ts:137:  apiKeyInput.addEventListener('input', updateVerifyButton);
/root/vibeAgentGo/web/src/components/SettingsLLMSection.ts:140:  verifyBtn.addEventListener('click', async () => {
/root/vibeAgentGo/web/src/components/SettingsSearchSection.ts:41:  providerSelect.addEventListener('change', updateVisibility);
/root/vibeAgentGo/web/src/components/SettingsBackupSection.ts:38:  exportBtn?.addEventListener('click', async () => {
/root/vibeAgentGo/web/src/components/SettingsBackupSection.ts:43:      const a = document.createElement('a');
/root/vibeAgentGo/web/src/components/SettingsBackupSection.ts:46:      document.body.appendChild(a);
/root/vibeAgentGo/web/src/components/SettingsBackupSection.ts:56:  importBtn?.addEventListener('click', () => importFile?.click());
/root/vibeAgentGo/web/src/components/SettingsBackupSection.ts:57:  importFile?.addEventListener('change', async (e) => {
/root/vibeAgentGo/web/src/components/SettingsBackupSection.ts:68:      setTimeout(() => handlers.onReload(), 800);
/root/vibeAgentGo/web/src/components/SettingsDangerZoneSection.ts:31:  resetBtn.addEventListener('click', () => {
/root/vibeAgentGo/web/src/components/SettingsDangerZoneSection.ts:36:  resetCancel.addEventListener('click', () => {
/root/vibeAgentGo/web/src/components/SettingsDangerZoneSection.ts:41:  resetConfirmBtn.addEventListener('click', async () => {
/root/vibeAgentGo/web/src/components/SettingsWorkspaceSection.ts:76:      btn.addEventListener('click', () => {
/root/vibeAgentGo/web/src/components/SettingsWorkspaceSection.ts:85:      btn.addEventListener('click', () => {
/root/vibeAgentGo/web/src/components/SettingsWorkspaceSection.ts:98:      btn.addEventListener('click', async () => {
/root/vibeAgentGo/web/src/components/SettingsWorkspaceSection.ts:126:  createBtn?.addEventListener('click', doCreate);
/root/vibeAgentGo/web/src/components/SettingsWorkspaceSection.ts:127:  nameInput?.addEventListener('keydown', (e) => {
---
19:  open() {
[0m
[0m→ [0mRead web/src/components/MemoryPanel.ts[90m [offset=1, limit=70][0m
# Code-Review — Apps (Explorer, TextEditor, AppStore, Settings, appManifest)

## ExplorerApp.ts

**SECTION [web/src/apps/ExplorerApp.ts:77-80] — KRITISCH**
DOM-Leak: Im Konstruktor werden `document.addEventListener('click', …)` und `document.addEventListener('keydown', …)` registriert, aber nie wieder entfernt (keine `unmount()`/`destroy()`-Methode, keine gespeicherten Handler-Referenzen). Da der WM das Element bei Fensterschließung nur mit `element.remove()` aus dem DOM nimmt (window_manager.ts:298) und die App-Instanz verworfen wird, bleiben diese document-weiten Listener permanent im Speicher; jede neu geöffnete Explorer-Instanz fügt weitere hinzu. **Vorschlag:** Gekapselte Handler-Referenzen speichern, `document.removeEventListener` in einer `unmount()`/`destroy()`-Methode aufrufen (bevorzugt: Listener an `this.element` statt `document` hängen) und die Methode aus `window_manager.closeWindow` aufrufen.

**SECTION [web/src/apps/ExplorerApp.ts:131, 145] — MITTEL**
Fehlerbehandlung/Performance: `render()` setzt `this.listEl.innerHTML = ''` und baut anschließend die gesamte Baumstruktur DOM-neu auf — pro Tastendruck im Suchfeld (`build()`, Zeile 71-74), pro Klick auf jedes Element und pro Crumb-Klick (`renderBreadcrumbs`, Zeile 194). Bei großen Workspaces (hunderte Dateien) ist das ein O(n)-Full-Rebuild + GC-Peinlichkeit; zudem verliert das Element bei jedem Rebuild die Fokussierung (z. B. das Search-Input liegt zwar außerhalb, aber `listEl` ist `tabindex=0` und verliert bei jedem Such-Keystroke-Render den Fokus, weil die Child-Elemente neu erzeugt werden). **Vorschlag:** Incrementales Rendering (nutze die bereits gebauten `TreeNode`-Daten, diff gegen `data-path`) oder mindestens: bei Such-Input nur das Suchergebnis-Subset neu rendern und `listEl` erst neu aufbauen, wenn sich tatsächlich die sichtbare Menge ändert; für sehr große Listen Virtualisierung (z. B. nur Sichtbares + Puffer) erwägen.

**SECTION [web/src/apps/ExplorerApp.ts:258] — MITTEL**
Bugs: `renderNode()` erzeugt für erweiterte Ordner eine separate `childrenContainer`-Div und ruft darin rekursiv `renderNode()` auf, übergibt aber denselben `container`-Parameter an die Rekursion — dabei wird `childrenContainer` als lokaler Container verwendet und korrekt behandelt. Der eigentliche Bug: `container.appendChild(el)` an Zeile 303 fügt den Ordner-`el` **vor** `childrenContainer` in `container` ein, die rekursive Schleife an 307-308 verwendet aber `childrenContainer`; da `container` und `childrenContainer` verschiedene Eltern sind, entsteht eine unnötige zusätzliche Wrapper-Ebene pro Ebene (tiefe Verschachtelung) und alle `dragover`-Handler der `attachFolderDragDrop(el, …)` an 375-395 werden auf den **Ordner-El** registriert, nicht auf `childrenContainer` — das ist OK, aber das zusätzliche Wrapper-Div macht die DOM-Tiefe pro Baum-Ebene +1 und erschwert CSS/Event-Delegation. **Vorschlag:** Kinder direkt in `container` anfügen (die Depth-Berechnung über `paddingLeft` bleibt identisch) oder `childrenContainer` eliminieren und stattdessen `container` an die Rekursion übergeben; das entfernt pro Datei-Element eine Div-Ebene.

**SECTION [web/src/apps/ExplorerApp.ts:398-412, 661-677, 679-694, 696-726, 728-747, 749-768] — MITTEL**
Fehlerbehandlung: Alle Mutation-Methode (`moveFileIntoFolder`, `renameFile`, `deleteFolder`, `renameFolder`, `duplicateFile`, `duplicateFolder`) rufen `this.onBridgeRequest?.(…)` **ohne `try/catch`** und prüfen das `BridgeResponse` nicht (`res?.ok`). Ist die Bridge nicht verbunden (`onBridgeRequest = null`) oder liefert sie `{ ok: false }`, werden die Operationen stillschweigend ignoriert, der Nutzer bekommt keinerlei Feedback (z. B. `deleteFile` an Zeile 656 zeigt `confirm`, aber der eigentliche `deleteFile`-Bridge-Aufruf kann schweigen). **Vorschlag:** Gekapselte `private async bridgeCall(req, actionLabel)`-Helfer, der `ok: false` in eine sichtbare Fehlermeldung (z. B. `window.alert` / Statuszeile) umwandelt und bei Fehlern den Zustand nicht aktualisiert (aktuell wird `refresh()` aufgerufen, das den Zustand erneut von der DB lädt — das ist korrekt, aber der Nutzer weiß nicht, dass der erste Schritt fehlgeschlagen ist).

**SECTION [web/src/apps/ExplorerApp.ts:610-631, 633-652] — HOCH**
Fehlerbehandlung: `createFolder()` und `createFile()` akzeptieren `name` aus `window.prompt()` und manipulieren es nur mit `.replace(/^\/+/, '')` / `.replace(/\/+$/, '')` — **keine Validierung gegen Dateinamen wie `../foo`, `..`, absoluten Pfade mit Backslash, `null`-Byten**, und `createFile` setzt keine Grenze dafür, dass der Name ein gültiger Dateiname ist. Ein Nutzer, der `../../etc/evil` eingibt, erzeugt (je nach Bridge-Implementierung) Dateien außerhalb des Workspace-Roots. **Vorschlag:** `name` gegen ein Whitelist-Regex validieren (z. B. `^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$`) und `..` / `\` / `.`-Segment explizit verwerfen; vor `writeFile` in `refresh()`-Zyklus einen `assertSafePath()`-Schritt einbauen.

**SECTION [web/src/apps/ExplorerApp.ts:802-808] — KRITISCH**
XSS-Risiko / Code-Execution: `runHtml()` liest die Datei per Bridge, nimmt `String(res.data)` und ruft `this.onRunApp?.(title, html)` auf. Je nach Umsetzung des `onRunApp`-Handlers (typischerweise Injektion in ein `iframe.srcdoc` oder `innerHTML` des Hauptbereichs) kann jede `.html`-Datei im Workspace **beliebigen JavaScript-Ausführung** im App-Kontext triggern — inklusive Zugriff auf `localStorage`, Config (API-Keys!), und die Bridge. Das ist ein direkter Sandbox-Breakout, wenn die Html-Dateien nicht über die `permissions`-Metadaten (App-Manifest) kontrolliert werden. **Vorschlag:** Vor `onRunApp` die `Application/vnd.vag+json`-Manifest parsen (appManifest.ts `parseAppManifest`) und die deklarierten `permissions` gegen die tatsächlich benötigten prüfen; `iframe` mit `sandbox="allow-scripts allow-same-origin"` nur falls die App explizit `bridge`-Permission deklariert, sonst `sandbox="allow-scripts"` ohne `allow-same-origin` und `onRunApp` mit einem Capability-Token aufrufen statt mit rohem `res.data`.

**SECTION [web/src/apps/ExplorerApp.ts:566-595] — NIEDRIG**
Performance: `iconFor()` baut pro Aufruf einen neuen `Record<string, string>`-Objekt (~120 Einträge) und wird in `renderNode()` (Zeile 317, 233) für jede Datei-Datei aufgerufen. Bei großen Listen wird das pro Render-Zyklus hundertfach neu allokiert. **Vorschlag:** Die Map als `static readonly` oder Modul-Constante hoisten und einmalig pro Build erzeugen.

**SECTION [web/src/apps/ExplorerApp.ts:210] — NIEDRIG**
Performance: `renderDetails()` berechnet `new Blob([file.content]).size` pro Aufruf — für eine große Datei (mehrere MB) ist die Blob-Erzeugung überflüssig, da `file.content.length` (oder `new TextEncoder().encode(file.content).byteLength`) identisches Ergebnis liefert. **Vorschlag:** `file.content.length` (mit `new TextEncoder().encode(file.content).length` falls UTF-16-Surrogate korrekt behandelt werden müssen) verwenden.

## TextEditorApp.ts

**SECTION [web/src/apps/TextEditorApp.ts:127-138] — HOCH**
Performance: `highlightCode()` wird **bei jedem `input`-Event** (Zeile 107) aufgerufen und ruft `Prism.highlight(code, …)` auf dem **vollständigen Dokument** aus — für eine mehrere MB große Datei ist das pro Tastendruck ein kompletter Lexer-Lauf, der die UI-Kennziffern (INP, FCP, Long Tasks) schwerwiegend belastet und zu Multi-Sekunden-Frame-Blocking führt. **Vorschlag:** Highlight-Logik mit `requestAnimationFrame` + Debounce (z. B. 120 ms) auf `input` verzögern, alternativ nur das sichtbare Fenster (viewport-basiertes Slicing) highlighten, oder für Dateien > N kB `Prism.highlight` komplett weglassen und stattdessen `textContent` (Zeile 136) mit einer "large-file" Anzeige nutzen.

**SECTION [web/src/apps/TextEditorApp.ts:152-183] — MITTEL**
Fehlerbehandlung / Memory: `undoStack` ist auf 50 Einträge gedeckelt (gut), aber jeder Eintrag ist eine **vollständige Kopie** der Dokumenttext (`this.textarea.value`), und bei großen Dateien (mehrere MB) × 50 Einträge führt das zu Hunderten von MB zusätzlichen Heap-Drucks. Es gibt auch kein GC-Fenster — `shift()` an Zeile 156 entfernt das älteste Element, aber die String-Kopie an Zeile 155 (`this.undoStack.push(this.textarea.value)`) existiert weiterhin in `textarea.value`, `savedContent`, `currentLang`-Hintergrund und dem Highlight-Overlay, sodass der GC die Strings nicht freigeben kann, solange die App existiert. **Vorschlag:** Undo/Redo-Stapel auf **op-basiert** (Insert/Delete-Deltas statt Volltext-Snapshots) umstellen, oder bei `textarea.value.length > 500 KB` den Snapshot-Budget auf 5–10 verringern; alternativ die Undo-Daten in `IndexedDB` offloaden.

**SECTION [web/src/apps/TextEditorApp.ts:343-346] — MITTEL**
Bugs: `scrollToPosition()` schätzt `topLine = this.textarea.scrollTop / lineHeight` und setzt `this.textarea.scrollTop = Math.max(0, (line - 3) * lineHeight)` — aber `textarea.scrollHeight > clientHeight` ist für die sichtbaren Zeilen relevant und die Formel ignoriert, ob die Zeile bereits sichtbar ist, sowie die `line`-Berechnung (`slice(0, pos).split('\n').length`) ist O(n) pro Aufruf und wird bei jedem `selectMatch` (Zeile 238, 248, 249, 266, 298) und `replaceAll` (Zeile 283) aufgerufen. **Vorschlag:** Die Zeilenzahl vorab in ein Array von `lineStart`-Offsets (einmalig beim Laden/Erzeugen, inkrementell aktualisiert) speichern und `scrollToPosition` über eine Binärsuche über die Offsets bestimmen; die Sichtbarkeitsprüfung gegen `clientHeight`/`lineHeight` korrekt implementieren, nicht gegen `scrollTop/lineHeight`.

**SECTION [web/src/apps/TextEditorApp.ts:252-267] — NIEDRIG**
Bugs: `replaceOneBtn` vergleicht `this.textarea.value.slice(start, end) === query` — wenn der Nutzer die Find-Suche **mit Shift** oder einen anderen Teil markiert hat oder die Markierung länger als die Suche ist, wird die Ersetzung stillschweigend übersprungen (kein Feedback). Zusätzlich rufen beide `replace`-Pfade `findAll()` und `selectMatch(currentIndex + 1)` auf, aber `selectMatch` ruft intern `findAll()` erneut auf (Zeile 239) — doppelte Arbeit. **Vorschlag:** Nach fehlgeschlagener Ersetzung eine kurze Statuszeile ("Selection didn't match query") setzen und den doppelten `findAll`-Aufruf in `selectMatch` entfernen (die Caller rufen `findAll` bereits selbst).

**SECTION [web/src/apps/TextEditorApp.ts:386-414] — MITTEL**
Fehlerbehandlung: `Tab`-Handler ruft `loadConfig()` (Zeile 391) **pro Tab-Keystroke** auf und wertet `config.editorTabSize ?? 2` neu aus. Wenn das Tab-Size im `SettingsApp` geändert wurde, wird das hier **nicht** übernommen (stale value), weil `config` zu `build()`-Zeit einmalig gelesen wurde (Zeile 79). **Vorschlag:** `tabSize` als Mutable-Feld halten und eine `updateTabSize()`-Methode bereitstellen, die von `SettingsApp.saveConfig` über das `settings:reload`-Event (Zeile 54 in SettingsApp) oder einen dedizierten CustomEvent aktualisiert wird.

## AppStoreApp.ts

**SECTION [web/src/apps/AppStoreApp.ts:98-112] — HOCH**
DOM-Leak / Resource-Leak: `startRefreshLoop()` wird in `mount()` aufgerufen, aber **es gibt keine `unmount()`-Methode**, die `stopRefreshLoop()` aufruft. Sobald die AppStore-Fenster geschlossen wird (window_manager.ts:293-301 ruft nur `app?.element?.remove()`), läuft `setInterval` **weiter**, feuert alle 30 s `load()`/`fetch` und referenziert `this` (und damit `element`, `installed`, `store`) — die App-Instanz wird von `instances` gelöscht, aber der Intervall-Callback hält sie per closure fest. **Vorschlag:** `unmount()`/`stopRefreshLoop()` in die `App`-Schnittstelle aufnehmen (oder einen `beforeunload`/`window_closed`-Hook), `window_manager.closeWindow` soll `app?.unmount?.()` aufrufen; alternativ den `setInterval`-Callback mit einem `WeakRef`-Check absichern.

**SECTION [web/src/apps/AppStoreApp.ts:166-201, 203-239] — MITTEL**
Fehlerbehandlung: `install()` und `updateAll()` rufen `this.bridge({ type: 'installApp', app: installed })` auf, prüfen aber das `BridgeResponse` nicht (`res.ok` wird ignoriert). Ein `installApp`-Fehler (DB voll, Netzwerkfehler beim fetch) wird stillschweigend verschluckt, `this.status = 'idle'` wird trotzdem gesetzt (Zeile 195) und der User sieht eine "eingelöste" Installation, obwohl die DB-Leere. **Vorschlag:** `bridge()`-Ergebnis prüfen, bei `ok: false` den Status auf `'error'` setzen mit `message = res.error` und `refreshInstalled()` auslassen (oder das Einträge-Map nicht aktualisieren).

**SECTION [web/src/apps/AppStoreApp.ts:121-124] — MITTEL**
XSS / Datenintegrität: `refreshInstalled()` liest die Datei-`content` und macht `JSON.parse(match[0].replace(/<[^>]+>/g, '').trim())` — der Regex `/[^>]+>` ist fragil (bricht bei `</script>`-String-Value innerhalb der JSON, z. B. `{"description":"a < b"}`) und `JSON.parse`-Fehler werden nur per `try/catch` ohne Meldung geschluckt. Wenn die JSON-Struktur `permissions` als String statt Array liefert, wird das an Zeile 133 als `manifest.permissions || []` behandelt und `renderPermissions(perms: string[])` (Zeile 438) ruft `.length` / `.join` auf — das ist typsicher, aber das `renderPermissions`-Template `perms.join(', ')` (Zeile 440) **ohne `escapeHtml`** injiziert die Permissions direkt in `innerHTML` (Zeile 392, `body.innerHTML`) — wenn eine Malicious App `permissions: ["<img src=x onerror=alert(1)>"]` deklariert, ist das eine XSS. **Vorschlag:** `perms`-Werte per `escapeHtml`-Escape in `renderPermissions` einbauen (`perms.map(escapeHtml).join(', ')`), und die Manifest-Parsing-Logik mit `appManifest.ts` (`parseAppManifest`) konsolidieren, um das fragile `replace(/<[^>]+>/g, '')`-Parsing zu ersetzen.

**SECTION [web/src/apps/AppStoreApp.ts:92-94] — NIEDRIG**
Fehlerbehandlung: `load()`-Catch-Block setzt `message` auf eine i18n-Template mit `e.message`, aber `e` kann z. B. eine `TypeError` aus `res.json()` sein, deren `message` eine nicht-escaped String ist — `this.message` wird später in `grid.innerHTML` per `${escapeHtml(this.message)}` (Zeile 335, 337, 358, 360) eingebettet, das ist OK, aber **`t('appstore.error') || ...`** ist ein antipattern: `t()` liefert einen nicht-empty string auch bei fehlendem Key, daher ist der `|| ...`-Fallback totCode. **Vorschlag:** i18n-`t()`-Funktion mit `t(key, fallback)`-Signatur umziehen oder die Keys garantiert in der Loc-Datei pflegen.

## SettingsApp.ts

**SECTION [web/src/apps/SettingsApp.ts:142-147] — MITTEL**
Bugs: `renderMemoryTab()` erzeugt **pro Tab-Switch** eine neue `MemoryPanel`-Instanz (Zeile 144: `new MemoryPanel()`) und ruft `memoryPanel.open()` (Zeile 146). Wenn der User Memory-Tab → andere Tab → zurück Memory-Tab klickt, werden **zwei** `MemoryPanel`-Instanzen mit jeweils eigenen `MemoryStore`/DB-Handles erzeugt. Die erste Instanz wird nie explizit aufgeräumt (wenn MemoryPanel intern Listener/Intervalls hat — aktuell nicht, aber die `getAllMemory`-Pendant-DB-Queries laufen parallel). **Vorschlag:** `MemoryPanel` als **Singleton** halten (`private memoryPanel?: MemoryPanel`) und pro `renderTab` wiederverwenden (Element wiederbefestigen statt neu erzeugen), oder `memoryPanel.close()`/`destroy()` Methode bereitstellen.

**SECTION [web/src/apps/SettingsApp.ts:57-65] — MITTEL**
Fehlerbehandlung: `mount()` speichert `this.container = container`, aber es gibt **keine `unmount()`-Methode**, die `this.container = null` setzt, und `renderShell()` referenziert `container`. Wenn die App neu gemountet wird (z. B. WM öffnet ein zweites Settings-Fenster), wird `renderShell(this.element)` erneut aufgerufen (Zeile 62), aber `this.element` existiert bereits im DOM (aus `mount()`) und wird mit `container.appendChild(this.element)` erneut eingefügt — das ist DOM-manipulativ korrekt (Move), aber `renderShell(this.element)` setzt `container.innerHTML = …` (Zeile 72) mit `container = this.element`, sodass die Sidebar neu aufgebaut wird — das ist OK, aber die alten `.settings-tab`-Listener aus `renderShell` (Zeile 103-108) sind durch `innerHTML = …` (Zeile 72) automatisch entfernt (gut), **aber** wenn `settings:reload`-Event (Zeile 54, `this.element.dispatchEvent`) von einem **anderen** Tab (z. B. Backup) emittiert wird, während Memory-Panel noch läuft, kann ein race-Condition eintreten. **Vorschlag:** Ein `EventTarget`-Registry (debounced, coalesced) für `settings:reload` einführen und sicherstellen, nur ein einzelnes `SettingsApp`-Fenster existiert (WM-Ebene: `launchOrFocus`-Garde, die bereits existiert, aber `openWindow`-Deduplication prüfen).

**SECTION [web/src/apps/SettingsApp.ts:189-194] — MITTEL**
XSS-Risiko: `renderAppearanceTab()` baut `languageOptions` aus `getAvailableLanguages()` per Template-Literal mit `value="${escapeHtml(l.value)}"` — das ist korrekt escaped. **Aber** wenn `l.label` HTML-Charakteristik enthält, z. B. einen i18n-Wert wie `"en — English (US)"`, ist das OK. Der eigentliche Problem: `getAvailableLanguages()`-Return wird **nicht** auf `value`-Whitelist geprüft, und `setLanguage(language)` (Zeile 234) castet `String` zu `'de' | 'en'` — ein Nutzer, der `value` manipuliert (via DevTools/`<option value="javascript:alert(1)">`), könnte `setLanguage` mit einer falschen Sprache füttern. **Vorschlag:** `language`-Value gegen `['de', 'en']` (die `ALLOWED_LANGUAGES`-Konstante in i18n) validieren, bevor er an `setLanguage` übergeben wird.

## appManifest.ts

**SECTION [web/src/core/appManifest.ts:32-64] — MITTEL**
Fehlerbehandlung: `parseAppManifest()` gibt bei Fehler `{ manifest: undefined as unknown as AppManifest, error }` zurück — der Typspritche `as unknown as AppManifest` ist ein Red Flag und verdeckt einen `null`-Pointer. Der Caller (`app_store_db.ts:39`, `app_store_tools.ts:207`) muss `if (result.error)` prüfen, bevor `result.manifest` verwendet wird — der Type-System bietet keinen Schutz. **Vorschlag:** Einen **discriminated-union** Typ (`type ParseResult = { manifest: AppManifest } | { error: string }`) einführen, damit TS den Fehlerfall erzwingt, und `manifest: undefined as unknown as AppManifest` aus der Codebase entfernen.

**SECTION [web/src/core/appManifest.ts:53-61] — MITTEL**
Fehlerbehandlung: `parseAppManifest()` validiert nur `id`, `name`, `category` — aber **nicht** `version` (SemVer-Format), `permissions` (Muss ein Array sein, nicht String), `icon` (Muss ein gültiges Icon/Emoji sein), `minVibeAgentGo` (SemVer), `description` (Länge-Limit). Eine Malicious App kann `version: "<script>"`, `permissions: {"read": true}` (Object statt Array) deklariert, die dann in `AppStoreApp.renderPermissions` per `.join` (Zeile 440) fehlschlagen oder in die HTML injiziert werden. **Vorschlug:** Eine `validateManifest(parsed)`-Funktion, die `Array.isArray`, `typeof string`, `semver.satisfies` (bzw. ein einfaches Regex `/^\d+\.\d+\.\d+$/`) prüft und bei `version`, `permissions`, `minVibeAgentGo` strikte Typen erzwingt.

**SECTION [web/src/core/appManifest.ts:66-78] — NIEDRIG**
Bugs: `injectAppManifest()` prüft keine **Doppelte-Block**-Injection und die `html.replace(existing[0], block)` (Zeile 71) ist nur einmalig korrekt — wenn die `html`-String eine `</script>`-Tag-Ähnlichkeit innerhalb der JSON-Value hat (z. B. `"description":"foo</script>bar"`), bricht der Regex-Match (Zeile 33, 69) an der ersten `</script>` ab und extrahiert eine unvollständige/ungültige JSON, das `JSON.parse` (Zeile 43) dann fehlschlägt. **Vorschlag:** Die JSON-Extraktion mit einem **string-awareen** Parser (z. B. `JSON.parse` auf dem rohen Block + ein Regex, der `</script>` nur außerhalb von Strings berücksichtigt) statt des simplen `replace(/<[^>]+>/g, '')`-Ansatzes.

---

## Zusammenfassung (3 Sätze)

Die kritischsten Funde sind der **AppStore-Refresh-Loop, der nach Fensterschließung weiterläuft** (AppStoreApp.ts:98), die **ungesicherte `runHtml`-Injektion** in ExplorerApp.ts:802 die jeder `.html`-Datei im Workspace beliebigen Code-Ausführung ermöglicht, und die **fehlende Escape-Logik in `AppStoreApp.renderPermissions`/`refreshInstalled`** die eine Malicious App-Installation zu XSS führen kann. Auf Performance-Ebene blockieren der pro-Keystroke-Prism-Highlight-Lauf in TextEditorApp und der Full-Render pro Such-Keystroke in ExplorerApp die UI bei großen Dateien. Strukturell fehlt eine `unmount()`/`destroy()`-Methode in der `App`-Schnittstelle, die `window_manager.closeWindow` aufrufen sollte, um alle document-weiten Listener, `setInterval`-Loops, und Panel-Instanzen (MemoryPanel, SettingsApp) korrekt freizugeben.
