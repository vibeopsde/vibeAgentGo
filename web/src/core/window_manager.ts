// ============================================================
// vibeAgentGo — Window Manager
// Desktop: floating canvas windows + dock
// Mobile: full-screen horizontal scroll spaces ("spaces") + dock
// ============================================================

import type { App, AppFactory, AppWindow, OpenWindowOptions, WindowManagerEventMap } from '../types/index.js';

interface WindowData {
  data?: Record<string, unknown>;
}

export class WindowManager {
  element: HTMLElement;
  private desktop: HTMLElement;
  private spaces: HTMLElement;
  private dock: HTMLElement;
  private apps = new Map<string, AppFactory>();
  private windows = new Map<string, AppWindow>();
  private windowData = new Map<string, WindowData>();
  private instances = new Map<string, App>(); // windowId -> app instance
  private activeWindowId: string | null = null;
  private zCounter = 100;
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

    this.element.appendChild(this.desktop);
    this.element.appendChild(this.spaces);
    this.element.appendChild(this.dock);

    this.spaces.addEventListener('scroll', () => this.updateActiveSpaceOnScroll());
    this.updateModeClass();
    window.addEventListener('resize', () => this.updateModeClass());
  }

  private updateModeClass() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    this.element.classList.toggle('mobile', isMobile);
    this.desktop.classList.toggle('hidden', isMobile);
    this.spaces.classList.toggle('hidden', !isMobile);
    // When switching to mobile, ensure the active space is marked visible
    if (isMobile && this.activeWindowId) {
      this.syncActiveSpace(this.activeWindowId);
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
    if (handlers) this.listeners[event] = handlers.filter((h) => h !== handler) as any;
  }

  private emit<K extends keyof WindowManagerEventMap>(event: K, ev: WindowManagerEventMap[K]) {
    this.listeners[event]?.forEach((h) => h(ev as any));
  }

  registerApp(appId: string, factory: AppFactory) {
    this.apps.set(appId, factory);
    this.updateDock();
  }

  openWindow(opts: OpenWindowOptions): string {
    const factory = this.apps.get(opts.appId);
    if (!factory) throw new Error(`Unknown app: ${opts.appId}`);

    const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const app = factory();

    // Generate title from app metadata unless overridden
    const title = opts.title ?? app.title;
    const icon = app.icon;

    const isMobile = this.element.classList.contains('mobile');

    let element: HTMLElement;
    let contentEl: HTMLElement;

    if (isMobile) {
      // Mobile: space is a full-screen scroll container
      element = document.createElement('div');
      element.className = 'wm-space';
      element.dataset.windowId = id;
      contentEl = element; // app mounts directly in the space
      this.spaces.appendChild(element);
    } else {
      // Desktop: floating window
      element = document.createElement('div');
      element.className = 'wm-window';
      element.dataset.windowId = id;
      element.style.width = `${opts.width ?? 400}px`;
      element.style.height = `${opts.height ?? 300}px`;
      element.style.left = `${opts.x ?? 40 + (this.windows.size * 20)}px`;
      element.style.top = `${opts.y ?? 40 + (this.windows.size * 20)}px`;
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
      bar.addEventListener('pointerdown', (e) => this.startDrag(e, id));
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

    const win: AppWindow = {
      id,
      appId: opts.appId,
      title,
      icon,
      element,
      contentEl,
      x: opts.x ?? 40,
      y: opts.y ?? 40,
      width: opts.width ?? 400,
      height: opts.height ?? 300,
      zIndex: this.zCounter,
      minimized: false,
    };

    this.windows.set(id, win);
    this.instances.set(id, app);
    this.windowData.set(id, { data: opts.data });

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
    const app = this.instances.get(id) as any;
    if (app?.setData) {
      app.setData(this.windowData.get(id)!.data);
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
    for (const [appId, factory] of this.apps) {
      // Instantiate a temporary app just to read metadata is expensive/fragile.
      // Better: apps store metadata separately; but for now, get the first
      // running instance of this app to read its title/icon, or create a dummy.
      const instance = Array.from(this.instances.values()).find((a) => a.id === appId);
      const app = instance ?? factory();
      const btn = document.createElement('button');
      btn.className = 'wm-dock-icon';
      btn.innerHTML = `<span class="wm-dock-icon-emoji">${app.icon}</span><span class="wm-dock-icon-label">${app.title}</span>`;
      const hasOpen = Array.from(this.windows.values()).some((w) => w.appId === appId);
      btn.style.opacity = hasOpen ? '1' : '0.7';
      btn.addEventListener('click', () => this.launchOrFocus(appId));
      this.dock.appendChild(btn);
    }
  }

  private scrollToSpace(id: string) {
    const space = this.spaces.querySelector(`.wm-space[data-window-id="${id}"]`) as HTMLElement | null;
    if (space) {
      space.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    }
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
    if (!win) return;
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
    };
    const onPointerUp = (ev: PointerEvent) => {
      (ev.target as HTMLElement).releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      this.snapWindow(id, ev.clientX, ev.clientY);
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  }

  private snapWindow(id: string, clientX: number, clientY: number) {
    const win = this.windows.get(id);
    if (!win) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const snapThreshold = 40;
    const headerHeight = 48;
    const dockBottom = 12;
    const dockGap = 8;
    const dockOffset = this.dock.offsetHeight + dockBottom + dockGap;
    const maxHeight = vh - dockOffset - headerHeight;

    // Top edge => full screen below header, keeping dock visible
    if (clientY <= snapThreshold) {
      win.element.style.left = '0px';
      win.element.style.top = `${headerHeight}px`;
      win.element.style.width = `${vw}px`;
      win.element.style.height = `${maxHeight}px`;
      return;
    }

    // Left half
    if (clientX <= snapThreshold) {
      win.element.style.left = '0px';
      win.element.style.top = `${headerHeight}px`;
      win.element.style.width = `${Math.floor(vw / 2)}px`;
      win.element.style.height = `${maxHeight}px`;
      return;
    }

    // Right half
    if (clientX >= vw - snapThreshold) {
      win.element.style.left = `${Math.floor(vw / 2)}px`;
      win.element.style.top = `${headerHeight}px`;
      win.element.style.width = `${Math.ceil(vw / 2)}px`;
      win.element.style.height = `${maxHeight}px`;
      return;
    }
  }

  private startResize(e: PointerEvent, id: string) {
    if (this.element.classList.contains('mobile')) return;
    const win = this.windows.get(id);
    if (!win) return;
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
