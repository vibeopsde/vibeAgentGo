// ============================================================
// vibeAgentGo — Window Manager
// Desktop: floating canvas windows + dock
// Mobile: full-screen horizontal scroll spaces ("spaces") + dock
// ============================================================

import type { App, AppFactory, AppWindow, OpenWindowOptions, WindowManagerEventMap } from '../types/index.js';

interface WindowData {
  data?: Record<string, unknown>;
}

interface AppMetadata {
  factory: AppFactory;
  showInDock: boolean;
  title: string;
  icon: string;
}

export class WindowManager {
  element: HTMLElement;
  private desktop: HTMLElement;
  private spaces: HTMLElement;
  private dock: HTMLElement;
  private apps = new Map<string, AppMetadata>();
  private windows = new Map<string, AppWindow>();
  private windowData = new Map<string, WindowData>();
  private instances = new Map<string, App>(); // windowId -> app instance
  private activeWindowId: string | null = null;
  private zCounter = 100;
  private isProgrammaticScroll = false;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private snapPreview: HTMLElement;
  private listeners: {
    [K in keyof WindowManagerEventMap]?: Array<(ev: WindowManagerEventMap[K]) => void>;
  } = {};
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'wm-root';

    this.desktop = document.createElement('div');
    this.desktop.className = 'wm-desktop';

    this.spaces = document.createElement('div');
    this.spaces.className = 'wm-spaces';

    this.dock = document.createElement('div');
    this.dock.className = 'wm-dock';

    this.snapPreview = document.createElement('div');
    this.snapPreview.className = 'wm-snap-preview';
    this.snapPreview.style.display = 'none';

    this.element.appendChild(this.desktop);
    this.element.appendChild(this.spaces);
    this.element.appendChild(this.dock);
    this.desktop.appendChild(this.snapPreview);

