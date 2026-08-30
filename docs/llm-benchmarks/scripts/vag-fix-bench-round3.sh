#!/bin/bash
# vag-fix-bench-round3.sh — Fix-Loop Runde 3: Fixes für Funde aus Review auf v2608.3.1
# Usage: bash vag-fix-bench-round3.sh <bifrost-model-id> <output-dir-name>
# Example: bash vag-fix-bench-round3.sh "ollama/qwen3.8:27b" "qwen3.8-27b-fixes-r3"
#
# Gleiche Mess-und-Verifikations-Logik wie vag-fix-bench.sh (tsc, 1 Repair-Run, Auto-Commit).
set -u

REPO="${VAG_REPO:-/root/vibeAgentGo}"
MODEL="${1:?Usage: $0 <bifrost-model-id> <output-dir-name>}"
NAME="${2:?Usage: $0 <bifrost-model-id> <output-dir-name>}"
OUT="docs/llm-benchmarks/results/${NAME}"
REPO_DIR="$(cd "${REPO}" && pwd)"

if [ -z "${BIFROST_API_KEY:-}" ]; then
  export BIFROST_API_KEY=$(grep '^BIFROST_MASTER_VK=' /opt/bifrost/.env 2>/dev/null | cut -d= -f2)
fi
if [ -z "${BIFROST_API_KEY:-}" ]; then
  echo "ERROR: BIFROST_API_KEY nicht gesetzt" >&2; exit 1
fi

mkdir -p "$REPO_DIR/$OUT"
cd "$REPO_DIR" || { echo "ERROR: Repo nicht gefunden" >&2; exit 1; }

BRANCH="bench/fix-${NAME}"
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
fi

STRICT=' WICHTIG: Dies ist ein vollständiger Arbeitsauftrag, keine Einleitung. Lies die genannten Dateien, setze die Fixes um und gib DANN die Abschluss-Liste aus. Beende die Antwort erst, wenn alle Fixes umgesetzt sind. Committe NICHT selbst — der Runner committet danach automatisch.'

run_task() {
  local n="$1" key="$2" title="$3" prompt="$4"
  local t0 t1 dur vt0 vt1 vdur rt0 rt1 rdur rc vrc rrc
  echo "[$(date '+%H:%M:%S')] Start AP$n $key — $title" >> "$OUT/progress.log"

  t0=$(date +%s)
  opencode run "$prompt" --model "bifrost/${MODEL}" > "$OUT/ap$n-$key.md" 2>&1
  rc=$?
  t1=$(date +%s); dur=$((t1 - t0))
  echo "[$(date '+%H:%M:%S')] Ende  AP$n opencode rc=$rc dur=${dur}s" >> "$OUT/progress.log"

  vt0=$(date +%s)
  npx tsc -p web/tsconfig.json --noEmit > "$OUT/ap$n-$key-tsc.log" 2>&1
  vrc=$?
  vt1=$(date +%s); vdur=$((vt1 - vt0))
  echo "[$(date '+%H:%M:%S')] tsc verify rc=$vrc (${vdur}s)" >> "$OUT/progress.log"

  rdur=0; rrc=0
  if [ $vrc -ne 0 ]; then
    TSC_TAIL=$(tail -40 "$OUT/ap$n-$key-tsc.log")
    rt0=$(date +%s)
    opencode run "Der Befehl 'npx tsc -p web/tsconfig.json --noEmit' schlägt nach deinen Änderungen fehl. Fehleroutput (gekürzt): ${TSC_TAIL} — Behebe NUR diese TypeScript-Fehler, minimal-invasiv. Committe nicht selbst.${STRICT}" --model "bifrost/${MODEL}" > "$OUT/ap$n-$key-repair.md" 2>&1
    rrc=$?
    rt1=$(date +%s); rdur=$((rt1 - rt0))
    npx tsc -p web/tsconfig.json --noEmit > "$OUT/ap$n-$key-tsc.log" 2>&1
    vrc=$?
    echo "[$(date '+%H:%M:%S')] repair rc=$rrc dur=${rdur}s → tsc jetzt rc=$vrc" >> "$OUT/progress.log"
  fi

  git add -A
  if git diff --cached --quiet; then
    echo "[$(date '+%H:%M:%S')] WARNUNG: AP$n keine Änderungen" >> "$OUT/progress.log"
  else
    git commit -m "fix(bench-r3): AP$n $title [${MODEL}]" --quiet
    git show --stat --oneline HEAD | head -20 >> "$OUT/changed.log"
    echo "" >> "$OUT/changed.log"
  fi

  python3 -c "import json; print(json.dumps({'task':'AP$n-$key','model':'$MODEL','title':'''$title''','rc':$rc,'duration_s':$dur,'verify_rc':$vrc,'verify_s':$vdur,'repair_rc':$rrc,'repair_s':$rdur}))" >> "$OUT/timing.jsonl"
}

