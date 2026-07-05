// ============================================================
// vibeAgentGo — Onboarding Wizard (3 steps: welcome, LLM config, search config)
// ============================================================

import { saveConfig, loadConfig, completeOnboarding } from '../core/memory.js';
import { testConnection } from '../core/llm_client.js';
import { escapeHtml } from '../utils/escape.js';

export interface OnboardingCompleteCallback {
  (): void;
}

interface Preset {
  name: string;
  baseUrl: string;
  model: string;
  apiKeyPlaceholder: string;
}

const PRESETS: Preset[] = [
  {
    name: 'OpenAI-kompatibel',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: 'Ollama (lokal)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKeyPlaceholder: 'ollama (optional)',
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'moonshotai/kimi-k2.7-code',
    apiKeyPlaceholder: 'sk-or-...',
  },
];

export class OnboardingWizard {
  element: HTMLElement;
  onComplete: OnboardingCompleteCallback | null = null;
  private step: 1 | 2 | 3 = 1;
  private config = loadConfig();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'onboarding-wizard';
    this.render();
  }

  private render() {
    this.element.innerHTML = '';
    if (this.step === 1) this.renderWelcome();
    else if (this.step === 2) this.renderLLMConfig();
    else this.renderSearchConfig();
  }

  private renderWelcome() {
    this.element.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-logo">vibeAgentGo</div>
        <h1>Willkommen bei vibeAgentGo</h1>
        <p class="onboarding-subtitle">Hermes Agent Go — dein KI-Agent, der komplett im Browser läuft.</p>
        
        <div class="onboarding-info">
          <div class="info-item">
            <span class="info-icon">🔒</span>
            <div>
              <strong>Datenhoheit</strong>
              <p>Alle Sessions, Dateien, Memory und Skills liegen in deinem Browser (IndexedDB). Nur LLM-Anfragen verlassen das Gerät.</p>
            </div>
          </div>
          <div class="info-item">
            <span class="info-icon">🛠️</span>
            <div>
              <strong>Tools im Browser</strong>
              <p>Dateien lesen/schreiben, Code ausführen, Websuchen, Erinnerungen speichern und interaktive HTML-Views rendern.</p>
            </div>
          </div>
          <div class="info-item">
            <span class="info-icon">🌐</span>
            <div>
              <strong>OpenAI-kompatibel</strong>
              <p>vibeAgentGo spricht mit jedem OpenAI-kompatiblen Endpunkt. OpenAI, Ollama, OpenRouter — du wählst.</p>
            </div>
          </div>
        </div>
        
        <div class="onboarding-actions">
          <button id="onboarding-next" class="btn btn-primary btn-large">Weiter zur Konfiguration</button>
        </div>
      </div>
    `;
    this.element.querySelector('#onboarding-next')!.addEventListener('click', () => {
      this.step = 2;
      this.render();
    });
  }

  private renderLLMConfig() {
    const currentPreset = this.findPreset(this.config.baseUrl, this.config.model);

    this.element.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-steps">
          <span class="step">1</span>
          <span class="step active">2</span>
          <span class="step">3</span>
        </div>
        <h1>KI-Schnittstelle</h1>
        <p class="onboarding-subtitle">Wähle einen Provider oder trage deine Endpunktdaten manuell ein.</p>

        <div class="form-group">
          <label for="ob-preset">Provider</label>
          <select id="ob-preset">
            <option value="" ${!currentPreset ? 'selected' : ''}>Manuell</option>
            ${PRESETS.map(p => `<option value="${p.name}" ${currentPreset?.name === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="ob-baseurl">Base URL</label>
          <input id="ob-baseurl" type="text" value="${escapeHtml(this.config.baseUrl)}" placeholder="https://api.example.com/v1" />
        </div>

        <div class="form-group">
          <label for="ob-apikey">API Key</label>
          <input id="ob-apikey" type="password" value="${escapeHtml(this.config.apiKey)}" placeholder="sk-..." />
        </div>

        <div class="form-group">
          <button id="ob-verify" class="btn btn-secondary" disabled>Verifizieren</button>
        </div>

        <div class="form-group">
          <label for="ob-model">Model</label>
          <select id="ob-model" disabled>
            <option value="">Bitte zuerst Verbindung verifizieren</option>
          </select>
          <input id="ob-model-manual" type="text" style="display:none; margin-top:8px;" placeholder="model-id" />
        </div>

        <div class="form-group">
          <label for="ob-maxturns">Max Turns</label>
          <input id="ob-maxturns" type="number" value="${this.config.maxTurns}" min="1" max="100" />
        </div>

        <div class="form-group">
          <label for="ob-maxtokens">Max Response Tokens</label>
          <input id="ob-maxtokens" type="number" value="${this.config.maxTokens}" min="256" max="65536" step="256" />
          <p class="field-hint">Limits how many tokens the model may generate per turn. Lower = faster, cheaper answers. 0 = unlimited.</p>
        </div>

        <div id="ob-test-result" class="test-result"></div>

        <div class="onboarding-actions">
          <button id="ob-back" class="btn btn-secondary">Zurück</button>
          <button id="ob-next" class="btn btn-primary" disabled>Weiter</button>
        </div>
      </div>
    `;

    const presetSelect = this.element.querySelector('#ob-preset') as HTMLSelectElement;
    const baseUrlInput = this.element.querySelector('#ob-baseurl') as HTMLInputElement;
    const apiKeyInput = this.element.querySelector('#ob-apikey') as HTMLInputElement;
    const verifyBtn = this.element.querySelector('#ob-verify') as HTMLButtonElement;
    const modelSelect = this.element.querySelector('#ob-model') as HTMLSelectElement;
    const modelManual = this.element.querySelector('#ob-model-manual') as HTMLInputElement;
    const nextBtn = this.element.querySelector('#ob-next') as HTMLButtonElement;
    const resultEl = this.element.querySelector('#ob-test-result') as HTMLElement;

    const updateVerifyButton = () => {
      const canVerify = baseUrlInput.value.trim().length > 0 && apiKeyInput.value.trim().length > 0;
      verifyBtn.disabled = !canVerify;
    };
    baseUrlInput.addEventListener('input', updateVerifyButton);
    apiKeyInput.addEventListener('input', updateVerifyButton);
    updateVerifyButton();

    presetSelect.addEventListener('change', () => {
      const preset = PRESETS.find(p => p.name === presetSelect.value);
      if (preset) {
        baseUrlInput.value = preset.baseUrl;
        apiKeyInput.placeholder = preset.apiKeyPlaceholder;
      }
      updateVerifyButton();
    });

    modelSelect.addEventListener('change', () => {
      nextBtn.disabled = !modelSelect.value;
    });

    modelManual.addEventListener('input', () => {
      nextBtn.disabled = !modelManual.value.trim();
    });

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 1;
      this.render();
    });

    verifyBtn.addEventListener('click', () => this.verifyLLM(baseUrlInput, apiKeyInput, modelSelect, modelManual, verifyBtn, nextBtn, resultEl));
    this.element.querySelector('#ob-next')!.addEventListener('click', () => this.saveLLM());
  }

  private renderSearchConfig() {
    this.element.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-steps">
          <span class="step">1</span>
          <span class="step">2</span>
          <span class="step active">3</span>
        </div>
        <h1>Websuche</h1>
        <p class="onboarding-subtitle">Optional: Aktiviere Websuche über Tavily. Du kannst dies später in den Einstellungen ändern.</p>
        
        <div class="form-group">
          <label for="ob-search-provider">Search Provider</label>
          <select id="ob-search-provider">
            <option value="none" ${this.config.searchProvider === 'none' ? 'selected' : ''}>Deaktiviert</option>
            <option value="tavily" ${this.config.searchProvider === 'tavily' ? 'selected' : ''}>Tavily</option>
          </select>
        </div>
        
        <div class="form-group" id="ob-search-key-group">
          <label for="ob-search-apikey">Tavily API Key</label>
          <input id="ob-search-apikey" type="password" value="${escapeHtml(this.config.searchApiKey)}" placeholder="tvly-..." />
          <p class="field-hint">Nur im Browser gespeichert. Hole deinen Key unter <a href="https://app.tavily.com/" target="_blank" rel="noopener">app.tavily.com</a>.</p>
        </div>
        
        <div class="onboarding-actions">
          <button id="ob-back" class="btn btn-secondary">Zurück</button>
          <button id="ob-complete" class="btn btn-primary">vibeAgentGo starten</button>
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
      this.step = 2;
      this.render();
    });

    this.element.querySelector('#ob-complete')!.addEventListener('click', () => this.complete());
  }

  private findPreset(baseUrl: string, model: string): Preset | undefined {
    return PRESETS.find(p => p.baseUrl === baseUrl && p.model === model);
  }

  private async verifyLLM(
    baseUrlInput: HTMLInputElement,
    apiKeyInput: HTMLInputElement,
    modelSelect: HTMLSelectElement,
    modelManual: HTMLInputElement,
    verifyBtn: HTMLButtonElement,
    nextBtn: HTMLButtonElement,
    resultEl: HTMLElement
  ) {
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    resultEl.textContent = 'Verifiziere Verbindung...';
    resultEl.className = 'test-result test-pending';
    verifyBtn.disabled = true;

    const res = await testConnection({ baseUrl, apiKey });
    verifyBtn.disabled = false;

    if (!res.ok) {
      resultEl.textContent = `❌ Verbindung fehlgeschlagen: ${res.error}`;
      resultEl.className = 'test-result test-error';
      modelSelect.disabled = true;
      modelSelect.innerHTML = '<option value="">Verifizierung fehlgeschlagen</option>';
      modelManual.style.display = 'none';
      nextBtn.disabled = true;
      return;
    }

    const models = res.models.length ? res.models : [];
    resultEl.textContent = `✅ Verbindung OK. ${models.length} Modell(e) gefunden.`;
    resultEl.className = 'test-result test-success';

    if (models.length > 0) {
      const currentModel = this.config.model;
      const options = models
        .map(m => `<option value="${escapeHtml(m)}" ${m === currentModel ? 'selected' : ''}>${escapeHtml(m)}</option>`)
        .join('');
      modelSelect.innerHTML = `<option value="">Modell wählen...</option>${options}`;
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
      modelSelect.innerHTML = '<option value="">Keine Modelle gelistet — manuell eingeben</option>';
      modelSelect.disabled = true;
      modelManual.style.display = 'block';
      modelManual.value = this.config.model;
      nextBtn.disabled = !modelManual.value.trim();
    }
  }

  private saveLLM() {
    const baseUrl = (this.element.querySelector('#ob-baseurl') as HTMLInputElement).value.trim();
    const modelManual = (this.element.querySelector('#ob-model-manual') as HTMLInputElement);
    const modelSelect = (this.element.querySelector('#ob-model') as HTMLSelectElement);
    const model = modelManual.style.display === 'block'
      ? modelManual.value.trim()
      : modelSelect.value.trim();
    const apiKey = (this.element.querySelector('#ob-apikey') as HTMLInputElement).value.trim();
    const maxTurns = parseInt((this.element.querySelector('#ob-maxturns') as HTMLInputElement).value) || 30;
    const maxTokensInput = (this.element.querySelector('#ob-maxtokens') as HTMLInputElement).value;
    const maxTokens = maxTokensInput.trim() === '' ? 0 : Math.max(0, parseInt(maxTokensInput) || 0);

    if (!baseUrl || !model) {
      alert('Bitte Base URL und Model angeben.');
      return;
    }

    this.config = saveConfig({ ...this.config, baseUrl, model, apiKey, maxTurns, maxTokens });
    this.step = 3;
    this.render();
  }

  private complete() {
    const searchProvider = (this.element.querySelector('#ob-search-provider') as HTMLSelectElement).value as 'none' | 'tavily';
    const searchApiKey = (this.element.querySelector('#ob-search-apikey') as HTMLInputElement).value.trim();

    if (searchProvider === 'tavily' && !searchApiKey) {
      alert('Bitte Tavily API Key eingeben oder Websuche deaktivieren.');
      return;
    }

    saveConfig({ ...this.config, searchProvider, searchApiKey });
    completeOnboarding();
    if (this.onComplete) this.onComplete();
  }

}
