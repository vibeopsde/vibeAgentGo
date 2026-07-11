# Sandbox-Iframe Referenz

## Wie run_app funktioniert
1. Schreibe HTML mit `write_file` in eine Datei (z.B. `app.html`)
2. Rufe `run_app({ title: "...", file: "app.html" })` auf
3. Die Datei wird gelesen und in einem Sandbox-Iframe gerendert

## Sandbox-Einschränkungen
- **null-origin**: `localStorage` und `sessionStorage` sind NICHT verfügbar (werden sicher geshimmt, geben null zurück)
- **Kein CDN**: Externe Scripte/Styles werden durch CSP blockiert
- **Kein file://**: Nur Inline-`<script>` und `<style>` funktionieren
- `allow-scripts allow-forms allow-modals` sind gesetzt

## Verfügbare Bridge-API (window.vibeAgentGo)
```js
// Dateien im Workspace lesen/schreiben
// Die Bridge API antwortet mit einem Wrapper: { ok: true, data: "..." }.
// Der Dateiinhalt steckt in .data, nicht im Rückgabewert selbst.
const result = await window.vibeAgentGo.readFile('data.json');
const content = result?.data ?? '';
await window.vibeAgentGo.writeFile('output.json', '{"result": 42}');
const files = await window.vibeAgentGo.listFiles();

// Memory durchsuchen
const memories = await window.vibeAgentGo.getMemory('präferenz', 'user', 10);

// Konfiguration lesen (API-Key ist maskiert)
const config = await window.vibeAgentGo.getConfig();

// Nachricht an Agenten senden
await window.vibeAgentGo.sendMessage('Erstelle ein Diagramm aus den Daten');
```

## Event-Listener — WICHTIG
Registriere Listener IMMER auf dem Ziel-Element, nie auf document/window:
```js
// ✅ Richtig
canvas.addEventListener('click', handler);
button.addEventListener('click', handler);
input.addEventListener('input', handler);

// ❌ Falsch — funktioniert im Sandbox-Iframe nicht zuverlässig
document.addEventListener('click', handler);
window.addEventListener('keydown', handler);
```

## Canvas-Koordinaten
Nutze `getBoundingClientRect()`, nicht `offsetX/offsetY`:
```js
canvas.addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
});
```

## Tastatur-Input
```js
// Element muss Fokus haben — nach Mount setzen:
canvas.setAttribute('tabindex', '0');
canvas.focus();

canvas.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { /* ... */ }
  e.preventDefault();
});
```

## Touch-Input
```js
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  // ...
}, { passive: false });
```

// Persistenz (statt localStorage)
```js
// Highscore speichern
await window.vibeAgentGo.writeFile('highscore.json', JSON.stringify({ score: 1000 }));
const result = await window.vibeAgentGo.readFile('highscore.json');
const content = result?.data ?? '';
const data = JSON.parse(content || '{}');
```