# ----------------------------------------------------------------------------
# AP1 — PROXY: DNS-Rebinding-Pinning + Authorization-Header entfernen
# ----------------------------------------------------------------------------
AP1_TITLE="proxy DNS rebinding pin, auth header"
AP1="ARBEITSPAKET 1/5 — SERVER-PROXY. In server/proxy/proxy_server.py gibt es 2 verifizierte Probleme im kuerzlich gehaerteten SSRF-Guard. Setze genau diese Fixes um:

1. DNS-REBINDING / TOCTOU-BYPASS [proxy_server.py:47-77]: _validate_target_url loest den Hostnamen via socket.getaddrinfo auf und validiert die IPs — aber httpx.AsyncClient loest denselben Hostnamen beim Connect NEU auf. Ein Angreifer mit eigener Authoritative-DNS liefert fuer die Validierungs-Abfrage eine oeffentliche IP und fuer die Connect-Abfrage 127.0.0.1 bzw. 169.254.169.254 — die Guards werden komplett umgangen. FIX (IP-Pinning): Nach der Validierung die URL fuer den eigentlichen Request auf die validierte IP umschreiben: host durch die gepruefte IP ersetzen (bei HTTPS Host-Header und SNI auf den urspruenglichen Host setzen, z.B. httpx.URL mit httpcore-transport oder einfacher: request mit headers={'host': original_host} und URL mit IP-Literal; wenn SNI-Kontrolle mit Boardmitteln nicht sauber moeglich ist, ist eine akzeptable Minimallösung: einen custom httpx.AsyncHTTPTransport mit einem Transport-Adapter zu nutzen ODER pro Request einen eigenen Client mit einem Resolver der nur die validierte IP liefert — waehle die minimal-invasive Variante, die mit httpx-Boardmitteln korrekt funktioniert und dokumentiere die Wahl in 2-3 Kommentarsätzen). Das Redirect-Handling muss dasselbe Pinning pro Redirect-Ziel anwenden. Wichtig: IPv6-URLs brauchen Klammern im Host-Teil.

2. AUTHORIZATION-FORWARDING [proxy_server.py:23, 34-38]: FORWARDED_REQUEST_HEADERS enthaelt 'authorization' — jeder Upstream (Default: alle Hosts) erhaelt das Bearer-Token des Nutzers, kombiniert mit Access-Control-Allow-Origin: * ist das Cross-Site-Token-Exfiltration. FIX: 'authorization' aus FORWARDED_REQUEST_HEADERS ENTFERNEN (nur content-type und accept bleiben). Ausserdem die CORS-Response-Header korrigieren: 'Access-Control-Allow-Headers' auf 'Content-Type' beschraenken (Authorization raus).

ANFORDERUNGEN: Minimal-invasiv, Python-stdlib-Stil der Datei beibehalten. GET/POST fuer legitime oeffentliche Ziele muss funktionieren (https-Hosts mit normalem DNS). GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP2 — TOOLS: Path-Traversal-Schutz (app_store_install/publish, patch-Tool)
# ----------------------------------------------------------------------------
AP2_TITLE="tool path traversal guard"
AP2="ARBEITSPAKET 2/5 — CORE-TOOLS. In web/src/core/tools/ gibt es 3 verifizierte Path-Traversal-Luecken. Setze genau diese Fixes um — bevorzugt mit EINER zentralen Validierungs-Helferfunktion in web/src/core/tools/shared.ts (pruefe was dort schon existiert):

