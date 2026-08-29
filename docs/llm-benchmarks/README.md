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

### Stand: 2026-08-29

| Metric | qwen3.6:35b | qwen3.8:27b | glm-5.2 |
|--------|-------------|-------------|---------|
| Task 1 (Core) | 3,4 min / 121 Zeilen | 57,7 min / 217 Zeilen | 1,2 min / 190 Zeilen |
| Task 2 (Apps) | 2,9 min / 99 Zeilen | 23,6 min / 236 Zeilen | 2,4 min / 538 Zeilen |
| Task 3 (WM+UI) | 2,7 min / 84 Zeilen | 21,4 min / 142 Zeilen | 4,0 min / 283 Zeilen |
| Task 4 (Persist) | 1,9 min / 92 Zeilen | 50,3 min / 111 Zeilen | 1,2 min / 169 Zeilen |
| **Gesamtzeit** | **~11 min** | **~153 min (2,5 h)** | **~8,8 min** |
| **Output gesamt** | 396 Zeilen | 706 Zeilen | 1180 Zeilen |
| **Verhältnis** | 1,3x Referenz | 17,3x langsamer, 1,8x mehr Output | **1× (schnellste)**, 3× mehr Output |

### Genauigkeit (manuell verifiziert)

| Kriterium | qwen3.6:35b | qwen3.8:27b |
|-----------|-------------|-------------|
| Halluzinierte KRITISCH-Bugs | **2** (asNumber "nicht importiert", configClone "undefiniert" — beide widerlegt) | **0** |
| Server-side Proxy geprüft (SSRF) | Nein — nur Client betrachtet | **Ja** — `proxy_server.py` gelesen, Redirect-Bypass + Authorization-Leak gefunden |
| `agent.ts:303` Substring-Match-Bug | **Ja** (echter Treffer) | Nein — dafür andere agent.ts-Bugs (fire-and-forget ohne Abort, Reentrance) |
| Pointer-Capture-Leak | Ja (kurz) | **Ja** — präzise: `pointercancel` → `InvalidPointerIdError` bricht Cleanup ab, `finally`-Empfehlung |
| ChatPanel-Leak | Ja (generisch) | **Ja** — detailliert: Debounce-Timer kontaminiert neues Stream-Element + `attachments`-Race |
| Dateiabdeckung | nur genannte Dateien | **+50%** — selbstständig AppController, worker-sandbox, types/index.ts, server/proxy gelesen |
| Neue echte Funde (überlappend) | 4 | **~12** (u.a. V4A-Hunk-Trailing-Context, `sanitizeHeader` löscht Non-ASCII aus API-Key, `memory_save` ohne Length-Cap, `focusWindow` ohne Guard → Feedback-Loop) |

### Bewertung

**qwen3.6:35b** — schnell, oberflächlich. Gut für einen ersten Überblick, aber ~30% der KRITISCH-Funde waren halluziniert. Der serverseitige SSRF-Proxy wurde komplett übersehen. Brauchbar als Kandidatenliste, wenn jeder Fund manuell verifiziert wird.

**qwen3.8:27b** — 17,3x langsamer als glm-5.2, dafür 0 Halluzinationen bei den getesteten Fällen. Untersucht selbstständig verwandten Code (Server, Types, Sandbox), findet deutlich mehr echte Probleme und liefert konkrete Fix-Vorschläge mit korrekten Zeilenummern. Der agent.ts:303-Bug wurde verpasst, dafür 12 andere echte gefunden, die 3.6 nie sah.

**glm-5.2** — schnellste Gesamtzeit (8,8 min) bei höchstem Output (1180 Zeilen, 3× mehr als qwen3.6). Findet die gleichen kritischen Sicherheitslücken (Path-Traversal, XSS via innerHTML, SSRF via CORS-Proxy, Bridge-Hijacking) wie qwen3.8, zusätzlich DOM-Leak-Analyse und Race-Condition-Details. Alle 4 Tasks vollständig mit 3-Satz-Zusammenfassung. Output-Qualität im Bereich Core/Persistenz dicht, bei Apps extrem ausführlich (538 Zeilen). Muss noch auf Halluzinationen verifiziert werden — die initiale Lesung wirkt aber solide (konkrete Zeilennummern, plausible Code-Zusammenhänge).

**Empfehlung:** glm-5.2 als Default für Code-Reviews — schnell, umfangreich und findet die kritischen Issues. qwen3.8:27b für finale Tiefe wenn Zeit spielt und 0-Halluzination-Garantie braucht. qwen3.6:35b nur für schnelles Trichting.

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
    └── qwen3.8-27b/
        └── ...
    └── glm-5.2/
        └── ...
```

## Wartung

- Bei neuen Modellen: Script ausführen, Results in `results/<name>/` ablegen, Tabelle oben ergänzen
- Bei Code-Änderungen (neue Version): bestehende Results archivieren, Neulauf mit aktuellem Commit
- timing.jsonl ist maschinenlesbar (JSONL) für programmatische Auswertung