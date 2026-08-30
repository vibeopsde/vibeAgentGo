#!/bin/bash
# vag-fix-bench.sh — Fix-Umsetzungs-Benchmark: qwen3.8 setzt verifizierte Review-Fixes um
# Usage: bash vag-fix-bench.sh <bifrost-model-id> <output-dir-name>
# Example: bash vag-fix-bench.sh "ollama/qwen3.8:27b" "qwen3.8-27b-fixes"
#
# Jedes Arbeitspaket (AP) = ein `opencode run` auf dem Repo (Branch bench/fix-<name>).
# Gemessen: reine OpenCode-Zeit pro AP (duration_s). Danach outside-the-clock:
#   - Verifikation: tsc --noEmit (verify_rc, verify_s separat geloggt)
#   - Bei tsc-Fehler: EIN Repair-Run (repair_s separat, zählt nicht zur AP-Zeit)
#   - Auto-Commit pro AP (fix(bench): APn ...)
#
# Voraussetzungen wie vag-review-bench.sh (Bifrost-Provider, BIFROST_API_KEY).
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
  echo "ERROR: BIFROST_API_KEY nicht gesetzt und nicht in /opt/bifrost/.env gefunden" >&2
  exit 1
fi

mkdir -p "$REPO_DIR/$OUT"
cd "$REPO_DIR" || { echo "ERROR: Repo $REPO_DIR nicht gefunden" >&2; exit 1; }

# Eigener Branch pro Run (Commits nicht auf main)
BRANCH="bench/fix-${NAME}"
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
fi

STRICT=' WICHTIG: Dies ist ein vollständiger Arbeitsauftrag, keine Einleitung. Lies die genannten Dateien, setze die Fixes um und gib DANN die Abschluss-Liste aus. Beende die Antwort erst, wenn alle Fixes umgesetzt und die Abschluss-Liste geschrieben ist. Eine kurze Bestätigung allein ist KEINE gültige Antwort. Committe NICHT selbst — der Runner committet danach automatisch.'

run_task() {
  local n="$1" key="$2" title="$3" prompt="$4"
  local t0 t1 dur vt0 vt1 vdur rt0 rt1 rdur rc vrc rrc
  echo "[$(date '+%H:%M:%S')] Start AP$n $key — $title" >> "$OUT/progress.log"

  t0=$(date +%s)
  opencode run "$prompt" --model "bifrost/${MODEL}" > "$OUT/ap$n-$key.md" 2>&1
  rc=$?
  t1=$(date +%s); dur=$((t1 - t0))
  echo "[$(date '+%H:%M:%S')] Ende  AP$n opencode rc=$rc dur=${dur}s" >> "$OUT/progress.log"

  # Verifikation (nicht gemessen): TypeScript-Build
  vt0=$(date +%s)
  npx tsc -p web/tsconfig.json --noEmit > "$OUT/ap$n-$key-tsc.log" 2>&1
  vrc=$?
  vt1=$(date +%s); vdur=$((vt1 - vt0))
  echo "[$(date '+%H:%M:%S')] tsc verify rc=$vrc (${vdur}s)" >> "$OUT/progress.log"

  rdur=0; rrc=0
  if [ $vrc -ne 0 ]; then
    # EIN automatischer Repair-Run mit tsc-Output (separat gemessen)
    TSC_TAIL=$(tail -40 "$OUT/ap$n-$key-tsc.log")
    rt0=$(date +%s)
    opencode run "Der Befehl 'npx tsc -p web/tsconfig.json --noEmit' schlägt nach deinen Änderungen fehl. Fehleroutput (gekürzt): ${TSC_TAIL} — Behebe NUR diese TypeScript-Fehler, minimal-invasiv. Ändere nichts anderes, füge keine neuen Features hinzu. Committe nicht selbst. Gib am Ende eine Liste der korrigierten Stellen aus.${STRICT}" --model "bifrost/${MODEL}" > "$OUT/ap$n-$key-repair.md" 2>&1
    rrc=$?
    rt1=$(date +%s); rdur=$((rt1 - rt0))
    npx tsc -p web/tsconfig.json --noEmit > "$OUT/ap$n-$key-tsc.log" 2>&1
    vrc=$?
    echo "[$(date '+%H:%M:%S')] repair rc=$rrc dur=${rdur}s → tsc jetzt rc=$vrc" >> "$OUT/progress.log"
  fi

  # Auto-Commit dieses Arbeitspakets
  git add -A
  if git diff --cached --quiet; then
    echo "[$(date '+%H:%M:%S')] WARNUNG: AP$n keine Änderungen — nichts zu committen" >> "$OUT/progress.log"
  else
    git commit -m "fix(bench): AP$n $title [${MODEL}]" --quiet
    git show --stat --oneline HEAD | head -20 >> "$OUT/changed.log"
    echo "" >> "$OUT/changed.log"
  fi

  python3 -c "import json; print(json.dumps({'task':'AP$n-$key','model':'$MODEL','title':'''$title''','rc':$rc,'duration_s':$dur,'verify_rc':$vrc,'verify_s':$vdur,'repair_rc':$rrc,'repair_s':$rdur}))" >> "$OUT/timing.jsonl"
}

