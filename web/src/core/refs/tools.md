# Tools Referenz

## Datei-Tools
- `read_file({ path })` — Datei aus Workspace lesen
- `write_file({ path, content })` — Datei in Workspace schreiben
- `search_files({ pattern, target?, path? })` — Suche in Dateien (target: 'content' oder 'files')
- `patch({ mode, path, old_string, new_string })` — Datei bearbeiten
  - mode='replace': einfaches find/replace
  - mode='patch': V4A Multi-File Patch

## Code-Ausführung
- `run({ code })` — Komplexes JS in Web Worker (CDN-Imports, fs I/O, render)
- `run_code({ code })` — Kurze JS-Expressions (kein fs, kein CDN)
- `run_app({ title, file })` — HTML-Datei in eigenem Fenster öffnen

## Web
- `web_search({ query, limit? })` — Websuche (Tavily)

## Memory
- `memory_save({ content, category? })` — Fakt speichern (category: 'memory' oder 'user')
- `memory_search({ query, category?, limit? })` — Memory durchsuchen (gibt IDs im Format [#42] zurück)
- `memory_delete({ id })` — Memory-Eintrag per ID löschen
- `memory_update({ id, content, category? })` — Memory-Eintrag per ID aktualisieren

## System
- `error_log({ limit? })` — Fehler-Logs lesen

## Typische Workflows

### Interaktive App erstellen
1. `write_file({ path: 'app.html', content: '<!DOCTYPE html>...' })`
2. `run_app({ title: 'Meine App', file: 'app.html' })`

### Daten analysieren
1. `read_file({ path: 'data.json' })`
2. `run_code({ code: 'JSON.parse(data).filter(...)' })`
3. `write_file({ path: 'report.html', content: '<html>...' })`
4. `run_app({ title: 'Report', file: 'report.html' })`

### Datei bearbeiten
1. `read_file({ path: 'config.json' })`
2. `patch({ mode: 'replace', path: 'config.json', old_string: '...', new_string: '...' })`

### Memory nutzen
1. `memory_search({ query: 'präferenz' })` — Was weiss ich über den User?
2. `memory_save({ content: 'User bevorzugt dunkle Themes', category: 'user' })`
3. `memory_update({ id: 42, content: 'User bevorzugt helle Themes', category: 'user' })` — veralteten Fakt korrigieren
4. `memory_delete({ id: 42 })` — Fakt entfernen