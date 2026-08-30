#!/bin/bash
# vag-fix-bench-round2.sh — Fix-Loop Runde 2: Fixes für Funde aus Review auf v2608.3.0
# Usage: bash vag-fix-bench-round2.sh <bifrost-model-id> <output-dir-name>
# Example: bash vag-fix-bench-round2.sh "ollama/qwen3.8:27b" "qwen3.8-27b-fixes-r2"
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
    git commit -m "fix(bench-r2): AP$n $title [${MODEL}]" --quiet
    git show --stat --oneline HEAD | head -20 >> "$OUT/changed.log"
    echo "" >> "$OUT/changed.log"
  fi

  python3 -c "import json; print(json.dumps({'task':'AP$n-$key','model':'$MODEL','title':'''$title''','rc':$rc,'duration_s':$dur,'verify_rc':$vrc,'verify_s':$vdur,'repair_rc':$rrc,'repair_s':$rdur}))" >> "$OUT/timing.jsonl"
}

# ----------------------------------------------------------------------------
# AP1 — CORE: agent.ts nachrüsten (2 Bugs in den Fixes aus Runde 1)
# ----------------------------------------------------------------------------
AP1_TITLE="agent.ts double-done fix, reject-path isolation"
AP1="ARBEITSPAKET 1/4 — CORE. In web/src/core/agent.ts gibt es 2 Probleme, die durch die kürzlich eingebauten Fixes entstanden sind. Setze genau diese Fixes um:

1. DOPPELTE done-EMISSION [agent.ts, Erfolgspfad in _runInner]: Am Ende des erfolgreichen Runs wird this.emit('done', {...}) direkt aufgerufen (ca. Zeile 497, nach saveCurrentSession). Der finally-Block in run() ruft danach zusätzlich this.emitDoneOnce(runSessionId). Da der direkte emit-Aufruf das doneEmitted-Flag NICHT setzt, feuert done ZWEIMAL (doppelter Sound, doppeltes finalizeStream, doppelter UI-Switch). FIX: Den direkten emit('done', ...)-Aufruf im Erfolgspfad durch this.emitDoneOnce(sessionId) ersetzen, so dass done garantiert genau einmal emittiert wird. Prüfe auch alle weiteren Stellen mit emit('done', ...), dass keine an emitDoneOnce vorbeireicht.

2. REJECT-PFAD KORRUMPIERT LAUFENDEN RUN [agent.ts run(), isRunning-Guard]: Der 'Agent is already running'-Reject ruft this.emitDoneOnce(null) und setzt damit doneEmitted=true — der tatsaechlich laufende Run kann sein done danach nie mehr emittieren (UI bleibt gesperrt). Ausserdem wirft der Guard einen Error, den die aufrufende Komponente behandeln muss. FIX: Der Reject-Pfad darf den Zustand des laufenden Runs NICHT anfassen: kein emitDoneOnce, kein doneEmitted-Reset, kein running-Reset. Stattdessen nur this.emit('error', { message }) fuer die UI und dann throw (oder return einer Fehlermeldung, konsistent mit dem bestehenden Fehlerpfad). doneEmitted gehoert exclusiv dem aktiven Run: es wird nur beim Start eines Runs (nach dem Guard) zurueckgesetzt und nur von emitDoneOnce gesetzt.

ANFORDERUNGEN: Minimal-invasiv. Das Verhalten 'done wird pro Run genau einmal emittiert, bei jedem Exit-Pfad, auch bei parallelem run()-Versuch' muss garantiert sein. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP2 — WM+UI: window_manager.ts XSS (title/icon unescaped)
# ----------------------------------------------------------------------------
AP2_TITLE="window_manager XSS escape"
AP2="ARBEITSPAKET 2/4 — WINDOW MANAGER. In web/src/core/window_manager.ts gibt es 1 verifiziertes Problem. Setze genau diesen Fix um:

XSS UEBER TITLE/ICON [window_manager.ts:157-161, 187-194, 485-499 sowie updateWindowData-Ziel]: bar.innerHTML, element.innerHTML (Titlebar) und createDockIcon() injizieren title und icon UNESCAPED in HTML. Titel koennen zur Laufzeit durch App-/LLM-Daten gesetzt werden (openWindow aus opts.title/app.title, updateWindowData(id, { title })). Ein LLM-generierter Titel wie '<img src=x onerror=...>' fuehrt zu Codeausfuehrung in der Haupt-App (un-sandboxed) — volle Kontrolle ueber Config, Bridge, API-Keys. FIX: (a) Eine escapeHtml(s)-Helferfunktion (an bestehender Stelle in der Datei oder einem utils-Modul, pruefe ob es schon eine gibt und nutze sie) fuer alle Interpolationen von title und icon in innerHTML-Templates der Titlebar, des Docks (createDockIcon) und aller weiteren Stellen mit dynamischem title/icon. (b) Pruefe zusätzlich updateDock()/focusWindow()-Pfade: auch dort darf title nur escaped in HTML einfliessen. (c) Wenn sich ein innerHTML-Block vollstaendig auf statisches Markup + title/icon beschraenkt, ist escaping ausreichend — kein Umbau auf createElement noetig, aber erlaubt wenn minimal.

