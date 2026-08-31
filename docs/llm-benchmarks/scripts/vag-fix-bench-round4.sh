#!/bin/bash
# vag-fix-bench-round4.sh — Fix-Loop Runde 4: Funde aus Dimensions-Review v2 auf v2608.3.2
# Usage: bash vag-fix-bench-round4.sh <bifrost-model-id> <output-dir-name>
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
    echo "[$(date '+%H:%M:%S')] WARNUNG: AP$n keine Änderungen — PRÜFEN!" >> "$OUT/progress.log"
  else
    git commit -m "fix(bench-r4): AP$n $title [${MODEL}]" --quiet
    git show --stat --oneline HEAD | head -20 >> "$OUT/changed.log"
    echo "" >> "$OUT/changed.log"
  fi

  python3 -c "import json; print(json.dumps({'task':'AP$n-$key','model':'$MODEL','title':'''$title''','rc':$rc,'duration_s':$dur,'verify_rc':$vrc,'verify_s':$vdur,'repair_rc':$rrc,'repair_s':$rdur}))" >> "$OUT/timing.jsonl"
}

# ----------------------------------------------------------------------------
# AP1 — CORE: Run-Identität in agent.ts (KRITISCH aus v2-Review)
# ----------------------------------------------------------------------------
AP1_TITLE="agent.ts run identity"
AP1="ARBEITSPAKET 1/3 — CORE. In web/src/core/agent.ts gibt es 1 KRITISCHES Problem: der 'abortRequested'-Durchlass im run()-Guard erlaubt einen zweiten run() SOFORT nach abort() — aber der alte Run stirbt erst spaeter (abort wirkt nur auf den LLM-Stream via signal; waehrend einer Tool-Ausführung laeuft der alte Run weiter bis zum naechsten Turn). In diesem Fenster laufen ZWEI Runs parallel und teilen sich Instanz-Felder: (1) der finally-Block des alten Runs loescht currentRunSessionId/currentHistory mitten im neuen Run, (2) der alte Run emittiert verzoegert error + done und setzt doneEmitted=true, wodurch das done des NEUEN Runs unterdrueckt wird (AppController macht dann finalizeStream doppelt/falsch), (3) beide schreiben dieselbe Session — der Spaet-Save des alten Runs ueberschreibt den neueren Stand (Last-Writer-Wins). FIX — Run-Identitaet einfuehren: (a) private runSeq = 0; in run() const runId = ++this.runSeq. (b) In _runInner/_runInnerCore nach jeder awaits-Grenze (mindestens: vor/nach LLM-Stream, vor/nach jedem Tool-Call, vor saveCurrentSession, vor done-Emission) pruefen: if (runId !== this.runSeq || controller.signal.aborted) → still aussteigen (return), KEINE Events mehr emittieren, KEINE Saves mehr machen. RunId dazu durch die Call-Kette schleppen (Parameter oder Feld this.activeRunId). (c) doneEmitted pro Run: statt Instanz-Feld eine lokale Variable/Closure in run() bzw. dem emitDoneOnce den runId mitgeben und nur emittieren wenn runId aktuell. (d) Den finally-Block von _runInner nur dann aufraeumen lassen, wenn der Run noch der aktive ist (this.activeRunId === runId), sonst nichts anfassen. (e) Der bestehende Guard (running && !abortRequested) kann bleiben, aber der neue Run soll zusaetzlich this.abortController ersetzen — dafuer sicherstellen, dass abort() beim ALTEN controller bleibt (Referenz lokal halten). Ziel-Invariante: genau EIN Run ist zu jedem Zeitpunkt 'aktiv' im Sinne von Events+Saves; alte Runs verfallen still.

