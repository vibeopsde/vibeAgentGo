#!/bin/bash
# vag-review-bench.sh — Generisches LLM-Benchmark-Script für vibeAgentGo Code Review
# Usage: bash vag-review-bench.sh <bifrost-model-id> <output-dir-name>
# Example: bash vag-review-bench.sh "ollama/glm-5.2" "glm-5.2"
#
# Voraussetzungen:
#   - OpenCode CLI installiert, Bifrost-Provider konfiguriert in ~/.opencode/opencode.json
#   - BIFROST_API_KEY in /root/.bashrc oder /opt/bifrost/.env
#   - Repository: /root/vibeAgentGo (oder via VAG_REPO env var)
#
# Output: <output-dir>/{1-core,2-apps,3-wm-ui,4-persist}.md + progress.log + timing.json
set -u

REPO="${VAG_REPO:-/root/vibeAgentGo}"
MODEL="${1:?Usage: $0 <bifrost-model-id> <output-dir-name>}"
NAME="${2:?Usage: $0 <bifrost-model-id> <output-dir-name>}"
OUT="docs/llm-benchmarks/results/${NAME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${REPO}" && pwd)"

# Bifrost Key laden
if [ -z "${BIFROST_API_KEY:-}" ]; then
  export BIFROST_API_KEY=$(grep '^BIFROST_MASTER_VK=' /opt/bifrost/.env 2>/dev/null | cut -d= -f2)
fi
if [ -z "${BIFROST_API_KEY:-}" ]; then
  echo "ERROR: BIFROST_API_KEY nicht gesetzt und nicht in /opt/bifrost/.env gefunden" >&2
  exit 1
fi

mkdir -p "$REPO_DIR/$OUT"
cd "$REPO_DIR" || { echo "ERROR: Repo $REPO_DIR nicht gefunden" >&2; exit 1; }

# Gehärtetes STRICT-Suffix (verhindert vorzeitigen Abbruch bei schwächeren Modellen)
STRICT=' WICHTIG: Dies ist ein vollständiger Arbeitsauftrag, keine Einleitung. Lese ALLE genannten Dateien vollständig, analysiere sie und gib DANN das vollständige Review aus. Beende die Antwort erst, wenn die abschließende 3-Satz-Zusammenfassung geschrieben ist. Eine kurze Bestätigung oder Überschrift allein ist KEINE gültige Antwort.'

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
  # Timing-JSON-Zeile
  python3 -c "import json,sys; print(json.dumps({'task':'$n-$name','model':'$MODEL','rc':$rc,'duration_s':$dur}))" >> "$OUT/timing.jsonl"
}

TASK1="Code-Review AUFGABE 1/4 — CORE: Reviewe die Dateien web/src/core/agent.ts, web/src/core/llm_client.ts, web/src/core/prompt_builder.ts und web/src/core/tools/ (alle Dateien). Fokus: Bugs, Race Conditions, Fehlerbehandlung bei API-Fehlern, Speicherlecks (Event-Listener, Timeouts), Sicherheitsprobleme. Struktur: pro Fund SECTION [DATEI:ZEILE] mit Schweregrad (KRITISCH/HOCH/MITTEL/NIEDRIG), Problembeschreibung, und konkretem Verbesserungsvorschlag. Keine Style-Nitpicks, nur echte Probleme. Am Ende eine 3-Satz-Zusammenfassung der Architektur-Qualität.${STRICT}"

TASK2="Code-Review AUFGABE 2/4 — APPS: Reviewe die Dateien web/src/apps/ExplorerApp.ts, web/src/apps/TextEditorApp.ts, web/src/apps/AppStoreApp.ts, web/src/apps/SettingsApp.ts und web/src/core/appManifest.ts. Fokus: Bugs, DOM-Leaks (Listener die nie entfernt werden), XSS-Risiken (innerHTML mit User-Inhalt), Fehlerbehandlung, Performance bei großen Dateien/Listen. Struktur: pro Fund SECTION [DATEI:ZEILE] mit Schweregrad (KRITISCH/HOCH/MITTEL/NIEDRIG), Problembeschreibung, konkretem Verbesserungsvorschlag. Keine Style-Nitpicks. Am Ende 3-Satz-Zusammenfassung.${STRICT}"

TASK3="Code-Review AUFGABE 3/4 — WINDOW MANAGER + UI: Reviewe web/src/core/window_manager.ts, web/src/components/ChatPanel.ts, web/src/components/RenderPanel.ts, web/src/components/OnboardingWizard.ts. Fokus: Bugs bei Drag/Resize/Touch-Handling, Event-Listener-Leaks, Race Conditions bei Fenster-Fokus, XSS in Chat-Rendering, Memory-Leaks beim Schließen von Fenstern. Struktur: pro Fund SECTION [DATEI:ZEILE] mit Schweregrad (KRITISCH/HOCH/MITTEL/NIEDRIG), Problembeschreibung, konkretem Verbesserungsvorschlag. Keine Style-Nitpicks. Am Ende 3-Satz-Zusammenfassung.${STRICT}"

TASK4="Code-Review AUFGABE 4/4 — PERSISTENZ + INFRA: Reviewe web/src/core/db.ts, web/src/core/app_store_db.ts, web/src/core/memory.ts, web/src/core/workspace.ts, web/src/core/backup.ts, web/src/core/cors_fetch.ts, web/src/core/presets.ts, web/src/main.ts, web/src/core/global_errors.ts. Fokus: Datenverlust-Risiken bei IndexedDB, Fehlerbehandlung, CORS-Proxy-Sicherheit (SSRF?), Backup-Integrität, Race Conditions bei gleichzeitigen DB-Zugriffen. Struktur: pro Fund SECTION [DATEI:ZEILE] mit Schweregrad (KRITISCH/HOCH/MITTEL/NIEDRIG), Problembeschreibung, konkretem Verbesserungsvorschlag. Keine Style-Nitpicks. Am Ende 3-Satz-Zusammenfassung.${STRICT}"

echo "=== Benchmark: ${MODEL} | $(date) ===" >> "$OUT/progress.log"
run_task 1 core  "$TASK1"
run_task 2 apps  "$TASK2"
run_task 3 wm-ui "$TASK3"
run_task 4 persist "$TASK4"

# Gesamt-Zeit
TOTAL=$(python3 -c "import json; lines=[json.loads(l) for l in open('$OUT/timing.jsonl')]; print(sum(l['duration_s'] for l in lines))")
python3 -c "import json; d={'model':'$MODEL','total_duration_s':$TOTAL,'tasks':4}; print(json.dumps(d))" >> "$OUT/timing.jsonl"

echo "[$(date '+%H:%M:%S')] ALLE AUFGABEN FERTIG — Gesamt: ${TOTAL}s" >> "$OUT/progress.log"
echo "Done: $OUT (total: ${TOTAL}s)"