1. APP_STORE_INSTALL [app_store_tools.ts:136-148]: basePath = apps/\${app.category}/\${app.id} und entryUrl kommen direkt aus index.apps (externes JSON von GitHub), ohne Validierung. Path-Traversal via app.category oder app.id mit '../../..' schreibt Dateien an beliebige Workspace-Orten. FIX: app.id gegen ^[a-z0-9-]+\\.[a-z0-9-]+$ (oder aehnlich strenge Whitelist) validieren, app.category gegen eine Whitelist erlaubter Kategorien (aus dem Code ableiten oder ^[a-z0-9-]+$), bei Verstoß Tool-Fehlermeldung statt Write.

2. APP_STORE_PUBLISH [app_store_tools.ts:215-240]: targetPath = apps/\${manifest.category}/\${manifest.id}/index.html — manifest stammt aus parseAppManifest (LLM-gesteuert). manifest.id = '../../etc/passwd' oder manifest.category = '../sessions' schreibt an beliebige Orte. targetRepoRoot ebenfalls unvalidiert. FIX: dieselbe Validierung wie oben fuer manifest.id und manifest.category; targetRepoRoot auf ^[a-zA-Z0-9._-]+$ begrenzen.

3. PATCH-TOOL (V4A) [file_tools.ts:207-300]: parseV4APatch liest path direkt aus dem LLM-generierten Patch-Text, applyV4APatch nutzt ihn ungeprueft fuer readFile/writeFile. '*** Update File: ../../../config.json' verlaesst den Workspace-Root. FIX: Nach dem Parsen jeden file.path validieren: kein '..', kein absoluter Pfad, kein fuehrender '/'. Bei Verstoß den Patch-Eintrag mit klarer Fehlermeldung ablehnen (nicht still skippen).

ZENTRALE LOESUNG: Eine gemeinsame Funktion z.B. isSafeRelPath(path): boolean (keine '..'-Segmente, kein Backslash, nicht absolut, keine Control-Chars) in shared.ts, genutzt von allen drei Stellen plus den app_store-Stellen mit den zusaetzlich strengeren id/category-Regeln. Wenn file_tools.ts an anderen Stellen (write_file, read_file, etc.) Pfade ungeprueft durchreicht, dieselbe Funktion dort ebenfalls anwenden.

ANFORDERUNGEN: Minimal-invasiv, legitime Pfade (apps/tools/xyz/index.html) muessen weiter funktionieren. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP3 — CORE: rename_session-SessionId-Bug + Abort-Race + Logger-Rekursion
# ----------------------------------------------------------------------------
AP3_TITLE="rename_session fix, abort race, logger recursion"
AP3="ARBEITSPAKET 3/5 — CORE. 3 verifizierte Probleme. Setze genau diese Fixes um:

1. RENAME_SESSION BOOT-BROKEN [agent.ts:286, rename_session.ts:27]: buildToolContext() wird einmalig pro run() erzeugt, BEVOR der erste saveCurrentSession this.sessionId setzt. Bei einem Neustart ohne sessionId-Parameter ist ctx.env.sessionId daher null fuer ALLE Tool-Calls des Runs — rename_session bricht immer mit 'no active session' ab, reproduzierbar bei jeder neuen Session. FIX: ctx.env.sessionId dynamisch machen: statt eines statischen Wertes einen Getter nutzen (Object.defineProperty auf ctx.env mit get: () => this.sessionId, oder ctx.env als Objekt mit Getter-Funktion — pruefe die Typen in types/ und passe minimal an). Die Loesung muss sicherstellen, dass jeder Tool-Call zur Laufzeit den AKTUELLEN this.sessionId-Wert sieht.

