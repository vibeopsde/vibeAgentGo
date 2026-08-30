# LLM Benchmark — vibeAgentGo Code Review

Vergleich verschiedener LLMs (via Bifrost Gateway / Mac Studio Evo X2) anhand eines realen Code-Reviews der vibeAgentGo-Codebasis (~11.200 Zeilen TypeScript).

## Setup

- **Gateway:** Bifrost v1.6.11 (Docker) auf ki.vibeops.de, Backend: Ollama auf GMKtec Evo X2 (AMD Ryzen AI Max+ 395)
- **Agent:** OpenCode CLI 1.18.25, Provider `bifrost` (OpenAI-compatible)
- **Repo:** `/root/vibeAgentGo` (v2608.1.0, Commit 218713e)
- **Modus:** 4 sequenzielle Teilaufgaben (Core, Apps, WindowManager+UI, Persistenz), jeweils identischer Prompt, gehärtet mit STRICT-Suffix gegen vorzeitigen Abbruch

## Script

```bash
# Generischer Aufruf für jedes Modell:
bash docs/llm-benchmarks/scripts/vag-review-bench.sh "ollama/<model>" "<name>"

# Beispiel:
bash docs/llm-benchmarks/scripts/vag-review-bench.sh "ollama/qwen3.8:27b" "qwen3.8-27b"
bash docs/llm-benchmarks/scripts/vag-review-bench.sh "ollama/glm-5.2" "glm-5.2"
```

Output landet in `results/<name>/` mit `{1-core,2-apps,3-wm-ui,4-persist}.md`, `progress.log` und `timing.jsonl`.

## Ergebnisse

### Stand: 2026-08-30

| Metric | qwen3.6:35b | qwen3.8:27b | qwen3.8:27b (Q4 KV) | glm-5.2 |
|--------|-------------|-------------|----------------------|---------|
| Task 1 (Core) | 3,4 min / 121 Zeilen | 57,7 min / 217 Zeilen | 26,2 min / 127 Zeilen | 1,2 min / 190 Zeilen |
| Task 2 (Apps) | 2,9 min / 99 Zeilen | 23,6 min / 236 Zeilen | 24,8 min / 170 Zeilen | 2,4 min / 538 Zeilen |
| Task 3 (WM+UI) | 2,7 min / 84 Zeilen | 21,4 min / 142 Zeilen | 22,5 min / 126 Zeilen | 4,0 min / 283 Zeilen |
| Task 4 (Persist) | 1,9 min / 92 Zeilen | 50,3 min / 111 Zeilen | 11,9 min / 87 Zeilen | 1,2 min / 169 Zeilen |
| **Gesamtzeit** | **~11 min** | **~153 min (2,5 h)** | **~85 min (1,4 h)** | **~8,8 min** |
| **Output gesamt** | 396 Zeilen | 706 Zeilen | 506 Zeilen | 1180 Zeilen |
| **Verhältnis** | 1,3x Referenz | 17,3x langsamer | **9,7x langsamer** (1,8x schneller als ohne Q4) | **1× (schnellste)**, 3× mehr Output |

**Q4 KV-Cache-Effekt (qwen3.8:27b):** 5121s vs 9178s = **1,79x schneller**, gleiche 0-Halluzination-Qualität. Task 1 (Core) profitierte am meisten (57,7→26,2 min), Task 4 (Persist) halbiert (50,3→11,9 min). Output-Volumen leicht reduziert (706→506 Zeilen), aber alle Funde verifiziert korrekt.

### Genauigkeit (manuell verifiziert)