# ----------------------------------------------------------------------------
# AP1 — CORE: agent.ts (3 verifizierte Fixes aus Review qwen3.8-27b-q4/1-core.md)
# ----------------------------------------------------------------------------
AP1_TITLE="agent.ts race condition, done-event, emit isolation"
AP1="ARBEITSPAKET 1/5 — CORE. In web/src/core/agent.ts gibt es 3 verifizierte Probleme. Setze genau diese Fixes um:

1. RACE CONDITION [agent.ts:35-106, 134-150]: run() hat keinen isRunning-Guard und schreibt in geteilten Instanz-Zustand (this.sessionId, this.abortController, this.currentHistory, this.currentRunSessionId). Zwei parallele/verschachtelte run()-Aufrufe führen zu zwei LLM-Loops, die dieselbe Session parallel in IndexedDB schreiben und den ersten abortController still überschreiben. FIX: this.running-Flag setzen; wenn bereits ein Run aktiv ist, den zweiten Aufruf sofort mit klarer Fehlermeldung abweisen (Promise.reject oder error-Event plus return).

2. FEHLENDES done-EVENT [agent.ts:296-353, 474-478]: done wird nur bei Erfolg und im äusseren Catch emittiert. Die Pfade Abort, LLM-Fehler, Retry-Fehler und Max-Turns returnen normal und emittieren nur error — UI-Komponenten, die auf done entsperren, bleiben gesperrt. FIX: try/finally-Wrapper um den inneren Run oder zentral die done-Emission in run() nach Rückkehr des inneren Loops, so dass done garantiert und idempotent (nur einmal) emittiert wird.

3. emit()-HANDLER-ISOLATION [agent.ts:68-71]: handlers.forEach ohne try/catch — wirft ein Listener (z.B. UI-Callback), werden alle nachfolgenden Handler nie aufgerufen, error/done/session_saved gehen verloren. FIX: pro Handler try { h(data) } catch (e) { logger.error(...) }; Handler auf Snapshot-Kopie des Arrays ausführen.

ANFORDERUNGEN: Minimal-invasiv, kein Refactoring darüber hinaus. Verwende den vorhandenen logger. Wenn andere Dateien (z.B. Tests oder Callsites) von der Signatur abhängen, passe sie minimal mit an. GIB AM ENDE AUS: Liste der geänderten Dateien mit je 1 Satz was geändert wurde.${STRICT}"

# ----------------------------------------------------------------------------
# AP2 — APPS: ExplorerApp.ts (Listener-Leak + Pfad-Validierung)
# ----------------------------------------------------------------------------
AP2_TITLE="ExplorerApp listener leak, path validation"
AP2="ARBEITSPAKET 2/5 — APPS. In web/src/apps/ExplorerApp.ts gibt es 2 verifizierte Probleme. Setze genau diese Fixes um:

1. DOM-LISTENER-LEAK [ExplorerApp.ts:77-80]: Im Konstruktor werden document.addEventListener('click',...) und document.addEventListener('keydown',...) registriert, aber nie entfernt. Der Window Manager entfernt beim Fensterschliessen nur element.remove() (window_manager.ts:298) — die document-weiten Listener bleiben permanent, jede neu geöffnete Explorer-Instanz fügt weitere hinzu. FIX: Gekapselte Handler-Referenzen in Instanzfeldern speichern, eine unmount()-Methode implementieren, die removeEventListener für alle document-Listener aufruft, und den unmount()-Aufruf in die Schliess-Logik des Window Managers integrieren (dort wo die App-Instanz verfügbar ist — prüfe wie window_manager.ts die App-Instanz hält; falls es noch keine dispose/unmount-Kette gibt, ergänze eine minimale: optionale unmount?-Methode auf der App-Basisstruktur, aufgerufen in closeWindow). Falls die App-Basis-Schnittstelle in einem Typen-File lebt, ergänze die optionale Methode dort rückwärtskompatibel (optional, kein breaking change).

