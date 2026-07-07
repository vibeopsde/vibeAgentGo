// ============================================================
// vibeAgentGo — Onboarding Wizard (4 steps: welcome+language, description, LLM config, search config)
// Reuses shared settings section components.
// ============================================================

import { saveConfig, loadConfig, completeOnboarding } from '../core/memory.js';
import { BackupManager } from '../core/backup.js';
import { VERSION } from '../version.js';
import { t, setLanguage, type Language } from '../i18n/index.js';
import { PROVIDER_PRESETS, findPresetByUrlAndModel } from '../core/presets.js';
import { renderLLMConfigSection, readLLMConfigFrom } from './SettingsLLMSection.js';
import { renderSearchConfigSection, readSearchConfigFrom } from './SettingsSearchSection.js';

export interface OnboardingCompleteCallback {
  (): void;
}

export class OnboardingWizard {
  element: HTMLElement;
  onComplete: OnboardingCompleteCallback | null = null;
  private step: 1 | 2 | 3 | 4 = 1;
  private config = loadConfig();
  private llmResult: ReturnType<typeof renderLLMConfigSection> | null = null;

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
    const selectedPreset = findPresetByUrlAndModel(this.config.baseUrl, this.config.model) ?? PROVIDER_PRESETS[0];

    const card = document.createElement('div');
    card.className = 'onboarding-card';
    card.innerHTML = `
      ${this.stepIndicator(3)}
      <h1>${t('onboarding.llmTitle')}</h1>
      <p class="onboarding-subtitle">${t('onboarding.llmHint')}</p>
    `;
    this.element.appendChild(card);

    this.llmResult = renderLLMConfigSection(card, this.config, selectedPreset);

    const actions = document.createElement('div');
    actions.className = 'onboarding-actions onboarding-actions-split';
    actions.innerHTML = `
      <button id="ob-back" class="btn btn-secondary">${t('onboarding.back')}</button>
      <button id="ob-next" class="btn btn-primary" disabled>${t('onboarding.next')}</button>
    `;
    card.appendChild(actions);

    // Enable Next only when a model is actually selected
    const nextBtn = this.element.querySelector('#ob-next') as HTMLButtonElement;
    const modelSelect = card.querySelector('#cfg-model') as HTMLSelectElement;
    const modelManual = card.querySelector('#cfg-model-manual') as HTMLInputElement;

    const updateNextButton = () => {
      if (modelManual.style.display === 'block') {
        nextBtn.disabled = !modelManual.value.trim();
      } else {
        nextBtn.disabled = !modelSelect.value.trim();
      }
    };

    // If a saved model was pre-filled, enable Next immediately
    updateNextButton();

    modelSelect.addEventListener('change', updateNextButton);
    modelManual.addEventListener('input', updateNextButton);

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 2;
      this.render();
    });

    nextBtn.addEventListener('click', () => this.saveLLM());
  }

  private saveLLM() {
    const cfg = readLLMConfigFrom(this.element) ?? this.llmResult;
    if (!cfg) return;

    const { baseUrl, model, apiKey, maxTurns } = cfg;
    if (!baseUrl || !model) {
      alert(t('error.noModel') + ' / ' + t('error.noBaseUrl'));
      return;
    }

    this.config = saveConfig({ ...this.config, baseUrl, model, apiKey, maxTurns });
    this.step = 4;
    this.render();
  }

  private renderSearchConfig() {
    const card = document.createElement('div');
    card.className = 'onboarding-card';
    card.innerHTML = `
      ${this.stepIndicator(4)}
      <h1>${t('settings.search')}</h1>
      <p class="onboarding-subtitle">${t('onboarding.searchHint')}</p>
    `;
    this.element.appendChild(card);

    renderSearchConfigSection(card, this.config);

    const actions = document.createElement('div');
    actions.className = 'onboarding-actions onboarding-actions-split';
    actions.innerHTML = `
      <button id="ob-back" class="btn btn-secondary">${t('onboarding.back')}</button>
      <button id="ob-complete" class="btn btn-primary">${t('onboarding.finish')}</button>
    `;
    card.appendChild(actions);

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 3;
      this.render();
    });

    this.element.querySelector('#ob-complete')!.addEventListener('click', () => this.complete());
  }

  private complete() {
    const search = readSearchConfigFrom(this.element);
    if (!search) return;
    const { searchProvider, searchApiKey } = search;

    if (searchProvider === 'tavily' && !searchApiKey) {
      alert(t('error.noApiKey'));
      return;
    }

    saveConfig({ ...this.config, searchProvider, searchApiKey });
    completeOnboarding();
    if (this.onComplete) this.onComplete();
  }
}
