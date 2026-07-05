// ============================================================
// vibeAgentGo — SettingsModal (client-side, localStorage config)
// ============================================================

import { loadConfig, saveConfig, hasApiKey, resetLocalData } from '../core/memory.js';
import { testConnection } from '../core/llm_client.js';
import { getTheme, setTheme, type ThemeMode } from '../core/theme.js';
import { escapeHtml } from '../utils/escape.js';
import { t, setLanguage, getAvailableLanguages } from '../i18n/index.js';

const PRESETS = {
  'openai': {
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
  },
  'openrouter': {
    model: '',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'ollama': {
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434/v1',
  },
};

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
    const initialPreset = this.findPreset(config.baseUrl, config.model);
    const languageOptions = getAvailableLanguages()
      .map(l => `<option value="${l.value}" ${config.language === l.value ? 'selected' : ''}>${escapeHtml(l.label)}</option>`)
      .join('');

    this.modal.innerHTML = `
      <h2>⚙️ ${t('settings.title')}</h2>
      <div class="form-group">
        <label for="cfg-language">${t('settings.language')}</label>
        <select id="cfg-language">${languageOptions}</select>
      </div>
      <div class="form-group">
        <label for="cfg-theme">${t('header.theme')}</label>
        <select id="cfg-theme">
          <option value="system" ${theme === 'system' ? 'selected' : ''}>System</option>
          <option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option>
        </select>
      </div>
      <div class="form-group">
        <label for="cfg-provider">${t('settings.provider')}</label>
        <select id="cfg-provider">
          <option value="custom" ${!initialPreset ? 'selected' : ''}>${t('settings.custom')}</option>
          <option value="openai" ${initialPreset === 'openai' ? 'selected' : ''}>${t('settings.openai')}</option>
          <option value="openrouter" ${initialPreset === 'openrouter' ? 'selected' : ''}>${t('settings.openrouter')}</option>
          <option value="ollama" ${initialPreset === 'ollama' ? 'selected' : ''}>${t('settings.ollama')}</option>
        </select>
        <p class="field-hint">${t('settings.providerHint')}</p>
      </div>
      <div class="form-group">
        <label for="cfg-model">${t('settings.model')}</label>
        <input id="cfg-model" type="text" value="${escapeHtml(config.model)}" placeholder="gpt-4o-mini" />
      </div>
      <div class="form-group">
        <label for="cfg-baseurl">${t('settings.baseUrl')}</label>
        <input id="cfg-baseurl" type="text" value="${escapeHtml(config.baseUrl)}" placeholder="https://api.openai.com/v1" />
      </div>
      <div class="form-group">
        <label for="cfg-apikey">${t('settings.apiKey')} ${config.apiKey ? '✓' : ''}</label>
        <input id="cfg-apikey" type="password" value="${escapeHtml(config.apiKey)}" placeholder="sk-..." />
      </div>
      <div class="form-group">
        <label for="cfg-maxturns">${t('settings.maxTurns')}</label>
        <input id="cfg-maxturns" type="number" value="${config.maxTurns}" min="1" max="100" />
      </div>
      <h3>🔍 ${t('settings.search')}</h3>
      <div class="form-group">
        <label for="cfg-search-provider">${t('settings.provider')}</label>
        <select id="cfg-search-provider">
          <option value="none" ${config.searchProvider === 'none' ? 'selected' : ''}>${t('settings.searchNone')}</option>
          <option value="tavily" ${config.searchProvider === 'tavily' ? 'selected' : ''}>${t('settings.searchTavily')}</option>
        </select>
      </div>
      <div class="form-group">
        <label for="cfg-search-apikey">${t('settings.searchApiKey')} ${config.searchApiKey ? '✓' : ''}</label>
        <input id="cfg-search-apikey" type="password" value="${escapeHtml(config.searchApiKey)}" placeholder="tvly-..." />
        <p class="field-hint">Tavily: <a href="https://app.tavily.com/" target="_blank" rel="noopener">app.tavily.com</a></p>
      </div>
      <div class="form-actions">
        <button id="cfg-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
        <button id="cfg-test" class="btn btn-secondary">${t('settings.testConnection')}</button>
        <button id="cfg-save" class="btn btn-primary">${t('common.save')}</button>
      </div>
      <div id="cfg-test-result" class="test-result"></div>
      <div class="form-actions">
        <button id="cfg-reset" class="btn btn-danger">${t('settings.resetData')}</button>
      </div>
      <div id="cfg-reset-confirm" class="reset-confirm" style="display:none;">
        <p><strong>⚠️ ${t('common.error')}:</strong> ${t('settings.resetConfirm')}</p>
        <div class="form-actions">
          <button id="cfg-reset-cancel" class="btn btn-secondary">${t('settings.resetCancel')}</button>
          <button id="cfg-reset-confirm-btn" class="btn btn-danger">${t('settings.resetConfirmBtn')}</button>
        </div>
      </div>
      <div class="config-hint">
        <p><strong>Provider:</strong> ${t('settings.providerInfo')}</p>
        <p><strong>${t('settings.examples')}</strong></p>
        <ul>
          <li>${t('settings.openai')} <code>${t('settings.openaiUrl')}</code></li>
          <li>${t('settings.openrouter')} <code>${t('settings.openrouterUrl')}</code></li>
          <li>${t('settings.ollama')} <code>${t('settings.ollamaUrl')}</code></li>
        </ul>
      </div>
    `;

    this.modal.querySelector('#cfg-cancel')!.addEventListener('click', () => this.close());
    this.modal.querySelector('#cfg-save')!.addEventListener('click', () => this.save());
    this.modal.querySelector('#cfg-test')!.addEventListener('click', () => this.testConnection());

    const providerSelect = this.modal.querySelector('#cfg-provider') as HTMLSelectElement;
    const modelInput = this.modal.querySelector('#cfg-model') as HTMLInputElement;
    const baseUrlInput = this.modal.querySelector('#cfg-baseurl') as HTMLInputElement;

    providerSelect.addEventListener('change', () => {
      const preset = PRESETS[providerSelect.value as keyof typeof PRESETS];
      if (preset) {
        modelInput.value = preset.model;
        baseUrlInput.value = preset.baseUrl;
      }
    });

    const resetBtn = this.modal.querySelector('#cfg-reset') as HTMLButtonElement;
    const resetConfirm = this.modal.querySelector('#cfg-reset-confirm') as HTMLElement;
    const resetCancel = this.modal.querySelector('#cfg-reset-cancel') as HTMLButtonElement;
    const resetConfirmBtn = this.modal.querySelector('#cfg-reset-confirm-btn') as HTMLButtonElement;

    resetBtn.addEventListener('click', () => {
      resetConfirm.style.display = 'block';
      resetBtn.style.display = 'none';
    });

    resetCancel.addEventListener('click', () => {
      resetConfirm.style.display = 'none';
      resetBtn.style.display = 'block';
    });

    resetConfirmBtn.addEventListener('click', () => {
      resetLocalData();
      this.close();
      window.location.reload();
    });
  }

  private findPreset(baseUrl: string, model: string): string | null {
    for (const [key, preset] of Object.entries(PRESETS)) {
      if (preset.baseUrl !== baseUrl) continue;
      if (preset.model === '') {
        // Generic endpoint: accept any model that matches the base URL
        return key;
      }
      if (preset.model === model) return key;
    }
    return null;
  }

  private testConnection() {
    const baseUrl = (this.modal.querySelector('#cfg-baseurl') as HTMLInputElement).value.trim();
    const apiKey = (this.modal.querySelector('#cfg-apikey') as HTMLInputElement).value.trim();
    const resultEl = this.modal.querySelector('#cfg-test-result') as HTMLElement;

    resultEl.textContent = t('common.loading');
    resultEl.className = 'test-result test-pending';

    testConnection({ baseUrl, apiKey }).then(res => {
      if (res.ok) {
        const list = res.models.length ? `\n${res.models.slice(0, 10).join('\n')}` : t('onboarding.modelList');
        resultEl.textContent = `✅ ${t('settings.connectionSuccess')}. ${res.models.length} ${t('onboarding.modelList')}.\n${list}`;
        resultEl.className = 'test-result test-success';
      } else {
        resultEl.textContent = `❌ ${t('settings.connectionError')}: ${res.error}`;
        resultEl.className = 'test-result test-error';
      }
    });
  }

  private save() {
    const model = (this.modal.querySelector('#cfg-model') as HTMLInputElement).value;
    const baseUrl = (this.modal.querySelector('#cfg-baseurl') as HTMLInputElement).value;
    const apiKey = (this.modal.querySelector('#cfg-apikey') as HTMLInputElement).value;
    const maxTurns = parseInt((this.modal.querySelector('#cfg-maxturns') as HTMLInputElement).value);
    const language = (this.modal.querySelector('#cfg-language') as HTMLSelectElement).value as 'de' | 'en';
    const searchProvider = (this.modal.querySelector('#cfg-search-provider') as HTMLSelectElement).value as 'none' | 'tavily';
    const searchApiKey = (this.modal.querySelector('#cfg-search-apikey') as HTMLInputElement).value;
    const theme = (this.modal.querySelector('#cfg-theme') as HTMLSelectElement).value as ThemeMode;

    setLanguage(language);
    setTheme(theme);
    saveConfig({ model, baseUrl, apiKey, maxTurns, language, searchProvider, searchApiKey });
    this.close();
  }
}