ANFORDERUNGEN: Minimal-invasiv innerhalb agent.ts (Typen in types/ nur wenn noetig). Das Verhalten bei normalem Einzelbetrieb darf sich nicht aendern. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP2 — BRIDGE: AppController-Gate haerten (KRITISCH aus v2-Review)
# ----------------------------------------------------------------------------
AP2_TITLE="AppController bridge hardening"
AP2="ARBEITSPAKET 2/3 — BRIDGE-GATE. In web/src/core/AppController.ts gibt es 1 KRITISCHES Problem: handleBridgeRequest (ca. Zeile 172-273) ist der LIVE-Gate fuer alle App-iframes (ProgramApp UND AppStoreApp) und hat KEINE Pfad-Validierung und KEINE Input-Begrenzung: (1) readFile/writeFile/deleteFile/listFiles/writeFileBinary/readFileBinary nehmen req.path ungeprueft an memory.writeFile etc. weiter — Path-Traversal ('..'-Segmente, absolute Pfade) und Zugriff auf beliebige Workspace-Bereiche moeglich. (2) sendMessage: req.text ist komplett unvalidiert und wird direkt an agent.run() uebergeben — jede installierte App kann den Agenten prompt-injecten. (3) Die permissions aus dem Store-JSON werden nicht serverseitig verifiziert. FIX: (a) Importiere isSafeRelPath aus web/src/core/tools/shared.js (dort existiert es bereits) und pruefe in handleBridgeRequest JEDE pfadtragende Operation (readFile, writeFile, writeFileBinary, readFileBinary, deleteFile; listFiles braucht einen Prefix-Check falls ein Pfad-Argument existiert): bei ungueltem Pfad {ok:false, error:'Invalid path'} zurueck. (b) sendMessage: req.text auf Typ string pruefen, auf max. 4000 Zeichen begrenzen, Whitespace normalisieren (trim) — bei Verstoß {ok:false, error:'Invalid message'}. (c) Zusaetzlich fuer ALLE Requests ein grobes Groessen-Limit fuer content/data (z.B. 10 MB) als Schutz vor Memory-Exhaustion. (d) Pruefe die vorhandene Permission-Logik (allowedPermissions in ProgramApp): stelle sicher, dass handleBridgeRequest einen Request-Typ nur ausfuehrt, wenn die Frame-Quelle die Permission dafuer deklariert hat — wenn diese Zuordnung fehlt, ergaenze sie minimal an der Stelle, wo der Bridge-Handler an das Fenster/App gebunden wird.

ANFORDERUNGEN: Minimal-invasiv, legitime App-Requests (normale relative Pfade, kurze sendMessage) muessen weiter funktionieren. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP3 — APPS: Orphaned Agent-Run + toten RenderPanel-Code entfernen
# ----------------------------------------------------------------------------
AP3_TITLE="ProgramApp orphan run, remove dead RenderPanel"
AP3="ARBEITSPAKET 3/3 — CLEANUP + LEAK. 2 verifizierte Probleme: (1) ORPHANED AGENT-RUN [web/src/core/AppController.ts:214-244 + web/src/apps/ProgramApp.ts:186-192]: sendMessage in der Bridge ruft this.agent.run() — wird das App-Fenster waehrend des Laufs geschlossen, laeuft der Agent (LLM-Calls!) unkontrolliert weiter, niemand wartet auf das Ergebnis. FIX: Der Agent-Run aus sendMessage muss abgebrochen werden koennen, wenn das anfordernde Fenster schliesst: die einfachste Variante ist, pro App-Fenster ein AbortController zu führen (Map windowId → AbortController in AppController oder in ProgramApp), den sendMessage-Run damit zu versehen (agent.run hat keinen Signal-Parameter — dann alternative: den agent.abort() aufrufen, wenn das Fenster, das den letzten Run gestartet hat, geschlossen wird; sauber dokumentieren in 1-2 Kommentarsaetzen welche Variante gewaehlt wurde und warum sie fuer Einzel-User-Single-Agent korrekt ist). (2) TOTER CODE [web/src/components/RenderPanel.ts]: RenderPanel wird nirgendwo importiert (nur ein Kommentar 'Replaces the old RenderPanel' in ProgramApp.ts) — die komplette Datei ist tot, inklusive der Bridge-Haertung aus frueheren Runden die auf ihr sitzt. FIX: RenderPanel.ts loeschen. Vorher verifizieren (Grep über web/src und web/index.html nach 'RenderPanel'): wenn wirklich keine Referenz existiert, entfernen; ebenfalls pruefen ob web/src/i18n Eintraege oder CSS-Klassen existieren, die NUR von RenderPanel genutzt wurden und mit entfernt werden koennen (nur eindeutig exklusive — im Zweifel bleiben sie drin).

ANFORDERUNGEN: Minimal-invasiv. Nach AP3 muss tsc gruen sein und keine Import-Fehler zurueckbleiben. GIB AM ENDE AUS: Liste der geaenderten/entfernten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
echo "=== Fix-Benchmark Runde 4: ${MODEL} | $(date) | Branch ${BRANCH} ===" >> "$OUT/progress.log"
run_task 1 core    "$AP1_TITLE" "$AP1"
run_task 2 bridge  "$AP2_TITLE" "$AP2"
run_task 3 apps    "$AP3_TITLE" "$AP3"

TOTAL=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l['duration_s'] for l in lines if 'duration_s' in l))")
REPAIR=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l.get('repair_s',0) for l in lines))")
python3 -c "import json; d={'model':'$MODEL','total_duration_s':$TOTAL,'total_repair_s':$REPAIR,'tasks':3}; print(json.dumps(d))" >> "$OUT/timing.jsonl"
echo "[$(date '+%H:%M:%S')] ALLE ARBEITSPAKETE FERTIG — OpenCode gesamt: ${TOTAL}s (zzgl. Repair: ${REPAIR}s)" >> "$OUT/progress.log"
echo "Done: $OUT (opencode total: ${TOTAL}s, repair: ${REPAIR}s) auf Branch ${BRANCH}"