    this.spaces.addEventListener('scroll', () => {
      // Ignore scroll events that we triggered via scrollToSpace().
      if (this.isProgrammaticScroll) return;
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => this.updateActiveSpaceOnScroll(), 120);
    });
    this.updateModeClass();
    window.addEventListener('resize', () => {
      this.updateModeClass();
      this.reflowMaximizedWindows();
    });
  }

  private updateModeClass() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    this.element.classList.toggle('mobile', isMobile);
    this.desktop.classList.toggle('hidden', isMobile);
    this.spaces.classList.toggle('hidden', !isMobile);
    // When switching to mobile, ensure the active space is marked visible.
    // If there is no tracked active window, fall back to the first space so the deck is never blank.
    if (isMobile) {
      const spaces = Array.from(this.spaces.querySelectorAll('.wm-space')) as HTMLElement[];
      if (spaces.length) {
        const activeId = this.activeWindowId || spaces[0].dataset.windowId || null;
        if (activeId) this.syncActiveSpace(activeId);
      }
    }
  }

  private syncActiveSpace(activeId: string) {
    const spaces = Array.from(this.spaces.querySelectorAll('.wm-space')) as HTMLElement[];
    for (const space of spaces) {
      const isActive = space.dataset.windowId === activeId;
      space.classList.toggle('active', isActive);
    }
  }

  on<K extends keyof WindowManagerEventMap>(event: K, handler: (ev: WindowManagerEventMap[K]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event]!.push(handler);
  }

  off<K extends keyof WindowManagerEventMap>(event: K, handler: (ev: WindowManagerEventMap[K]) => void) {
    const handlers = this.listeners[event];
    if (handlers) this.listeners[event] = handlers.filter((h) => h !== handler) as typeof handlers;
  }

  private emit<K extends keyof WindowManagerEventMap>(event: K, ev: WindowManagerEventMap[K]) {
    this.listeners[event]?.forEach((h) => h(ev));
  }

  registerApp(appId: string, factory: AppFactory, showInDock = true) {
    const metadata = factory();
    this.apps.set(appId, {
      factory,
      showInDock,
      title: metadata.title,
      icon: metadata.icon,
    });
    this.updateDock();
  }

  unregisterApp(appId: string) {
    // Close all open windows for this app first.
    for (const [id, win] of this.windows) {
      if (win.appId === appId) {
        this.closeWindow(id);
      }
    }
    this.apps.delete(appId);
    this.updateDock();
  }

  openWindow(opts: OpenWindowOptions): string {
    const entry = this.apps.get(opts.appId);
    if (!entry) throw new Error(`Unknown app: ${opts.appId}`);
    const factory = entry.factory;

    const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const app = factory();

    // Generate title from app metadata unless overridden
    const title = opts.title ?? app.title;
    const icon = app.icon;

    const isMobile = this.element.classList.contains('mobile');

    let element: HTMLElement;
    let contentEl: HTMLElement;

    if (isMobile) {
      // Mobile: space is a full-screen scroll container with its own title bar
      element = document.createElement('div');
      element.className = 'wm-space';
      element.dataset.windowId = id;

      const bar = document.createElement('div');
      bar.className = 'wm-space-bar';
      bar.innerHTML = `
        <span class="wm-space-icon">${icon}</span>
        <span class="wm-space-title">${title}</span>
        <button class="wm-space-close" title="Close" aria-label="Close window">×</button>
      `;
      bar.querySelector('.wm-space-close')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeWindow(id);
      });

      contentEl = document.createElement('div');
      contentEl.className = 'wm-space-content';
      element.appendChild(bar);
      element.appendChild(contentEl);
      this.spaces.appendChild(element);
    } else {
      // Desktop: floating window
      element = document.createElement('div');
      element.className = 'wm-window';
      element.dataset.windowId = id;
      const preBounds = this.chromeBounds();
      const preHeight = Math.min(opts.height ?? 300, preBounds.availableHeight);
      element.style.width = `${opts.width ?? 400}px`;
      element.style.height = `${preHeight}px`;
      element.style.left = `${opts.x ?? 40 + this.windows.size * 20}px`;
      element.style.top = `${opts.y ?? 40 + this.windows.size * 20}px`;
      element.style.zIndex = String(++this.zCounter);

      const bar = document.createElement('div');
      bar.className = 'wm-window-bar';
      bar.innerHTML = `
        <span class="wm-window-icon">${icon}</span>
        <span class="wm-window-title">${title}</span>
        <div class="wm-window-controls">
          <button class="wm-minimize" title="Minimize">_</button>
          <button class="wm-window-close" title="Close">×</button>
        </div>
      `;
      bar.querySelector('.wm-window-close')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeWindow(id);
      });
      bar.querySelector('.wm-minimize')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.minimizeWindow(id);
      });
      bar.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('.wm-window-controls')) return;
        this.toggleMaximize(id);
      });
      bar.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.wm-window-controls')) return;
        this.startDrag(e, id);
      });
      bar.style.touchAction = 'none';

      contentEl = document.createElement('div');
      contentEl.className = 'wm-window-content';
      element.appendChild(bar);
      element.appendChild(contentEl);

      // Resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'wm-resize-handle';
      resizeHandle.addEventListener('pointerdown', (e) => this.startResize(e, id));
      resizeHandle.style.touchAction = 'none';
      element.appendChild(resizeHandle);

      element.addEventListener('pointerdown', () => this.focusWindow(id));
      this.desktop.appendChild(element);
    }

    // Mount app into content area
    if (app.mount) {
      app.mount(contentEl);
    } else if (app.element) {
      contentEl.appendChild(app.element);
    }

    // Clamp window height so it never extends into the dock area.
    const bounds = this.chromeBounds();
    const clampedHeight = Math.min(opts.height ?? 300, bounds.availableHeight);
    const clampedY = Math.min(opts.y ?? bounds.desktopTop, bounds.desktopTop + bounds.availableHeight - clampedHeight);

    const win: AppWindow = {
      id,
      appId: opts.appId,
      title,
      icon,
      element,
      contentEl,
      x: opts.x ?? 40,
      y: clampedY,
      width: opts.width ?? 400,
      height: clampedHeight,
      zIndex: this.zCounter,
      minimized: false,
      maximized: false,
    };

    this.windows.set(id, win);
    this.instances.set(id, app);
    this.windowData.set(id, { data: opts.data });

    // If initial data was passed and the app has setData(), push it now so the
    // app can render its content immediately after mount.
    if (opts.data && app.setData) {
      app.setData(opts.data);
    }

    this.focusWindow(id);
    this.emit('window_opened', { windowId: id, appId: opts.appId });
    this.updateDock();
    return id;
  }

  getInstance(windowId: string): App | undefined {
    return this.instances.get(windowId);
  }

  launchOrFocus(appId: string): string {
    // Find an existing window of this app
    for (const [id, win] of this.windows) {
      if (win.appId === appId) {
        this.focusWindow(id);
        return id;
      }
    }
    return this.openWindow({ appId });
  }

  closeWindow(id: string): boolean {
    const win = this.windows.get(id);
    if (!win) return false;

    const app = this.instances.get(id);
    if (app?.onClose) {
      const result = app.onClose();
      if (result === false) return false;
    }

    app?.element?.remove();
    win.element.remove();
    this.windows.delete(id);
    this.instances.delete(id);
    this.windowData.delete(id);

    if (this.activeWindowId === id) {
      this.activeWindowId = null;
      // Focus last opened window
      let topZ = 0;
      let nextId: string | null = null;
      for (const [wid, w] of this.windows) {
        if (w.zIndex > topZ) {
          topZ = w.zIndex;
          nextId = wid;
        }
      }
      if (nextId) this.focusWindow(nextId);
    }

    this.emit('window_closed', { windowId: id, appId: win.appId });
    this.updateDock();
    return true;
  }

  minimizeWindow(id: string) {
    const win = this.windows.get(id);
    if (!win || this.element.classList.contains('mobile')) return;
    win.element.classList.toggle('minimized', true);
    win.minimized = true;
  }

  toggleMaximize(id: string) {
    const win = this.windows.get(id);
    if (!win || this.element.classList.contains('mobile')) return;
    if (win.minimized) this.focusWindow(id);
    if (win.maximized) this.restoreWindow(id);
    else this.maximizeWindow(id);
  }

  maximizeWindow(id: string) {
    const win = this.windows.get(id);
    if (!win || this.element.classList.contains('mobile')) return;
    if (win.maximized) return;
    const { desktopTop, availableHeight } = this.chromeBounds();
    const vw = window.innerWidth;
    win.restoreBounds = { x: win.x, y: win.y, width: win.width, height: win.height };
    win.maximized = true;
    win.minimized = false;
    win.element.classList.remove('minimized');
    win.element.style.left = '0px';
    win.element.style.top = `${desktopTop}px`;
    win.element.style.width = `${vw}px`;
    win.element.style.height = `${Math.max(availableHeight, 200)}px`;
    win.x = 0;
    win.y = desktopTop;
    win.width = vw;
    win.height = Math.max(availableHeight, 200);
    this.focusWindow(id);
  }

  restoreWindow(id: string) {
    const win = this.windows.get(id);
    if (!win || this.element.classList.contains('mobile')) return;
    const bounds = win.restoreBounds ?? { x: 40, y: 40, width: 400, height: 300 };
    win.maximized = false;
    win.element.classList.remove('minimized');
    win.element.style.left = `${bounds.x}px`;
    win.element.style.top = `${bounds.y}px`;
    win.element.style.width = `${bounds.width}px`;
    win.element.style.height = `${bounds.height}px`;
    win.x = bounds.x;
    win.y = bounds.y;
    win.width = bounds.width;
    win.height = bounds.height;
    this.focusWindow(id);
  }

  focusWindow(id: string) {
    const win = this.windows.get(id);
    if (!win) return;
    if (this.activeWindowId && this.activeWindowId !== id) {
      const prev = this.windows.get(this.activeWindowId);
      prev?.element.classList.remove('focused');
      const prevApp = this.instances.get(this.activeWindowId);
      prevApp?.onBlur?.();
    }
    this.activeWindowId = id;
    win.element.classList.add('focused');
    win.element.classList.remove('minimized');
    win.minimized = false;
    win.element.style.zIndex = String(++this.zCounter);
    win.zIndex = this.zCounter;
    const app = this.instances.get(id);
    app?.onFocus?.();
    this.emit('window_focused', { windowId: id, appId: win.appId });

    if (this.element.classList.contains('mobile')) {
      this.syncActiveSpace(id);
      this.scrollToSpace(id);
    }
    this.updateDock();
  }

  updateWindowData(id: string, data: Record<string, unknown>) {
    const existing = this.windowData.get(id);
    if (existing) {
      existing.data = { ...existing.data, ...data };
    } else {
      this.windowData.set(id, { data });
    }
    // Notify app instance if it exposes a method
    const app = this.instances.get(id);
    const wd = this.windowData.get(id);
    if (app?.setData && wd?.data) {
      app.setData(wd.data);
    }
    // Update window title
    const win = this.windows.get(id);
    if (win && data.title) {
      win.title = String(data.title);
      const titleEl = win.element.querySelector('.wm-window-title') as HTMLElement | null;
      if (titleEl) titleEl.textContent = win.title;
    }
  }

  getWindowData(id: string): Record<string, unknown> | undefined {
    return this.windowData.get(id)?.data;
  }

  getWindowsByApp(appId: string): string[] {
    return Array.from(this.windows.entries())
      .filter(([, win]) => win.appId === appId)
      .map(([id]) => id);
  }

  private updateDock() {
    this.dock.innerHTML = '';
    const staticAppIds = new Set<string>();

    // 1) Registered apps that have a static dock icon.
    for (const [appId, entry] of this.apps) {
      if (!entry.showInDock) continue;
      staticAppIds.add(appId);
      const btn = this.createDockIcon(entry.icon, entry.title, () => this.launchOrFocus(appId));
      const hasOpen = Array.from(this.windows.values()).some((w) => w.appId === appId);
      btn.style.opacity = hasOpen ? '1' : '0.7';
      this.dock.appendChild(btn);
    }

    // 2) Open windows for apps that are NOT in the static dock.
    // Each window gets its own icon so run_app / KI / Explorer windows are reachable.
    for (const win of this.windows.values()) {
      if (staticAppIds.has(win.appId)) continue;
      const isActive = win.id === this.activeWindowId;
      const btn = this.createDockIcon(win.icon, win.title, () => this.focusWindow(win.id));
      btn.dataset.windowId = win.id;
      btn.classList.toggle('active', isActive);
      btn.style.opacity = isActive ? '1' : '0.85';
      this.dock.appendChild(btn);
    }

    // After the dock content changes, its height may change (e.g. icons added
    // asynchronously after a reload). Reflow maximized windows so they respect
    // the new dock height and don't overlap it.
    this.reflowMaximizedWindows();
  }

  /** Recalculate geometry for all maximized windows using current chromeBounds. */
  private reflowMaximizedWindows() {
    if (this.element.classList.contains('mobile')) return;
    const { desktopTop, availableHeight } = this.chromeBounds();
    const vw = window.innerWidth;
    for (const win of this.windows.values()) {
      if (!win.maximized) continue;
      win.element.style.top = `${desktopTop}px`;
      win.element.style.width = `${vw}px`;
      win.element.style.height = `${Math.max(availableHeight, 200)}px`;
      win.y = desktopTop;
      win.height = Math.max(availableHeight, 200);
    }
  }

  private createDockIcon(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'wm-dock-icon';
    btn.innerHTML = `<span class="wm-dock-icon-emoji">${icon}</span><span class="wm-dock-icon-label">${title}</span>`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private scrollToSpace(id: string) {
    const space = this.spaces.querySelector(`.wm-space[data-window-id="${id}"]`) as HTMLElement | null;
    if (!space) return;
    // Set guard so scroll events from this programmatic scroll don't fight us.
    this.isProgrammaticScroll = true;
    space.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    // Clear guard after scroll animation completes (~350ms with CSS smooth scroll).
    setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, 400);
  }

  private updateActiveSpaceOnScroll() {
    const spaces = Array.from(this.spaces.querySelectorAll('.wm-space')) as HTMLElement[];
    if (!spaces.length) return;
    const containerRect = this.spaces.getBoundingClientRect();
    const center = containerRect.left + containerRect.width / 2;
    let closest: HTMLElement | null = null;
    let minDist = Infinity;
    for (const space of spaces) {
      const rect = space.getBoundingClientRect();
      const spaceCenter = rect.left + rect.width / 2;
      const dist = Math.abs(spaceCenter - center);
      if (dist < minDist) {
        minDist = dist;
        closest = space;
      }
    }
    if (closest) {
      const id = closest.dataset.windowId!;
      this.focusWindow(id);
    }
  }

  private startDrag(e: PointerEvent, id: string) {
    if (this.element.classList.contains('mobile')) return;
    const win = this.windows.get(id);
    if (!win || win.maximized) return;
    this.focusWindow(id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = win.element.offsetLeft;
    const startTop = win.element.offsetTop;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      win.element.style.left = `${startLeft + dx}px`;
      win.element.style.top = `${startTop + dy}px`;
      // Live snap-zone preview
      this.updateSnapPreview(ev.clientX, ev.clientY);
    };
    const onPointerUp = (ev: PointerEvent) => {
      (ev.target as HTMLElement).releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      this.hideSnapPreview();
      this.snapWindow(id, ev.clientX, ev.clientY);
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  }

  // Returns the bounding rectangle of the fixed app chrome that limits the desktop area.
  // Windows are positioned absolutely within .wm-desktop, which already sits below the
  // app header. So we must NOT subtract headerHeight — that would cause a double offset.
  // The dock is position:absolute inside .wm-root (the same offset container as .wm-desktop),
  // so its top edge marks the bottom limit for snapped windows.
  private chromeBounds() {
    const dockBottom = 12; // CSS bottom of .wm-dock
    const dockGap = 8; // visual clearance above the dock
    // Fallback dock height when the dock has no icons yet (e.g. right after reload
    // before updateDock() runs). 56px matches the CSS padding-bottom on mobile spaces.
    const dockHeight = this.dock.offsetHeight || 56;
    const dockTop = window.innerHeight - dockBottom - dockHeight;
    // No more app header — desktop starts at top of viewport.
    const desktopTop = 0;
    const availableHeight = dockTop - desktopTop - dockGap;
    return { desktopTop, availableHeight };
  }

  private snapWindow(id: string, clientX: number, clientY: number) {
    const win = this.windows.get(id);
    if (!win) return;
    const zone = this.getSnapZone(clientX, clientY);
    if (!zone) return;
    // Top edge => full-screen maximize; left/right => half-screen geometry.
    if (zone.width === window.innerWidth) {
      this.maximizeWindow(id);
    } else {
      if (win.maximized) win.maximized = false;
      win.element.style.left = `${zone.left}px`;
      win.element.style.top = `${zone.top}px`;
      win.element.style.width = `${zone.width}px`;
      win.element.style.height = `${zone.height}px`;
      win.x = zone.left;
      win.y = zone.top;
      win.width = zone.width;
      win.height = zone.height;
    }
  }

  /** Returns the snap rectangle for the given pointer position, or null if no snap zone is active. */
  private getSnapZone(
    clientX: number,
    clientY: number
  ): { left: number; top: number; width: number; height: number } | null {
    const vw = window.innerWidth;
    const snapThreshold = 40;
    const { availableHeight } = this.chromeBounds();

    // Top edge => full width, full usable height (dock stays visible)
    if (clientY <= snapThreshold) {
      return { left: 0, top: 0, width: vw, height: Math.max(availableHeight, 200) };
    }
    // Left half
    if (clientX <= snapThreshold) {
      return { left: 0, top: 0, width: Math.floor(vw / 2), height: Math.max(availableHeight, 200) };
    }
    // Right half
    if (clientX >= vw - snapThreshold) {
      return { left: Math.floor(vw / 2), top: 0, width: Math.ceil(vw / 2), height: Math.max(availableHeight, 200) };
    }
    return null;
  }

  /** Shows or updates the snap preview overlay based on the current pointer position. */
  private updateSnapPreview(clientX: number, clientY: number) {
    const zone = this.getSnapZone(clientX, clientY);
    if (!zone) {
      this.hideSnapPreview();
      return;
    }
    this.snapPreview.style.display = 'block';
    this.snapPreview.style.left = `${zone.left}px`;
    this.snapPreview.style.top = `${zone.top}px`;
    this.snapPreview.style.width = `${zone.width}px`;
    this.snapPreview.style.height = `${zone.height}px`;
  }

  private hideSnapPreview() {
    this.snapPreview.style.display = 'none';
  }

  private startResize(e: PointerEvent, id: string) {
    if (this.element.classList.contains('mobile')) return;
    const win = this.windows.get(id);
    if (!win || win.maximized) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = win.element.offsetWidth;
    const startHeight = win.element.offsetHeight;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      win.element.style.width = `${Math.max(160, startWidth + dx)}px`;
      win.element.style.height = `${Math.max(120, startHeight + dy)}px`;
    };
    const onPointerUp = (ev: PointerEvent) => {
      (ev.target as HTMLElement).releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  }
}