| Kriterium | qwen3.6:35b | qwen3.8:27b | qwen3.8:27b (Q4 KV) |
|-----------|-------------|-------------|---------------------|
| Halluzinierte KRITISCH-Bugs | **2** (asNumber "nicht importiert", configClone "undefiniert" — beide widerlegt) | **0** | **0** (alle 4 KRITISCH-Funde gegen Code verifiziert) |
| Server-side Proxy geprüft (SSRF) | Nein — nur Client betrachtet | **Ja** — `proxy_server.py` gelesen, Redirect-Bypass + Authorization-Leak gefunden | **Ja** — ebenfalls `proxy_server.py` gelesen, SSRF + Cookie-Leak gefunden |
| `agent.ts:303` Substring-Match-Bug | **Ja** (echter Treffer) | Nein — dafür andere agent.ts-Bugs (fire-and-forget ohne Abort, Reentrance) | Nein — stattdessen Race-Condition via fehlendem `isRunning`-Guard gefunden |
| Pointer-Capture-Leak | Ja (kurz) | **Ja** — präzise: `pointercancel` → `InvalidPointerIdError` bricht Cleanup ab, `finally`-Empfehlung | Ja — Window-Manager Listener-Leaks beim Schließen |
| ChatPanel-Leak | Ja (generisch) | **Ja** — detailliert: Debounce-Timer kontaminiert neues Stream-Element + `attachments`-Race | Ja — ChatPanel `handleFiles` Race + Attachments-Duplikat |
| Dateiabdeckung | nur genannte Dateien | **+50%** — selbstständig AppController, worker-sandbox, types/index.ts, server/proxy gelesen | **+40%** — selbstständig `memory.ts`, `logger.ts`, `proxy_server.py`, `SettingsWorkspaceSection.ts` gelesen |
| Neue echte Funde (überlappend) | 4 | **~12** (u.a. V4A-Hunk-Trailing-Context, `sanitizeHeader` löscht Non-ASCII aus API-Key, `memory_save` ohne Length-Cap, `focusWindow` ohne Guard → Feedback-Loop) | **~8** (u.a. `run()` Race-Condition, `done`-Event fehlt bei Abort/Retry, `appManifest.ts` JSON-Extraktion bricht bei `</script>` in Strings, Backup-Binärdaten-Verlust) |

### Bewertung

**qwen3.6:35b** — schnell, oberflächlich. Gut für einen ersten Überblick, aber ~30% der KRITISCH-Funde waren halluziniert. Der serverseitige SSRF-Proxy wurde komplett übersehen. Brauchbar als Kandidatenliste, wenn jeder Fund manuell verifiziert wird.

**qwen3.8:27b** — 17,3x langsamer als glm-5.2, dafür 0 Halluzinationen bei den getesteten Fällen. Untersucht selbstständig verwandten Code (Server, Types, Sandbox), findet deutlich mehr echte Probleme und liefert konkrete Fix-Vorschläge mit korrekten Zeilenummern. Der agent.ts:303-Bug wurde verpasst, dafür 12 andere echte gefunden, die 3.6 nie sah.

**glm-5.2** — schnellste Gesamtzeit (8,8 min) bei höchstem Output (1180 Zeilen, 3× mehr als qwen3.6). Findet die gleichen kritischen Sicherheitslücken (Path-Traversal, XSS via innerHTML, SSRF via CORS-Proxy, Bridge-Hijacking) wie qwen3.8, zusätzlich DOM-Leak-Analyse und Race-Condition-Details. Alle 4 Tasks vollständig mit 3-Satz-Zusammenfassung. Output-Qualität im Bereich Core/Persistenz dicht, bei Apps extrem ausführlich (538 Zeilen). Muss noch auf Halluzinationen verifiziert werden — die initiale Lesung wirkt aber solide (konkrete Zeilennummern, plausible Code-Zusammenhänge).

**qwen3.8:27b (Q4 KV)** — mit Q4-KV-Cache-Quantisierung 1,79x schneller als ohne Q4 (85 vs 153 min), bei gleicher Qualität: 0 Halluzinationen, liest selbstständig `proxy_server.py` und `memory.ts`, findet die gleichen kritischen Issues (SSRF, Race-Condition, Backup-Datenverlust). Output etwas kompakter (506 vs 706 Zeilen), aber dichter und präziser. Die Q4-Quantisierung ist ein klarer Win — gleiche Tiefe, deutlich schneller.

**Empfehlung:** glm-5.2 als Default für Code-Reviews — schnell, umfangreich und findet die kritischen Issues. qwen3.8:27b (Q4 KV) für finale Tiefe wenn Zeit spielt und 0-Halluzination-Garantie braucht — mit Q4 nun in 85 min statt 2,5 h realistisch einsetzbar. qwen3.6:35b nur für schnelles Triage.

## Fix-Benchmark (Umsetzung von Review-Findings)

