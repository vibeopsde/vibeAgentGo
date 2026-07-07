// ============================================================
// vibeAgentGo — SettingsApp (formerly SettingsModal)
// Now a first-class app inside the window manager.
// ============================================================

import { loadConfig, saveConfig, type ClientConfig } from '../core/memory.js';
import { findPresetByUrlAndModel, PROVIDER_PRESETS } from '../core/presets.js';
import { getTheme, setTheme, type ThemeMode } from '../core/theme.js';
import { escapeHtml } from '../utils/escape.js';
import { VERSION } from '../version.js';
import { t, setLanguage, getAvailableLanguages } from '../i18n/index.js';
import { renderLLMConfigSection } from '../components/SettingsLLMSection.js';
import { renderSearchConfigSection } from '../components/SettingsSearchSection.js';
import { renderBackupSection } from '../components/SettingsBackupSection.js';
import { renderDangerZoneSection } from '../components/SettingsDangerZoneSection.js';
import type { App } from '../types/index.js';

function renderAppearanceSection(container: HTMLElement, config: { language: 'de' | 'en'; theme: ThemeMode }): {
  language: 'de' | 'en';
  theme: ThemeMode;
} {
  const languageOptions = getAvailableLanguages()
    .map(
      (l) =>
        `<option value="${escapeHtml(l.value)}" ${config.language === l.value ? 'selected' : ''}>${escapeHtml(l.label)}</option>`
    )
    .join('');

  container.insertAdjacentHTML('beforeend', `
    <div class="form-group">
      <label for="cfg-language">${t('settings.language')}</label>
      <select id="cfg-language">${languageOptions}</select>
    </div>
    <div class="form-group">
      <label for="cfg-theme">${t('header.theme')}</label>
      <select id="cfg-theme">
        <option value="system" ${config.theme === 'system' ? 'selected' : ''}>System</option>
        <option value="light" ${config.theme === 'light' ? 'selected' : ''}>Light</option>
        <option value="dark" ${config.theme === 'dark' ? 'selected' : ''}>Dark</option>
      </select>
    </div>
  `);

  return {
    get language() {
      return (container.querySelector('#cfg-language') as HTMLSelectElement).value as 'de' | 'en';
    },
    get theme() {
      return (container.querySelector('#cfg-theme') as HTMLSelectElement).value as ThemeMode;
    },
  };
}

export class SettingsApp implements App {
  id = 'settings';
  title = t('settings.title');
  icon = '⚙️';
  element: HTMLElement;
  private container: HTMLElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'settings-app';
  }

  private emitReload() {
    this.element.dispatchEvent(new CustomEvent('settings:reload', { bubbles: true }));
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.innerHTML = '';
    this.renderForm(container);
  }

  private renderForm(container: HTMLElement) {
    const config = loadConfig();
    const theme = getTheme();
    const initialPreset = findPresetByUrlAndModel(config.baseUrl, config.model) ?? PROVIDER_PRESETS[0];

    container.innerHTML = `
      <h2>⚙️ ${t('settings.title')}</h2>
      <div class="config-hint">
        <p><strong>Provider:</strong> ${t('settings.providerInfo')}</p>
      </div>
    `;

    const appearance = renderAppearanceSection(container, { language: config.language, theme });
    const llm = renderLLMConfigSection(container, config, initialPreset);
    renderBackupSection(container, {
      onMessage: (message, kind) => this.showBackupMessage(container, message, kind),
      onReload: () => this.emitReload(),
    });
    const search = renderSearchConfigSection(container, config);
    renderDangerZoneSection(container, () => this.emitReload());

    container.insertAdjacentHTML('beforeend', `
      <div class="form-actions">
        <button id="cfg-save" class="btn btn-primary">${t('common.save')}</button>
      </div>
    `);

    container.querySelector('#cfg-save')!.addEventListener('click', () => {
      setLanguage(appearance.language);
      setTheme(appearance.theme);
      saveConfig({
        baseUrl: llm.baseUrl,
        model: llm.model,
        apiKey: llm.apiKey,
        maxTurns: llm.maxTurns,
        language: appearance.language,
        searchProvider: search.searchProvider,
        searchApiKey: search.searchApiKey,
      });
      this.emitReload();
    });
  }

  private showBackupMessage(container: HTMLElement, message: string, kind: 'success' | 'error') {
    let resultEl = container.querySelector('#cfg-backup-result') as HTMLElement | null;
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.id = 'cfg-backup-result';
      container.insertBefore(resultEl, container.querySelector('#cfg-reset')?.parentElement || null);
    }
    resultEl.textContent = message;
    resultEl.className = `test-result test-${kind}`;
  }
}
