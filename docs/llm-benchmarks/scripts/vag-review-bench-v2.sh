#!/bin/bash
# vag-review-bench-v2.sh — Funktionsorientierter Review (Dimensionen statt Dateien)
# Usage: bash vag-review-bench-v2.sh <bifrost-model-id> <output-dir-name>
# Example: bash vag-review-bench-v2.sh "ollama/qwen3.8:27b" "qwen3.8-27b-dim"
#
# Statt Datei-Slicing (core/apps/wm/persist) schneidet v2 ORTHOGONAL nach Funktionen:
# der Prompt erzwingt Fluss-Verfolgung über Dateigrenzen (Lebenszyklen, Übergänge,
# End-to-End-Traces) statt Punkt-für-Punkt-Review pro Datei.
set -u

REPO="${VAG_REPO:-/root/vibeAgentGo}"
MODEL="${1:?Usage: $0 <bifrost-model-id> <output-dir-name>}"
NAME="${2:?Usage: $0 <bifrost-model-id> <output-dir-name>}"
OUT="docs/llm-benchmarks/results/${NAME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${REPO}" && pwd)"

if [ -z "${BIFROST_API_KEY:-}" ]; then
  export BIFROST_API_KEY=$(grep '^BIFROST_MASTER_VK=' /opt/bifrost/.env 2>/dev/null | cut -d= -f2)
fi
if [ -z "${BIFROST_API_KEY:-}" ]; then
  echo "ERROR: BIFROST_API_KEY nicht gesetzt" >&2; exit 1
fi

mkdir -p "$REPO_DIR/$OUT"
cd "$REPO_DIR" || { echo "ERROR: Repo nicht gefunden" >&2; exit 1; }

STRICT=' WICHTIG: Dies ist ein vollständiger Arbeitsauftrag, keine Einleitung. Verfolge ALLE genannten Flüsse vollständig durch den echten Code und gib DANN das vollständige Review aus. Beende die Antwort erst, wenn die abschließende 3-Satz-Zusammenfassung geschrieben ist. Eine kurze Bestätigung allein ist KEINE gültige Antwort.'

run_task() {
  local n="$1" name="$2" prompt="$3"
  local t0 t1 dur
  t0=$(date +%s)
  echo "[$(date '+%H:%M:%S')] Start $n $name" >> "$OUT/progress.log"
  opencode run "$prompt" --model "bifrost/${MODEL}" > "$OUT/$n-$name.md" 2>&1
  local rc=$?
  t1=$(date +%s)
  dur=$((t1 - t0))
  echo "[$(date '+%H:%M:%S')] Ende  $n $name rc=$rc dur=${dur}s" >> "$OUT/progress.log"
  python3 -c "import json,sys; print(json.dumps({'task':'$n-$name','model':'$MODEL','rc':$rc,'duration_s':$dur}))" >> "$OUT/timing.jsonl"
}

METHOD=' METHODE: Denke in Flüssen und Zustandsübergängen, nicht in Dateien. Für jeden Flow: nenne die beteiligten Dateien:Zeilen, prüfe JEDEN Übergang (was passiert bei Fehler, bei Abbruch, bei zweitem parallelen Aufruf, bei reload mid-flow?), und verifiziere jede Behauptung gegen den echten Code — kein Fund ohne konkrete Zeilennummer und ohne Gegenlesen an allen beteiligten Stellen. Melde NUR echte Funktions- und Robustheitsprobleme, keine Style-Nitpicks.'

TASK1="Code-Review AUFGABE 1/5 — FUNKTIONSDIMENSION 'AGENT-LOGIK & STEUERUNG': Rekonstruiere die komplette Steuerungslogik des Agenten als Zustandsmaschine. Startpunkt web/src/core/agent.ts, dazu llm_client.ts, prompt_builder.ts und web/src/core/tools/index.ts samt Tool-Implementierungen. Verfolge diese Flüsse End-zu-End: (a) LEBENSZYKLUS EINES RUNS: run() → Stream → Tool-Call-Loop → done — jeder Übergang, jeder Fehler- und Abbruchpfad (User-Abort mid-Stream, Retry nach Teilausgabe, Max-Turns, zweiter run() während des ersten). (b) INSTANCE-STATE: sessionId, running, abortRequested, abortController, currentHistory, currentRunSessionId — wann gesetzt, wann gelesen, wo kann Inkonsistenz entstehen, besonders über saveCurrentSession-Grenzen hinweg. (c) TOOL-ORCHESTRIERUNG über mehrere Turns: Argument-Parsing, Fehler pro Tool, was passiert wenn ein Tool falsche Typen liefert oder die Bridge nicht antwortet. Struktur: pro Fund SECTION [DATEI:ZEILE] mit Schweregrad (KRITISCH/HOCH/MITTEL/NIEDRIG), Problembeschreibung, konkretem Fix-Vorschlag. Am Ende 3-Satz-Zusammenfassung der Logik-Qualität.${METHOD}${STRICT}"

TASK2="Code-Review AUFGABE 2/5 — FUNKTIONSDIMENSION 'GUI & USER-INTERACTION': Verfolge jede größere Benutzerinteraktion als Flow durch die UI-Schicht: web/src/core/window_manager.ts, web/src/components/ChatPanel.ts, web/src/components/RenderPanel.ts, web/src/components/OnboardingWizard.ts und web/src/apps/ (ExplorerApp, TextEditorApp, AppStoreApp, SettingsApp). Flüsse: (a) FENSTER-LEBENSZYKLUS: open → focus → drag/resize (Maus UND Touch) → z-Order → close — inkl. dispose/unmount-Kette und was bei rapid open/close vieler Fenster passiert. (b) CHAT-FLOW: Nachricht eingeben (+Anhänge) → senden → Stream-Rendering während der Laufzeit → Tool-Status → abort → fertig — alle UI-Zustände (sperrt das Input korrekt? hängt es bei Fehler?), Debounce/Timer. (c) APP-START-FLOW: App im Store wählen → install → launch → iframe/Worker-Render → Bridge-Kommunikation → schließen. (d) MOBILE: Touch-Handling, Viewport, Tastatur-Überlagerung wo relevant. Struktur: SECTION [DATEI:ZEILE] mit Schweregrad, Beschreibung, Fix-Vorschlag. Am Ende 3-Satz-Zusammenfassung der UI-Robustheit.${METHOD}${STRICT}"