2. PATH-VALIDIERUNG [ExplorerApp.ts:610-652]: createFolder() und createFile() akzeptieren name aus window.prompt() nur mit Slash-Trimming — keine Validierung gegen '../..', '..', absolute Pfade oder Nullbytes; Nutzer kann Dateien ausserhalb des Workspace-Roots anlegen. FIX: Zentrale Validierungs-Helferfunktion (z.B. assertSafePath): verwerfe '..'-Segmente, Backslashes, absolute Pfade; bei ungültigem Namen keine Bridge-Anfrage, sondern sichtbares Nutzer-Feedback (z.B. status Meldung im UI, kein stilles Ignorieren).

ANFORDERUNGEN: Minimal-invasiv. Kein Re-Rendering-Refactoring, keine Virtualisierung. GIB AM ENDE AUS: Liste der geänderten Dateien mit je 1 Satz was geändert wurde.${STRICT}"

# ----------------------------------------------------------------------------
# AP3 — WM+UI: RenderPanel.ts Bridge-Härtung
# ----------------------------------------------------------------------------
AP3_TITLE="RenderPanel script escape, bridge validation, dispose"
AP3="ARBEITSPAKET 3/5 — WINDOW MANAGER + UI. In web/src/components/RenderPanel.ts gibt es 3 verifizierte Probleme. Setze genau diese Fixes um:

1. SCRIPT-INJEKTION [RenderPanel.ts:210]: captureScript erzeugt das Skript per String-Interpolation mit title: JSON.stringify(title). JSON.stringify escape Anführungszeichen und Control-Chars, aber NICHT die Sequenz '</'. Ein Tab-Titel mit '</script><script>alert(1)</script>' schliesst das äussere Script-Element vorzeitig — im sandboxed iframe (allow-scripts) wird Code ausgeführt, der über die Bridge beliebige Dateien lesen/schreiben kann. FIX: JSON.stringify(title).replace(/</g, '\\\\u003c') — und analog für alle anderen per Interpolation eingebetteten Werte im captureScript.

2. BRIDGE-HIJACK [RenderPanel.ts:80-126]: attachMessageListener() registriert einen globalen window-message-Listener, der eingehende Objekte ohne Prüfung von event.source an onBridgeRequest weiterleitet. Jeder beliebige Frame kann {vibeAgentGoBridgeRequest:true, request:{type:'writeFile',...}} posten und damit beliebige Dateien lesen/schreiben. FIX: Zuerst prüfen: if (event.source !== this.iframe.contentWindow) return;. Danach request.type gegen eine Whitelist der erlaubten Bridge-Request-Typen prüfen (die Typen, die onBridgeRequest tatsächlich unterstützt — im Code nachschauen) und Feldtypen grob validieren; ungültige Requests verwerfen.

3. LISTENER-LEAK [RenderPanel.ts:77-80]: Der globale window-Listener wird nie entfernt, die Klasse hat kein dispose(). Mehrere RenderPanel-Instanzen hängen weitere Listener an und empfangen alle jede Message (Cross-Talk). FIX: Listener-Referenz in Instanzfeld speichern, dispose()-Methode implementieren, die removeEventListener aufruft; prüfe wo das Panel entsorgt wird (Window Manager Schliess-Logik / Tab-Wechsel) und binde dispose() dort ein, analog zum unmount-Muster.

ANFORDERUNGEN: Minimal-invasiv, bestehende Bridge-Funktionalität (legitime Requests vom eigenen iframe) muss voll erhalten bleiben. GIB AM ENDE AUS: Liste der geänderten Dateien mit je 1 Satz was geändert wurde.${STRICT}"

# ----------------------------------------------------------------------------
# AP4 — PERSIST: Backup Binärdaten-Verlust
# ----------------------------------------------------------------------------
AP4_TITLE="backup binary data loss fix"
AP4="ARBEITSPAKET 4/5 — PERSISTENZ. In web/src/core/backup.ts (mit Bezug zu web/src/core/memory.ts) gibt es 1 verifiziertes KRITISCH-Problem. Setze genau diesen Fix um:

