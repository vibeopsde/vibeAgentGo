[0m
> build · ollama/qwen3.6:35b
[0m
[0m→ [0mRead web/src/core/agent.ts
[0m→ [0mRead web/src/core/llm_client.ts
[0m→ [0mRead web/src/core/prompt_builder.ts
[0m✱ [0mGlob "web/src/core/tools/**/*"[90m 11 matches[0m
[0m→ [0mRead web/src/core/tools/memory_tools.ts
[0m→ [0mRead web/src/core/tools/file_tools.ts
[0m→ [0mRead web/src/core/tools/rename_session.ts
[0m→ [0mRead web/src/core/tools/system_tools.ts
[0m→ [0mRead web/src/core/tools/sys_check.ts
[0m→ [0mRead web/src/core/tools/run_tools.ts
[0m→ [0mRead web/src/core/tools/index.ts
[0m→ [0mRead web/src/core/tools/web_tools.ts
[0m→ [0mRead web/src/core/tools/error_log.ts
[0m→ [0mRead web/src/core/tools/shared.ts
[0m→ [0mRead web/src/core/tools/app_store_tools.ts
### Code-Review CORE: agent.ts, llm_client.ts, prompt_builder.ts + alle Tools

---

### KRITISCH

**[error_log.ts:28] undefinierte Variable `asNumber`**
```typescript
const limit = Math.min(100, Math.max(1, asNumber(args.limit, 20)));
```
`asNumber` ist in shared.js exportiert aber in error_log.ts nicht importiert. Das Tool fällt mit `ReferenceError: asNumber is not defined`.

**[memory_tools.ts:33] undefinierte Variable `asNumber` im Memory-Tool**
Zu prüfen: memory_tools.ts importiert ebenfalls nicht `asNumber` aus shared.js — gleiches Problem wie error_log.ts. Wenn das Memory-Tool mit explizitem Limit aufgerufen wird, crasht es.

---

### HOCH

**[agent.ts:303-306] Fragiles Error-Matching für HTTP-Tryback**
```typescript
if (errMsg.includes('400') && 
    (errMsg.includes('image') || errMsg.includes('Image')) &&
```
String-Comparison auf `message`-Feld ist fehleranfällig: ein 200-OK mit '400' im Text würde fälschlich ausgelöst. Sollte `status === 400` statt substring-Matching prüfen.

**[agent.ts:268] Duplikate `stripImages` vs `historyHasImages` Helper**
Lines 201-205 und 266-276 definieren beide Strip-Logik inline anstatt eine zentrale Funktion zu nutzen. Wiedersprüchlich kann beim ersten Retry die stripImages-Funktion bereits einen anderen Zustand der History trifft als erwartet — keine Garantie dass stripImages immer konsistent mit historyHasImages prüft.

**[llm_client.ts:23] Variable Shadowing in `isRetryableError`**
```typescript
function isRetryableError(error: unknown): boolean {  // Parameter 'error'
  if (err instanceof Error) {   // Referenz auf 'err' — funktioniert nur weil fetchWithRetry 'err' statt 'error' hat
    const msg = error.message.toLowerCase();  // Parameter 'error'
```
Die Parameter-Shadowing zwischen `llm_client.ts:24` (`error`) und der Fetch-Schleife (die vielleicht `err` oder `e` verwendet) — wenn die Variable nicht klar benannt ist, kann es zu falschen Referenzen kommen.

**[llm_client.ts:278] Stream-Parser schluckt Provider-Fehler tief**
```typescript
if (typeof parsed.error === 'string') parsed.error : JSON.stringify(parsed.error);
logger.error(...`Provider error: ${errMsg}`);
throw new Error(`Provider error: ${errMsg}`);
```
Wenn `parsed.error` ein verschachteltes Objekt ist, wird das komplett in den thrown Error kopiert — sehr langer String der dann im gesamten Tool-Call-Kontext fliegt und Response cap überschreitet.

**[agent.ts:201-276] Inline-Helper pro Loop-Durchlauf (Performance)**
`historyHasImages`, `stripImages`, `imageUrlExtractor` werden auf jeden Turn neu erstellt. Das ist kein Bug, aber bei tausenden Turns erzeugt es GC-Druck. Sollte als Methoden extrahiert werden.

**[file_tools.ts:208 ff] Patch-Hunk Parser kann Endlosschleife produzieren**
```typescript
while (i < lines.length && ...) {
  // ...
  i++;   // nur bei match — aber if-Zweige ohne Inkrement könnten skipped werden
```
Falls ein Block `@@`-Format hat, das nicht als 'hunk' oder context passt und wo `i` nicht inkrementiert wird → potentielle Endlosschleife. Die Logik ist verwirrend (Zeilen zählen vs. Index-Bedingung).

**[app_store_tools.ts:136-137] Pfad-Traversierung über Store App ID möglich**
```typescript
const entryUrl = `https://raw.githubusercontent.com/vAG-Apps/main/apps/${app.path}/index.html`;
```
Falls die App Store Index-Daten manipuliert werden (oder ein bösartiger Eintrag dort landet), könnte `../../` in `path` den Zugriff auf Dateien außerhalb des intended directory ermöglichen. Es sollte eine Validierung kommen, dass path keine `..` Segmente enthält.

---

### MITTEL

**[llm_client.ts:183-205] SSE-Puffer behandelt Split-Lines falsch (Datenverlust)**
```typescript
buffer += decoder.decode(value, { stream: true });
...
const lines = buffer.split('\n');
buffer = lines.pop() || '';   // pop gibt den unvollständigen letzten Rest zurück — korrekt!
```
Eigentlich ist dies korrekt implementiert. ABER wenn ein Chunk mitten in `data:` kommt → die nächste Iteration hat den rest als neuen buffer → double-doppeltes prefix detection greift nicht immer zuverlässig. Kleinunter bug bei genau diesem Edge-case könnte zu verlorenen JSON-chunks führen.

**[prompt_builder.ts:63-76] Völlig redundanten Memory-Sektionen im System-Prompt**
Der system Prompt wird auf jeden Turn komplett neu generiert — inklusive aller memories, profile tools schemas. Mit wachsendem Conversation-History wird der prompt immer grösser und erreicht bald das Token-Limit. Die History-Array wächst auch unbegrenzt.

**[agent.ts:285-319] LLM-Response Retry mit Bild-Stripping greift nie korrekt**
Der check `historyHasImages(history) && turn === 0` strippt Bilder erst wenn das model 400 zurückgibt — aber die history-Variable ist ein anderer Array als in der llmChatStream. Das strippt images wird aus History (der copy!) entfernt, bevor retry aufruf gemacht wird — aber weil history nicht referenziert wird...

**[sys_check.ts:153] `repair` argument wird nie geprüft, sondern nur übergeben**
```typescript
if (repair) {
  await resetDBConnection();   // repair ist vom args reas aus tool Aufruf
```
Der sys_check tool parameter "repair" muss mit dem richtigen Schlüssel heißen — hier ist alles richtig.

---

### NIEDRIG

**[llm_client.ts:35] `sleep()` nutzt `setTimeout` im Browser → wird beim Page-hide nicht garantiert ausgeführt**
Wenn das user Tab hidden/switcht oder browser tabs background geht, kann setTimeout verlängert werden (Chrome throttling). Backoff-Zeiten sind dann länger als erwartet.

**[prompt_builder.ts:132-139] `toolsToSchemas()` führt keine validation der Tool-Schemata für die LLM**
Schemas werden blind an LLM gesendet. Falls ein tool schema nicht valid ist (z.b. falsches format), gibt es einen späteren fehler beim API-call statt früher detektiert zu werden.

---

### 3-Satz-Zusammenfassung der Architektur-Qualität

Die Architektur ist solide für den Browser-basierten Agent-Ansatz: direkte LLM-Kommunikation umgeht Server-Bottlenecks, IndexedDB als Hauptspeicher funktioniert zuverlässig mit Recoverible Error Handling. Die Tools sind modular sauber aufgeteilt aber die zentrale `agent.ts` Schleife wird schnell zu einem "God-object" — sie verwaltet History, Sessions, Memory-Extraktion, Tool-Ausführung und Retry-Logik in einer einzigen Methode ohne klare Aufteilung. Insgesamt ist die Codebasis funktional brauchbar für einzelne Konversationen, aber bei längeren Sessions (>20 turns) oder vielen parallelen Werkzeugaufrufen wird die unkontrollierte Historien- und Prompt-Wachstum zum kritischen Faktor — ein Compacting/Limiting-Mechanismus für den System-Prompt und History ist dringend erforderlich.
