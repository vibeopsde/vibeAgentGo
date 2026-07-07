# UI/CSS Referenz

## Theme-Variablen (CSS Custom Properties)
```
--bg            Hintergrund (dunkel: #0d1117, hell: #ffffff)
--bg-elev       Card/Window Hintergrund
--bg-hover       Hover-Hintergrund
--border        Border-Farbe
--text          Haupt-Textfarbe
--text-muted    Sekundär-Textfarbe
--accent        Akzentfarbe (Blau: #3b82f6)
--accent-hover  Hover-Akzent
--danger        Rot (#ef4444)
--radius        Border-Radius (8px)
--header-h      48px (historisch, nicht mehr genutzt)
```

## Window-Manager Struktur
```
body
  #app (flex column, 100vh)
    .wm-root (flex:1, relative)
      .wm-desktop (flex:1, relative)
        .wm-window (absolute, draggable)
          .wm-window-bar (title bar, drag handle)
            .wm-window-icon
            .wm-window-title
            .wm-window-controls (minimize, close)
          .wm-window-content (flex:1, relative)
            <app content>
          .wm-resize-handle (bottom-right)
      .wm-dock (absolute, bottom:12px, flex)
        .wm-dock-icon (per app)
```

## App-Factory-Muster
Jede App ist eine Klasse die das `App` Interface implementiert:
```ts
interface App {
  id: string;
  title: string;
  icon: string;
  element: HTMLElement;
  mount?(container: HTMLElement): void;
  setData?(data: any): void;
  onFocus?(): void;
  onBlur?(): void;
}
```

## Verfügbare Apps
- `chat` — Chat mit Agent (Dock-Symbol 💬)
- `settings` — Einstellungen (Dock-Symbol ⚙️)
- `explorer` — Datei-Browser (Dock-Symbol 📁)
- `editor` — Text-Editor (Dock-Symbol 📝)
- `program` — HTML-Viewer (kein Dock-Symbol, nur via run_app)