2. ABORT-RACE MIT GUARD [agent.ts:145-161]: abort() waehrend des LLM-Streams fuehrt dazu, dass _runInner 'Aborted' zurueckgibt, aber der finally-Block von run() erst SPAETER laeuft. Zwischen abort() und finally ist this.running noch true — ein sofortiger zweiter run()-Versuch wird mit 'Agent is already running' abgewiesen, obwohl der Run faktisch beendet ist (fuer den User haengt der Agent). FIX: Im abort()-Pfad this.running fruehzeitig freigeben. Sauberste Variante: abort() setzt ein Flag this.abortRequested = true, und die Stelle, die den AbortError faengt ('Aborted'-Rueckgabepfad in _runInner), setzt this.running = false SOFORT (vor dem finally). Alternativ akzeptabel: in run() den isRunning-Guard so anpassen, dass er bei abortRequested nicht abweist. Erklaere in 1-2 Kommentarsaetzen die gewaehlte Reihenfolge.

3. LOGGER-REKURSION [global_errors.ts:66-81, logger.ts:29-43]: console.error wird von global_errors.ts gewrappt; logger.log() ruft console.error (den Wrapper) auf; der Wrapper ruft logger.error() → log() → Wrapper → Rekursion bis RangeError, gefangen in catch-Blocks, aber mit masshaft duplizierten Konsolen-/DB-Eintraegen. FIX: In logger.ts die RAW-Referenz des konsolen-outputs VOR dem Wrapping sichern (z.B. am Modul-Anfang const rawConsoleError = console.error.bind(console) — Achtung: global_errors.ts importiert logger, pruefe die Import-/Init-Reihenfolge; die sicherste Variante ist eine Guard-Flag: der Wrapper setzt ein Modul-Flag isInLogger true bevor er logger.error ruft und log() prueft das Flag und ruft in dem Fall die original-Konsolen-Funktion ohne den Wrapper-Pfad zu triggern — oder log() ruft nie console.error sondern eine gespeicherte originale Referenz). Ziel: logger.error()/fatal erzeugen GENAU EINEN Konsolen-Eintrag und EINEN DB-Eintrag, keine Rekursion.

ANFORDERUNGEN: Minimal-invasiv. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP4 — APPS: AppStoreApp XSS + appManifest-Injection
# ----------------------------------------------------------------------------
AP4_TITLE="appstore xss, manifest injection"
AP4="ARBEITSPAKET 4/5 — APPS. 3 verifizierte XSS/Injection-Probleme. Setze genau diese Fixes um:

1. APPSTORE-REFRESH-LEAK [AppStoreApp.ts:98-105, 63-68]: Ein Refresh-Loop (setInterval oder aehnlicher Mechanismus) laeuft nach Fensterschliessung weiter (DOM-Leak/Resource-Leak). Es existiert inzwischen eine unmount()-Konvention (types/index.ts App-Interface, aufgerufen von window_manager.closeWindow). FIX: unmount()-Methode in AppStoreApp implementieren, die den Loop stoppt und registrierte Listener/Timer entfernt; pruefe ob weitere Apps mit Timer/Loops (z.B. SettingsApp) dasselbe brauchen und ziehe es dort minimal nach.

2. APPSTORE-XSS [AppStoreApp.ts:438-441, 392]: App-Beschreibungen/Namen aus dem externen Store-JSON fliessen unescaped via innerHTML in die UI. FIX: escapeHtml (existiert bereits in web/src/utils/escape.ts) fuer alle dynamischen Werte (app.name, description, developer etc.) in den innerHTML-Templates der App-Karten und Detail-Ansichten.

3. MANIFEST-INJECTION [appManifest.ts:66-77]: parseAppManifest extrahiert Manifest-Felder aus HTML-Kommentaren und fuegt sie unescaped wo ein (z.B. in HTML-Generierung oder JSON.parse mit unsauberem Escaping — Zeile 71 String.replace-Metacharakter-Bug: replace(b, c) mit String-Argument ersetzt nur das erste Vorkommen und $-Muster in c haben spezielle Bedeutung). FIX: (a) Alle replace(string, string)-Aufrufe auf replace(RegExp mit g-Flag, escaped-callback) umstellen, damit alle Vorkommen ersetzt werden und $-Sequenzen im Replacement keine Sonderwirkung haben (replacement-function verwenden). (b) Die extrahierten Felder als Daten behandeln: nie unescaped in HTML/Script-Kontexte interpolieren — pruefe wo die geparsten Werte fliessen und escapen bzw. als Datenstruktur halten.

