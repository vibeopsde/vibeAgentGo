// ============================================================
// vibeAgentGo — Theme Manager (system + manual, persisted in localStorage)
// ============================================================

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'vibeAgentGo-theme';
const DOC_ATTR = 'data-theme';

export function getTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored as ThemeMode;
  }
  return 'system';
}

export function setTheme(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}

export function isDarkPreferred(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: ThemeMode): void {
  const effective = mode === 'system' ? (isDarkPreferred() ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute(DOC_ATTR, effective);
  updateThemeColor(effective);
}

export function toggleTheme(): ThemeMode {
  const current = getTheme();
  const next: ThemeMode = current === 'system'
    ? (isDarkPreferred() ? 'light' : 'dark')
    : current === 'dark'
      ? 'light'
      : 'dark';
  setTheme(next);
  return next;
}

export function initTheme(): ThemeMode {
  const mode = getTheme();
  applyTheme(mode);
  // Listen to system changes only when mode is 'system'
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  if (media.addEventListener) {
    media.addEventListener('change', listener);
  } else if ((media as any).addListener) {
    (media as any).addListener(listener);
  }
  return mode;
}

function updateThemeColor(theme: 'light' | 'dark'): void {
  // Keep in sync with CSS variables for header/background
  const color = theme === 'light' ? '#ffffff' : '#0d1117';
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}