ANFORDERUNGEN: Minimal-invasiv, bestehende Fenster-Funktionalitaet (Drag, Tabs, Dock) unangetastet. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP3 — APPS: renameFile/renameFolder validieren (assertSafePath nachziehen)
# ----------------------------------------------------------------------------
AP3_TITLE="ExplorerApp rename validation"
AP3="ARBEITSPAKET 3/4 — APPS. In web/src/apps/ExplorerApp.ts gibt es 1 verifizertes Problem. Setze genau diesen Fix um:

RENAME OHNE PFAD-VALIDIERUNG [ExplorerApp.ts:723-739, 758-788]: renameFile() und renameFolder() akzeptieren newName aus window.prompt() nur mit trim() und Slash-Streifen — kein Check auf '..', absolute Pfade, Backslash, Control-Chars. Die bereits existierende Validierung assertSafePath() (ca. Zeile 121, von einem frueheren Fix eingebaut) wird hier bewusst nicht aufgerufen. FIX: (a) Beide Methoden validieren den neuen Namen/Pfad mit derselben Logik wie assertSafePath (identische Regeln: keine '..'-Segmente, kein Backslash, keine Control-Chars, keine absoluten Pfade). Nutze die vorhandene Methode, wenn die Signatur passt, sonst refactore assertSafePath minimal zu einer Variante, die auch Rename-Faelle abdeckt (z.B. assertSafePath fuer volle Pfade + Rueckgabe null bei Ungueltigkeit). (b) Bei ungueltilgem Namen: sichtbares Nutzer-Feedback ueber die vorhandene showStatus-Infrastruktur, keine stille Ausfuehrung. (c) GLEICHES FUER moveFileIntoFolder / alle weiteren Methoden, die nutzergesteuerte Pfad-Argumente aus window.prompt an die Bridge geben — pruefe die Datei und ziehe die Validierung everywhere nach, wo Pfade ungeprueft durchgehen.

ANFORDERUNGEN: Minimal-invasiv, keine neuen Features. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
# AP4 — PERSIST: Backup-Import-Atomicitaet + Kommentar-Luege
# ----------------------------------------------------------------------------
AP4_TITLE="backup import atomicity"
AP4="ARBEITSPAKET 4/4 — PERSISTENZ. In web/src/core/backup.ts gibt es 1 verifiziertes Problem. Setze genau diesen Fix um:

IMPORT NICHT ATOMAR / KOMMENTAR LUEGT [backup.ts:167-176]: Der Kommentar behauptet 'all-or-nothing' (Zeile 171-173), aber memory.map(m => this.saveMemoryRaw(m)) als Promise.all sind N einzelne Single-Row-Transaktionen. Bei QuotaExceededError oder Abbruch bleibt ein halbhergestellter Zustand ohne Rollback. FIX: (a) Den Import in EINE indexedDB-Transaktion pro Store packen — memory.ts pruefen: Wenn MemoryStore eine Transaktions-API oder einen Batch-Schreibweg hat (z.B. eine runTx-aehnliche Methode), diesen nutzen, um alle Eintraege eines Stores in einer Transaktion zu schreiben. Falls MemoryStore keine solche API hat, eine minimale Batch-Methode am MemoryStore ergaenzen (z.B. saveMemoryBulk(entries) bzw. saveSessionsBulk, intern eine readwrite-Tx ueber alle puts). (b) Die Reihenfolge: erst DB-Importe (atomar pro Store), DANACH localStorage (localStorage hat keine Transaktionen — aktuell ist es umgekehrt). (c) Den Kommentar korrigieren, so dass er das tatsaechliche Verhalten beschreibt.

ANFORDERUNGEN: Minimal-invasiv, MemoryStore-API nur erweitern (neue optionale Batch-Methode), nichts umbauen. Bestehende Backup-Struktur unangetastet. GIB AM ENDE AUS: Liste der geaenderten Stellen mit je 1 Satz.${STRICT}"

# ----------------------------------------------------------------------------
echo "=== Fix-Benchmark Runde 2: ${MODEL} | $(date) | Branch ${BRANCH} ===" >> "$OUT/progress.log"
run_task 1 core    "$AP1_TITLE" "$AP1"
run_task 2 wm-ui   "$AP2_TITLE" "$AP2"
run_task 3 apps    "$AP3_TITLE" "$AP3"
run_task 4 persist "$AP4_TITLE" "$AP4"

TOTAL=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l['duration_s'] for l in lines if 'duration_s' in l))")
REPAIR=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l.get('repair_s',0) for l in lines))")
python3 -c "import json; d={'model':'$MODEL','total_duration_s':$TOTAL,'total_repair_s':$REPAIR,'tasks':4}; print(json.dumps(d))" >> "$OUT/timing.jsonl"

echo "[$(date '+%H:%M:%S')] ALLE ARBEITSPAKETE FERTIG — OpenCode gesamt: ${TOTAL}s (zzgl. Repair: ${REPAIR}s)" >> "$OUT/progress.log"
echo "Done: $OUT (opencode total: ${TOTAL}s, repair: ${REPAIR}s) auf Branch ${BRANCH}"