Zweiter Benchmark-Typ: statt Review soll das Modell verifizierte Fixes umsetzen. `scripts/vag-fix-bench.sh "ollama/qwen3.8:27b" "qwen3.8-27b-fixes"` — 5 Arbeitspakete (APs) aus den 0-Halluzination-Funden des qwen3.8-27b-q4 Reviews, sequenziell via `opencode run`, pro AP: tsc-Verifikation → 1 Repair-Run falls nötig → Auto-Commit auf Branch `bench/fix-<name>`.

### Stand: 2026-08-30 — qwen3.8:27b (Q4 KV), Basis commit aff7ae9

| AP | Paket | Dauer | tsc | Repair |
|----|-------|-------|-----|--------|
| AP1 | agent.ts: run()-Race, done-Event, emit-Isolation | 352 s (5,9 min) | ✅ 1. Versuch | 0 |
| AP2 | ExplorerApp: Listener-Leak (unmount+WM-Teardown), Pfad-Validierung | 719 s (12,0 min) | ✅ 1. Versuch | 0 |
| AP3 | RenderPanel: `</script>`-Escape, Bridge source-Check + Whitelist, dispose() | 434 s (7,2 min) | ✅ 1. Versuch | 0 |
| AP4 | backup.ts: Binärdaten als base64+kind:'binary', Payload-Validierung, Legacy-Skip | 3775 s (62,9 min) | ✅ 1. Versuch | 0 |
| AP5 | proxy_server.py: SSRF-Guard (DNS-Auflösung + ipaddress), Redirect-Recheck, Header-Whitelist | 660 s (11,0 min) | ✅ 1. Versuch | 0 |
| **Gesamt** | 5 APs, 15 Dateien, +2383/−54 Zeilen | **5940 s (99 min)** | **5/5 grün** | **0** |

### Runde 2 — Review auf v2608.3.0 + Fix-Loop (2026-08-30)

Iterative Schleife: Nach v2608.3.0 erneut Review (gleiche Prompts) → 7286s (121 min). **Alle 10 Round-1-Fixes bestätigt** (alte Issues nicht wiedergefunden), dafür **2 echte Bugs in den Round-1-Fixes selbst** (doppelte done-Emission, Reject-Pfad korrumpiert laufenden Run) + neue Funde (window_manager XSS via title/icon, rename ohne Pfad-Validierung, Backup-Import nicht atomar trotz Kommentar). Fix-Runde 2 (`scripts/vag-fix-bench-round2.sh`): 4 APs, **2382s (40 min), 4/4 tsc grün, 0 Repairs**, 64/64 Tests → **v2608.3.1**.

| AP | Paket | Dauer |
|----|-------|-------|
| AP1 | agent.ts: single done-emission, reject-path isolation | 573 s |
| AP2 | window_manager.ts: escapeHtml title/icon (XSS) | 274 s |
| AP3 | ExplorerApp/TextEditorApp: assertSafePath bei rename/move/saveAs | 681 s |
| AP4 | backup.ts: atomarer Import (bulk-tx), db.ts runTx batch | 854 s |

**Loop-Muster:** Runde 1 Fixes 99 min → Runde 2 Review findet Bugs in Runde-1-Fixes → Runde 2 Fixes nur 40 min. Die Schleife konvergiert — jede Runde findet die nächste Schicht, kein neuer KRITISCH-Fund in altem Code.

## Verzeichnisstruktur

```
docs/llm-benchmarks/
├── README.md                          # Diese Datei
├── scripts/
│   └── vag-review-bench.sh            # Generisches Benchmark-Script
└── results/
    ├── qwen3.6-35b/                   # Roh-Ergebnisse pro Modell
    │   ├── 1-core.md
    │   ├── 2-apps.md
    │   ├── 3-wm-ui.md
    │   ├── 4-persist.md
    │   ├── progress.log
    │   └── timing.jsonl
    ├── qwen3.8-27b/               # ohne Q4 KV-Quantisierung (9178s)
    │   └── ...
    ├── qwen3.8-27b-q4/            # mit Q4 KV-Quantisierung (5121s)
    │   └── ...
    └── glm-5.2/
        └── ...
```

## Wartung

- Bei neuen Modellen: Script ausführen, Results in `results/<name>/` ablegen, Tabelle oben ergänzen
- Bei Code-Änderungen (neue Version): bestehende Results archivieren, Neulauf mit aktuellem Commit
- timing.jsonl ist maschinenlesbar (JSONL) für programmatische Auswertung