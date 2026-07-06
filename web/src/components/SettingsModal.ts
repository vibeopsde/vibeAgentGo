// ============================================================
// vibeAgentGo — SettingsModal (client-side, localStorage config)
// ============================================================

import { loadConfig, saveConfig } from '../core/memory.js';
import { findPresetByUrlAndModel, PROVIDER_PRESETS } from '../core/presets.js';
import { getTheme, setTheme, type ThemeMode } from '../core/theme.js';
import { escapeHtml } from '../utils/escape.js';
import { VERSION } from '../version.js';
import { t, setLanguage, getAvailableLanguages } from '../i18n/index.js';
import { renderLLMConfigSection } from './SettingsLLMSection.js';
import { renderSearchConfigSection } from './SettingsSearchSection.js';
import { renderBackupSection } from './SettingsBackupSection.js';
import { renderDangerZoneSection } from './SettingsDangerZoneSection.js';

function renderAppearanceSection(modal: HTMLElement, config: { language: 'de' | 'en'; theme: ThemeMode }): {
  language: 'de' | 'en';
  theme: ThemeMode;
} {
  const languageOptions = getAvailableLanguages()
    .map(
      (l) =>
        `<option value="${escapeHtml(l.value)}" ${config.language === l.value ? 'selected' : ''}>${escapeHtml(l.label)}</option>`
    )
    .join('');

  modal.insertAdjacentHTML('beforeend', `
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
      return (modal.querySelector('#cfg-language') as HTMLSelectElement).value as 'de' | 'en';
    },
    get theme() {
      return (modal.querySelector('#cfg-theme') as HTMLSelectElement).value as ThemeMode;
    },
  };
}

export class SettingsModal {
  element: HTMLElement;
  private overlay: HTMLElement;
  private modal: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.style.display = 'contents';

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    this.modal = document.createElement('div');
    this.modal.className = 'modal';

    this.overlay.appendChild(this.modal);
    this.element.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  open() {
    this.renderForm();
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }

  private renderForm() {
    const config = loadConfig();
    const theme = getTheme();
    const initialPreset = findPresetByUrlAndModel(config.baseUrl, config.model) ?? PROVIDER_PRESETS[0];

    this.modal.innerHTML = `
      <h2>⚙️ ${t('settings.title')}</h2>
      <div class="config-hint">
        <p><strong>Provider:</strong> ${t('settings.providerInfo')}</p>
      </div>
    `;

    const appearance = renderAppearanceSection(this.modal, { language: config.language, theme });
    const llm = renderLLMConfigSection(this.modal, config, initialPreset);
    renderBackupSection(this.modal, {
      onMessage: (message, kind) => this.showBackupMessage(message, kind),
      onReload: () => window.location.reload(),
    });
    const search = renderSearchConfigSection(this.modal, config);
    renderDangerZoneSection(this.modal, () => window.location.reload());

    this.modal.insertAdjacentHTML('beforeend', `
      <div class="form-actions">
        <button id="cfg-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
        <button id="cfg-save" class="btn btn-primary">${t('common.save')}</button>
      </div>
    `);

    this.modal.querySelector('#cfg-cancel')!.addEventListener('click', () => this.close());
    this.modal.querySelector('#cfg-save')!.addEventListener('click', () => {
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
      this.close();
      window.location.reload();
    });
  }

  private showBackupMessage(message: string, kind: 'success' | 'error') {
    let resultEl = this.modal.querySelector('#cfg-backup-result') as HTMLElement | null;
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.id = 'cfg-backup-result';
      this.modal.insertBefore(resultEl, this.modal.querySelector('#cfg-reset')?.parentElement || null);
    }
    resultEl.textContent = message;
    resultEl.className = `test-result test-${kind}`;
  }
}