TASK3="Code-Review AUFGABE 3/5 — FUNKTIONSDIMENSION 'SANDBOX & CODE-AUSFÜHRUNG': Analysiere alle Ausführungsumgebungen für generierten Code und ihre Isolations-Grenzen: den Web-Worker-Sandbox-Code (web/src/core/worker-sandbox/ bzw. die Worker-Dateien — per Glob finden, plus web/public/agent-worker.js), das RenderPanel-iframe (web/src/components/RenderPanel.ts) und die Bridge-Protokolle dazwischen. Flüsse: (a) SANDLEBENSZYKLUS: Worker/iframe erzeugen → Code hineinsenden → Ergebnis/Nachricht zurück → Timeout → terminate/dispose — jede postMessage-Grenze auf Protokoll-Fehler prüfen (falsche Typen, verlorene Responses, Leaks bei Abbruch). (b) ISOLATION: Was kann ausgeführter Code erreichen (Bridge readFile/writeFile, DOM, Netzwerk über Proxy)? Prüfe jede Kanal-Grenze konsequent gegen die Whitelist-Validierung. (c) RESSOURCEN: Worker-Leaks bei geschlossenen Views, Memory bei langen Sessions. Struktur: SECTION [DATEI:ZEILE] mit Schweregrad, Beschreibung, Fix-Vorschlag. Am Ende 3-Satz-Zusammenfassung der Sandbox-Qualität.${METHOD}${STRICT}"

TASK4="Code-Review AUFGABE 4/5 — FUNKTIONSDIMENSION 'END-TO-END DATENFLUSS': Verfolge EINE Benutzeraktion komplett durch alle Schichten bis auf die Platte und zurück — ohne Datei-Grenzen: (1) TRACE CHAT: ChatPanel Eingabe → agent.run() → llm_client Stream → tool-Aufruf write_file → memory.ts/IDB write → Event zurück → UI-Render → saveCurrentSession → listSessions beim Neuladen. An JEDER Grenze: gehen Daten verloren, sind Fehler sichtbar, bleibt der Zustand konsistent (besonders Session-IDs und message-Arrays)? (2) TRACE BACKUP-ROUNDTRIP: exportZip (alle Datentypen: memory, sessions, text-Dateien, Binärdateien) → Datei auf Platte → importZip in einen FRISCHEN und in einen BESTEHENDEN Workspace → sind ALLE Daten nach dem Restore identisch vorhanden? (3) TRACE WORKSPACE-SWITCH: Multi-Workspace-Wechsel mid-session — welche DB-Handles/Caches können auf den falschen Workspace zeigen? Beteiligte Dateien selbständig finden (Einstieg: web/src/core/memory.ts, backup.ts, workspace.ts, db.ts, agent.ts, ChatPanel.ts). Struktur: SECTION [DATEI:ZEILE] mit Schweregrad, Beschreibung, Fix-Vorschlag. Am Ende 3-Satz-Zusammenfassung der Daten-Integrität.${METHOD}${STRICT}"

TASK5="Code-Review AUFGABE 5/5 — FUNKTIONSDIMENSION 'CLIENT/SERVER-GRENZE': Diese Aufgabe ist ein REINES CODE-REVIEW der clientseitigen Dateien, die mit dem Server reden — NICHT der Server-Infrastruktur selbst. Analysiere: web/src/core/cors_fetch.ts, web/src/core/presets.ts, web/src/core/tools/web_tools.ts, web/src/core/tools/app_store_tools.ts und die clientseitige Proxy-Nutzung (per Grep nach '/api/proxy' und 'corsFetch' selbst finden). Flüsse: (a) PROXY-KONSUM: Wann leitet der Client Requests über den Proxy — sind alle Aufrufstellen konsistent, werden Fehler vom Server sauber im UI sichtbar (403/502 nicht still schlucken)? (b) URL/STATUS-HANDLING: Werden Redirects/Content-Types/Status-Codes korrekt behandelt, oder können kaputte Antworten als Daten durchgehen? (c) KONFIG-KONSISTENZ: presets.ts — funktionieren die Presets mit der echten Proxy-URL und in Dev/Prod korrekt? Server-Dateien (server/) NICHT reviewen — nur die Client-Seite der Grenze.${METHOD}${STRICT}"

echo "=== Dimension-Review v2: ${MODEL} | $(date) | $(git rev-parse --short HEAD) ===" >> "$OUT/progress.log"
run_task 1 logic  "$TASK1"
run_task 2 gui    "$TASK2"
run_task 3 sandbox "$TASK3"
run_task 4 dataflow "$TASK4"
run_task 5 infra  "$TASK5"

TOTAL=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l['duration_s'] for l in lines))")
python3 -c "import json; d={'model':'$MODEL','total_duration_s':$TOTAL,'tasks':5}; print(json.dumps(d))" >> "$OUT/timing.jsonl"
echo "[$(date '+%H:%M:%S')] ALLE AUFGABEN FERTIG — Gesamt: ${TOTAL}s" >> "$OUT/progress.log"
echo "Done: $OUT (total: ${TOTAL}s)"
