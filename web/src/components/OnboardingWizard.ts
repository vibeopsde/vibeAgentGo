// ============================================================
// vibeAgentGo — Onboarding Wizard (4 steps: welcome+language, description, LLM config, search config)
// ============================================================

import { saveConfig, loadConfig, completeOnboarding } from '../core/memory.js';
import { testConnection } from '../core/llm_client.js';
import { BackupManager } from '../core/backup.js';
import { VERSION } from '../version.js';
import { escapeHtml } from '../utils/escape.js';
import { t, setLanguage, type Language } from '../i18n/index.js';
import { PROVIDER_PRESETS, findPresetByUrlAndModel, findPresetByKey, type ProviderPreset } from '../core/presets.js';

export interface OnboardingCompleteCallback {
  (): void;
}

export class OnboardingWizard {
  element: HTMLElement;
  onComplete: OnboardingCompleteCallback | null = null;
  private step: 1 | 2 | 3 | 4 = 1;
  private config = loadConfig();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'onboarding-wizard';
    setLanguage(this.config.language);
    this.render();
  }

  private render() {
    this.element.innerHTML = '';
    if (this.step === 1) this.renderWelcomeLanguage();
    else if (this.step === 2) this.renderDescription();
    else if (this.step === 3) this.renderLLMConfig();
    else this.renderSearchConfig();
  }

  private stepIndicator(active: number) {
    return `
      <div class="onboarding-steps">
        ${[1, 2, 3, 4].map((n) => `<span class="step ${n === active ? 'active' : ''}">${n}</span>`).join('')}
      </div>
    `;
  }

  private renderWelcomeLanguage() {
    this.element.innerHTML = `
      <div class="onboarding-card">
        <img class="onboarding-logo onboarding-logo-xl" src="./logo-192.png" alt="vibeAgentGo" width="120" height="120" />
        <h1 class="onboarding-greeting">Willkommen · Welcome</h1>
        <p class="onboarding-version">vibeAgentGo ${VERSION}</p>

        <div class="language-flag-row">
          <button id="lang-de" class="lang-flag-btn" data-lang="de">
            <span class="lang-flag-emoji">🇩🇪</span>
            <span class="lang-flag-label">Deutsch</span>
          </button>
          <button id="lang-en" class="lang-flag-btn" data-lang="en">
            <span class="lang-flag-emoji">🇬🇧</span>
            <span class="lang-flag-label">English</span>
          </button>
        </div>

        <div class="onboarding-actions">
          <button id="onboarding-next" class="btn btn-primary btn-large" disabled>${t('onboarding.next')}</button>
        </div>
      </div>
    `;

    const nextBtn = this.element.querySelector('#onboarding-next') as HTMLButtonElement;

    const selectLang = (lang: Language) => {
      this.config = saveConfig({ ...this.config, language: lang });
      setLanguage(lang);
      // mark active
      this.element.querySelectorAll('.lang-flag-btn').forEach((b) =>
        b.classList.toggle('lang-flag-active', (b as HTMLElement).dataset.lang === lang)
      );
      nextBtn.disabled = false;
    };

    this.element.querySelectorAll('.lang-flag-btn').forEach((btn) =>
      btn.addEventListener('click', (e) => selectLang((e.currentTarget as HTMLElement).dataset.lang as Language))
    );

    nextBtn.addEventListener('click', () => {
      this.step = 2;
      this.render();
    });
  }

  private renderDescription() {
    this.element.innerHTML = `
      <div class="onboarding-card">
        ${this.stepIndicator(2)}
        <h1>${t('onboarding.welcome')}</h1>
        <p class="onboarding-subtitle">${t('onboarding.subtitle')}</p>

        <div class="onboarding-info">
          <div class="info-item">
            <span class="info-icon">🔒</span>
            <div>
              <strong>${t('onboarding.dataSovereigntyTitle')}</strong>
              <p>${t('onboarding.dataSovereigntyText')}</p>
            </div>
          </div>
          <div class="info-item">
            <span class="info-icon">🛠️</span>
            <div>
              <strong>${t('onboarding.toolsTitle')}</strong>
              <p>${t('onboarding.toolsText')}</p>
            </div>
          </div>
          <div class="info-item">
            <span class="info-icon">🌐</span>
            <div>
              <strong>${t('onboarding.openaiTitle')}</strong>
              <p>${t('onboarding.openaiText')}</p>
            </div>
          </div>
        </div>

        <div class="onboarding-actions onboarding-actions-split">
          <button id="ob-back" class="btn btn-secondary">${t('onboarding.back')}</button>
          <button id="onboarding-next" class="btn btn-primary">${t('onboarding.next')}</button>
        </div>
        <button id="onboarding-restore" class="onboarding-restore-link">${t('onboarding.restore')}</button>
        <input id="onboarding-restore-file" type="file" accept=".zip" style="display:none;" />
        <div id="onboarding-restore-result" class="test-result" style="margin-top:12px;"></div>
      </div>
    `;

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 1;
      this.render();
    });

    this.element.querySelector('#onboarding-next')!.addEventListener('click', () => {
      this.step = 3;
      this.render();
    });

    const restoreBtn = this.element.querySelector('#onboarding-restore') as HTMLButtonElement;
    const restoreFile = this.element.querySelector('#onboarding-restore-file') as HTMLInputElement;
    restoreBtn?.addEventListener('click', () => restoreFile?.click());
    restoreFile?.addEventListener('change', (e) => this.restoreBackup(e));
  }

  private async restoreBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const resultEl = this.element.querySelector('#onboarding-restore-result') as HTMLElement;
    resultEl.textContent = t('common.loading');
    resultEl.className = 'test-result test-pending';

    const manager = new BackupManager(VERSION);
    try {
      await manager.importZip(file);
      resultEl.textContent = `✅ ${t('settings.importSuccess')}`;
      resultEl.className = 'test-result test-success';
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      resultEl.textContent = `❌ ${t('settings.importError')}: ${(err as Error).message}`;
      resultEl.className = 'test-result test-error';
    }
  }

  private renderLLMConfig() {
    const currentPreset = findPresetByUrlAndModel(this.config.baseUrl, this.config.model);
    // Default to first preset if no match
    const selectedPreset = currentPreset ?? PROVIDER_PRESETS[0];

    this.element.innerHTML = `
      <div class="onboarding-card">
        ${this.stepIndicator(3)}
        <h1>${t('onboarding.llmTitle')}</h1>
        <p class="onboarding-subtitle">${t('onboarding.llmHint')}</p>

        <div class="form-group">
          <label for="ob-preset">${t('settings.provider')}</label>
          <select id="ob-preset">
            ${PROVIDER_PRESETS.map((p) => `<option value="${escapeHtml(p.key)}" ${selectedPreset.key === p.key ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" id="ob-apikey-group">
          <label for="ob-apikey">${t('settings.apiKey')}</label>
          <input id="ob-apikey" type="password" value="${escapeHtml(this.config.apiKey)}" placeholder="sk-..." />
          <p class="field-hint" id="ob-apikey-hint">${t('onboarding.apiKeyHint')}</p>
        </div>

        <div class="form-group">
          <button id="ob-verify" class="btn btn-secondary">${t('onboarding.testConnection')}</button>
        </div>

        <div class="form-group">
          <label for="ob-model">${t('settings.model')}</label>
          <select id="ob-model" disabled>
            <option value="">${t('onboarding.verifyFirst')}</option>
          </select>
          <input id="ob-model-manual" type="text" style="display:none; margin-top:8px;" placeholder="model-id" />
        </div>

        <div class="form-group">
          <label for="ob-maxturns">${t('settings.maxTurns')}</label>
          <input id="ob-maxturns" type="number" value="${this.config.maxTurns}" min="1" max="100" />
        </div>

        <div id="ob-test-result" class="test-result"></div>

        <div class="onboarding-actions onboarding-actions-split">
          <button id="ob-back" class="btn btn-secondary">${t('onboarding.back')}</button>
          <button id="ob-next" class="btn btn-primary" disabled>${t('onboarding.next')}</button>
        </div>
      </div>
    `;

    const presetSelect = this.element.querySelector('#ob-preset') as HTMLSelectElement;
    const apiKeyInput = this.element.querySelector('#ob-apikey') as HTMLInputElement;
    const apiKeyGroup = this.element.querySelector('#ob-apikey-group') as HTMLElement;
    const apiKeyHint = this.element.querySelector('#ob-apikey-hint') as HTMLElement;
    const verifyBtn = this.element.querySelector('#ob-verify') as HTMLButtonElement;
    const modelSelect = this.element.querySelector('#ob-model') as HTMLSelectElement;
    const modelManual = this.element.querySelector('#ob-model-manual') as HTMLInputElement;
    const nextBtn = this.element.querySelector('#ob-next') as HTMLButtonElement;
    const resultEl = this.element.querySelector('#ob-test-result') as HTMLElement;

    // Hidden field to track current baseUrl from preset selection
    let currentBaseUrl = selectedPreset.baseUrl;

    const updateVerifyButton = () => {
      const preset = findPresetByKey(presetSelect.value);
      if (preset && !preset.apiKeyRequired) {
        verifyBtn.disabled = false;
      } else {
        verifyBtn.disabled = apiKeyInput.value.trim().length === 0;
      }
    };
    apiKeyInput.addEventListener('input', updateVerifyButton);

    const applyPreset = (preset: ProviderPreset) => {
      currentBaseUrl = preset.baseUrl;
      apiKeyInput.placeholder = preset.apiKeyPlaceholder;
      // Show/hide API key field based on whether it's required
      apiKeyGroup.style.display = preset.apiKeyRequired ? 'block' : 'none';
      apiKeyHint.textContent = preset.apiKeyRequired
        ? t('onboarding.apiKeyRequired')
        : t('onboarding.apiKeyHint');
      // Pre-fill model from preset
      modelManual.style.display = 'block';
      modelManual.value = preset.model;
      modelSelect.style.display = 'none';
      modelSelect.disabled = true;
      nextBtn.disabled = true;
      updateVerifyButton();
    };

    // Apply initial preset
    applyPreset(selectedPreset);

    presetSelect.addEventListener('change', () => {
      const preset = findPresetByKey(presetSelect.value);
      if (preset) applyPreset(preset);
    });

    modelSelect.addEventListener('change', () => {
      nextBtn.disabled = !modelSelect.value;
    });

    modelManual.addEventListener('input', () => {
      nextBtn.disabled = !modelManual.value.trim();
    });

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 2;
      this.render();
    });

    verifyBtn.addEventListener('click', () =>
      this.verifyLLM(currentBaseUrl, apiKeyInput, modelSelect, modelManual, verifyBtn, nextBtn, resultEl)
    );
    this.element.querySelector('#ob-next')!.addEventListener('click', () => this.saveLLM(currentBaseUrl));
  }

  private renderSearchConfig() {
    this.element.innerHTML = `
      <div class="onboarding-card">
        ${this.stepIndicator(4)}
        <h1>${t('settings.search')}</h1>
        <p class="onboarding-subtitle">${t('onboarding.searchHint')}</p>

        <div class="form-group">
          <label for="ob-search-provider">${t('settings.provider')}</label>
          <select id="ob-search-provider">
            <option value="none" ${this.config.searchProvider === 'none' ? 'selected' : ''}>${t('settings.searchNone')}</option>
            <option value="tavily" ${this.config.searchProvider === 'tavily' ? 'selected' : ''}>${t('settings.searchTavily')}</option>
          </select>
        </div>

        <div class="form-group" id="ob-search-key-group">
          <label for="ob-search-apikey">${t('settings.searchApiKey')}</label>
          <input id="ob-search-apikey" type="password" value="${escapeHtml(this.config.searchApiKey)}" placeholder="tvly-..." />
          <p class="field-hint">Tavily: <a href="https://app.tavily.com/" target="_blank" rel="noopener">app.tavily.com</a></p>
        </div>

        <div class="onboarding-actions onboarding-actions-split">
          <button id="ob-back" class="btn btn-secondary">${t('onboarding.back')}</button>
          <button id="ob-complete" class="btn btn-primary">${t('onboarding.finish')}</button>
        </div>
      </div>
    `;

    const providerSelect = this.element.querySelector('#ob-search-provider') as HTMLSelectElement;
    const keyGroup = this.element.querySelector('#ob-search-key-group') as HTMLElement;

    const updateKeyVisibility = () => {
      keyGroup.style.display = providerSelect.value === 'tavily' ? 'block' : 'none';
    };
    providerSelect.addEventListener('change', updateKeyVisibility);
    updateKeyVisibility();

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 3;
      this.render();
    });

    this.element.querySelector('#ob-complete')!.addEventListener('click', () => this.complete());
  }

  private async verifyLLM(
    baseUrl: string,
    apiKeyInput: HTMLInputElement,
    modelSelect: HTMLSelectElement,
    modelManual: HTMLInputElement,
    verifyBtn: HTMLButtonElement,
    nextBtn: HTMLButtonElement,
    resultEl: HTMLElement
  ) {
    const apiKey = apiKeyInput.value.trim();

    resultEl.textContent = t('common.loading');
    resultEl.className = 'test-result test-pending';
    verifyBtn.disabled = true;

    const res = await testConnection({ baseUrl, apiKey });
    verifyBtn.disabled = false;

    if (!res.ok) {
      resultEl.textContent = `❌ ${t('onboarding.connectionError')}: ${res.error}`;
      resultEl.className = 'test-result test-error';
      modelSelect.disabled = true;
      modelSelect.innerHTML = `<option value="">${t('onboarding.verifyFailed')}</option>`;
      modelManual.style.display = 'none';
      nextBtn.disabled = true;
      return;
    }

    const models = res.models.length ? res.models : [];
    resultEl.textContent = `✅ ${t('onboarding.connectionSuccess')} (${models.length})`;
    resultEl.className = 'test-result test-success';

    if (models.length > 0) {
      const currentModel = this.config.model;
      const options = models
        .map(
          (m) => `<option value="${escapeHtml(m)}" ${m === currentModel ? 'selected' : ''}>${escapeHtml(m)}</option>`
        )
        .join('');
      modelSelect.innerHTML = `<option value="">${t('onboarding.pickModel')}</option>${options}`;
      modelSelect.disabled = false;
      modelManual.style.display = 'none';

      if (models.includes(currentModel)) {
        modelSelect.value = currentModel;
        nextBtn.disabled = false;
      } else {
        modelSelect.value = '';
        nextBtn.disabled = true;
      }
    } else {
      modelSelect.innerHTML = `<option value="">${t('onboarding.noModelsManual')}</option>`;
      modelSelect.disabled = true;
      modelManual.style.display = 'block';
      modelManual.value = this.config.model;
      nextBtn.disabled = !modelManual.value.trim();
    }
  }

  private saveLLM(baseUrl: string) {
    const modelManual = this.element.querySelector('#ob-model-manual') as HTMLInputElement;
    const modelSelect = this.element.querySelector('#ob-model') as HTMLSelectElement;
    const model = (modelManual.style.display === 'block' ? modelManual.value.trim() : modelSelect.value.trim());
    const apiKey = (this.element.querySelector('#ob-apikey') as HTMLInputElement).value.trim();
    const maxTurns = parseInt((this.element.querySelector('#ob-maxturns') as HTMLInputElement).value) || 30;

    if (!baseUrl || !model) {
      alert(t('error.noModel') + ' / ' + t('error.noBaseUrl'));
      return;
    }

    this.config = saveConfig({ ...this.config, baseUrl, model, apiKey, maxTurns });
    this.step = 4;
    this.render();
  }

  private complete() {
    const searchProvider = (this.element.querySelector('#ob-search-provider') as HTMLSelectElement).value as
      'none' | 'tavily';
    const searchApiKey = (this.element.querySelector('#ob-search-apikey') as HTMLInputElement).value.trim();

    if (searchProvider === 'tavily' && !searchApiKey) {
      alert(t('error.noApiKey'));
      return;
    }

    saveConfig({ ...this.config, searchProvider, searchApiKey });
    completeOnboarding();
    if (this.onComplete) this.onComplete();
  }
}