BINÄRDATEN-VERLUST BEIM BACKUP [backup.ts:122-149, memory.ts:156-178]: Der Export speichert Binärdateien als content:'' (weil listFiles() nur Strings liefert und writeFileBinary die Bytes separat im Store hält). Der Import schreibt dann per writeFile(f.path,'') zurück und ÜBERSCHREIBT damit die bestehende Binärdatei im files-Store mit leerem Inhalt — stille Datenzerstörung bei jedem Backup-Roundtrip. FIX: (a) Export: Binärdateien als base64-encoded content mit Markierung kind:'binary' im Backup-JSON serialisieren (die bytes dafür aus dem Store lesen, nicht den String). (b) Import: kind:'binary'-Einträge erkennen und über die vorhandene writeFileBinary-Funktionalität zurückschreiben, NICHT über writeFile. (c) Abwärtskompatibilität: Alte Backup-Einträge ohne kind-Marker mit content:'' dürfen NIE eine vorhandene Binärdatei überschreiben — in dem Fall die Datei überspringen. (d) Vor dem Schreiben das Backup-Payload validieren (JSON-Parse + Strukturcheck), damit kein halb geschriebener Zustand entsteht; wenn praktikabel, die Schreibvorgänge pro Store bündeln.

ANFORDERUNGEN: Minimal-invasiv, bestehende Backup-Struktur (JSON) beibehalten, nur erweitern. Prüfe wie memory.ts listFiles/writeFileBinary funktionieren und nutze die vorhandenen APIs. GIB AM ENDE AUS: Liste der geänderten Dateien mit je 1 Satz was geändert wurde.${STRICT}"

# ----------------------------------------------------------------------------
# AP5 — PROXY: SSRF + Header-Leak
# ----------------------------------------------------------------------------
AP5_TITLE="proxy SSRF guard, header whitelist"
AP5="ARBEITSPAKET 5/5 — SERVER-PROXY. In server/proxy/proxy_server.py gibt es 2 verifizierte Probleme. Setze genau diese Fixes um:

1. SSRF / OPEN-RELAY [proxy_server.py:12, 30-40]: ALLOWLIST ist leer und leer bedeutet 'allow all' — jede Seite kann über ?url= auf interne Dienste zugreifen (127.0.0.1, 169.254.169.254, Intranet). Verschärfend: follow_redirects=True umgeht die Allowlist-Prüfung, die nur den initialen Host prüft — ein erlaubter Host kann per 302 auf interne Ziele umleiten. FIX: (a) SSRF-Guard-Funktion: Ziel-URL parsen, DNS auflösen, alle resultierenden IP-Adressen gegen ipaddress.is_private/is_loopback/is_link_local/is_reserved prüfen und blocken. (b) Redirects: entweder follow_redirects deaktivieren oder jeden Redirect manuell verfolgen und das neue Ziel erneut durch Allowlist + SSRF-Guard schicken (empfohlen). (c) Allowlist-Semantik dokumentieren und beibehalten (leer = allow all für öffentliche Hosts), aber der SSRF-Guard greift immer, auch bei leerer Allowlist.

2. HEADER-LEAK [proxy_server.py:34-38, 50]: Der Request an /api/proxy/ ist same-origin, der Browser hängt Cookies an — die werden ungefiltert an das beliebige Upstream-Ziel weitergegeben (Credential-Leak, verschärft durch Access-Control-Allow-Origin: *). FIX: Whitelist der zu forwardenden Header (nur content-type, accept, authorization falls explizit gewollt); cookie, set-cookie, host, origin, referer, user-agent strikt filtern (nicht forwarden).

ANFORDERUNGEN: Minimal-invasiv, Python-Stil der Datei beibehalten (stdlib bevorzugt — ipaddress, urllib). GET/POST-Funktionalität für legitime öffentliche Ziele muss erhalten bleiben. GIB AM ENDE AUS: Liste der geänderten Stellen mit je 1 Satz was geändert wurde.${STRICT}"

# ----------------------------------------------------------------------------
echo "=== Fix-Benchmark: ${MODEL} | $(date) | Branch ${BRANCH} ===" >> "$OUT/progress.log"
run_task 1 core    "$AP1_TITLE" "$AP1"
run_task 2 apps    "$AP2_TITLE" "$AP2"
run_task 3 wm-ui   "$AP3_TITLE" "$AP3"
run_task 4 persist "$AP4_TITLE" "$AP4"
run_task 5 proxy   "$AP5_TITLE" "$AP5"

TOTAL=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l['duration_s'] for l in lines if 'duration_s' in l))")
REPAIR=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l.get('repair_s',0) for l in lines))")
python3 -c "import json; d={'model':'$MODEL','total_duration_s':$TOTAL,'total_repair_s':$REPAIR,'tasks':5}; print(json.dumps(d))" >> "$OUT/timing.jsonl"

echo "[$(date '+%H:%M:%S')] ALLE ARBEITSPAKETE FERTIG — OpenCode gesamt: ${TOTAL}s (zzgl. Repair: ${REPAIR}s)" >> "$OUT/progress.log"
echo "Done: $OUT (opencode total: ${TOTAL}s, repair: ${REPAIR}s) auf Branch ${BRANCH}"
