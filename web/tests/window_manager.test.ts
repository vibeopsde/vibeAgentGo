import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WindowManager } from '../src/core/window_manager.js';
import type { App } from '../src/types/index.js';

class DummyApp implements App {
  id = 'dummy';
  title = 'Dummy';
  icon = '🧪';
  element = document.createElement('div');
  mount(container: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(this.element);
  }
}

describe('WindowManager', () => {
  let wm: WindowManager;

  beforeEach(() => {
    wm = new WindowManager();
    document.body.appendChild(wm.element);
    wm.registerApp('dummy', () => new DummyApp());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles maximize on double-click of the title bar', () => {
    const id = wm.openWindow({ appId: 'dummy', x: 40, y: 40, width: 400, height: 300 });
    const win = (wm as any).windows.get(id) as {
      maximized: boolean;
      minimized: boolean;
      x: number;
      y: number;
      width: number;
      height: number;
      element: HTMLElement;
    };
    const bar = win.element.querySelector('.wm-window-bar') as HTMLElement;

    expect(win.maximized).toBe(false);
    expect(win.minimized).toBe(false);
    expect(win.width).toBe(400);
    expect(win.height).toBe(300);

    // Double-click the title bar -> maximize
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(win.maximized).toBe(true);
    expect(win.width).toBe(window.innerWidth);
    expect(win.element.style.left).toBe('0px');
    expect(win.element.style.top).toBe('0px');

    // Second double-click -> restore previous bounds
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(win.maximized).toBe(false);
    expect(win.width).toBe(400);
    expect(win.height).toBe(300);
    expect(win.element.style.left).toBe('40px');
    expect(win.element.style.top).toBe('40px');
  });

  it('ignores double-click on window controls', () => {
    const id = wm.openWindow({ appId: 'dummy', x: 40, y: 40, width: 400, height: 300 });
    const win = (wm as any).windows.get(id) as {
      maximized: boolean;
      width: number;
      element: HTMLElement;
    };
    const closeBtn = win.element.querySelector('.wm-window-close') as HTMLElement;

    closeBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(win.maximized).toBe(false);
    expect(win.width).toBe(400);
  });

  it('does not allow resize or drag while maximized', () => {
    const id = wm.openWindow({ appId: 'dummy', x: 40, y: 40, width: 400, height: 300 });
    const win = (wm as any).windows.get(id) as {
      maximized: boolean;
      width: number;
      height: number;
      element: HTMLElement;
    };
    const bar = win.element.querySelector('.wm-window-bar') as HTMLElement;
    const resize = win.element.querySelector('.wm-resize-handle') as HTMLElement;

    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(win.maximized).toBe(true);
    const maximizedWidth = win.width;
    const maximizedHeight = win.height;

    // Drag on the title bar should be ignored while maximized.
    const pointerDown = new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    });
    bar.dispatchEvent(pointerDown);
    expect(win.width).toBe(maximizedWidth);
    expect(win.height).toBe(maximizedHeight);

    // Resize should also be ignored while maximized.
    resize.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(win.width).toBe(maximizedWidth);
    expect(win.height).toBe(maximizedHeight);
  });
});