ANFORDERUNGEN: Minimal-invasiv, Store-Darstellung darf sich visuell nicht aendern. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP5 — PERSIST: corsFetch-Request-Handling + Backup-ID-Kollision
# ----------------------------------------------------------------------------
AP5_TITLE="corsFetch request fix, backup merge collision"
AP5="ARBEITSPAKET 5/5 — PERSIST. 2 verifizierte Probleme. Setze genau diese Fixes um:

1. CORSFETCH VERLIERT REQUEST-DATEN [cors_fetch.ts:28-31]: corsFetch(input: RequestInfo, init?) — wird ein Request-OBJEKT uebergeben (und init ist undefined, der normale Fall), zieht der Code nur die URL und ruft fetch(proxiedUrl(url), undefined) — Header, Method und Body des Requests gehen verloren. Stille Datenkorruption bzw. 401er in generierten Mini-Apps. FIX: Request-Input explizit behandeln: if (input instanceof Request) → neuen Request mit proxiedUrl(input.url) bauen und Method/Headers/Body uebernehmen (Achtung: Body-Stream eines Request kann nur einmal gelesen werden — new Request(proxiedUrl, input) uebernimmt korrekt, oder input.clone() nutzen). Init-Parameter bleibt unterstuetzt und hat Vorrang fuer explizite Overrides.

2. BACKUP-ID-KOLLISION BEIM IMPORT [backup.ts:126-181]: Der Import in einen bestehenden Workspace MERGE-t: Memory-Eintraege mit autoIncrement-ID aus dem Backup (id: 1) ueberschreiben unzusammenhaengende lokale Eintraege mit derselben ID; Sessions ueberschreiben sich via keyPath id. Der Nutzer erwartet bei einem Backup-Import ein Restore, kein Merge. ZUSAETZLICH: atob() auf korruptem Base64 wirft erst in restoreFiles, NACHDEM memory+sessions schon geschrieben wurden. FIX: (a) In assertValidPayload JEDE binaere Datei auf Base64-Decodierbarkeit pruefen (try atob catch → Fehler VOR jedem Write). (b) Die ID-Kollision aufloesen: beim Memory-Import neue IDs vergeben statt Backup-IDs zu uebernehmen (bestehende Eintraege bleiben, Backup-Eintraege werden angehaengt; dafuer beim Schreiben das id-Feld weglassen bzw. undefined setzen, IndexedDB vergibt dann neue autoIncrement-IDs) — Sessions bleiben bei ihrem id-keyPath (Historie wiederherstellen ist dort semantisch korrekt), aber dokumentiere die Entscheidung in 1-2 Kommentarsaetzen.

ANFORDERUNGEN: Minimal-invasiv. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
echo "=== Fix-Benchmark Runde 3: ${MODEL} | $(date) | Branch ${BRANCH} ===" >> "$OUT/progress.log"
run_task 1 proxy   "$AP1_TITLE" "$AP1"
run_task 2 tools   "$AP2_TITLE" "$AP2"
run_task 3 core    "$AP3_TITLE" "$AP3"
run_task 4 apps    "$AP4_TITLE" "$AP4"
run_task 5 persist "$AP5_TITLE" "$AP5"

TOTAL=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l['duration_s'] for l in lines if 'duration_s' in l))")
REPAIR=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l.get('repair_s',0) for l in lines))")
python3 -c "import json; d={'model':'$MODEL','total_duration_s':$TOTAL,'total_repair_s':$REPAIR,'tasks':5}; print(json.dumps(d))" >> "$OUT/timing.jsonl"

echo "[$(date '+%H:%M:%S')] ALLE ARBEITSPAKETE FERTIG — OpenCode gesamt: ${TOTAL}s (zzgl. Repair: ${REPAIR}s)" >> "$OUT/progress.log"
echo "Done: $OUT (opencode total: ${TOTAL}s, repair: ${REPAIR}s) auf Branch ${BRANCH}"
