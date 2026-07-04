// ============================================================
// vibeAgentGo — Onboarding Wizard (3 steps: welcome, LLM config, search config)
// ============================================================

import { saveConfig, loadConfig, completeOnboarding } from '../core/memory.js';
import { testConnection } from '../core/llm_client.js';

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
    name: 'Claude (OpenRouter)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    apiKeyPlaceholder: 'sk-or-...',
  },
  {
    name: 'Kimi Code',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-5-coder',
    apiKeyPlaceholder: 'sk-...',
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
              <p>vibeAgentGo spricht mit jedem OpenAI-kompatiblen Endpunkt. OpenAI, Ollama, Claude über OpenRouter, Kimi — du wählst.</p>
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
          <input id="ob-baseurl" type="text" value="${this.escape(this.config.baseUrl)}" placeholder="https://api.example.com/v1" />
        </div>
        
        <div class="form-group">
          <label for="ob-model">Model</label>
          <input id="ob-model" type="text" value="${this.escape(this.config.model)}" placeholder="model-id" />
        </div>
        
        <div class="form-group">
          <label for="ob-apikey">API Key</label>
          <input id="ob-apikey" type="password" value="${this.escape(this.config.apiKey)}" placeholder="sk-..." />
        </div>
        
        <div class="form-group">
          <label for="ob-maxturns">Max Turns</label>
          <input id="ob-maxturns" type="number" value="${this.config.maxTurns}" min="1" max="100" />
        </div>
        
        <div id="ob-test-result" class="test-result"></div>
        
        <div class="onboarding-actions">
          <button id="ob-back" class="btn btn-secondary">Zurück</button>
          <button id="ob-test" class="btn btn-secondary">Verbindung testen</button>
          <button id="ob-next" class="btn btn-primary">Weiter</button>
        </div>
      </div>
    `;

    const presetSelect = this.element.querySelector('#ob-preset') as HTMLSelectElement;
    const baseUrlInput = this.element.querySelector('#ob-baseurl') as HTMLInputElement;
    const modelInput = this.element.querySelector('#ob-model') as HTMLInputElement;
    const apiKeyInput = this.element.querySelector('#ob-apikey') as HTMLInputElement;

    presetSelect.addEventListener('change', () => {
      const preset = PRESETS.find(p => p.name === presetSelect.value);
      if (preset) {
        baseUrlInput.value = preset.baseUrl;
        modelInput.value = preset.model;
        apiKeyInput.placeholder = preset.apiKeyPlaceholder;
      }
    });

    this.element.querySelector('#ob-back')!.addEventListener('click', () => {
      this.step = 1;
      this.render();
    });

    this.element.querySelector('#ob-test')!.addEventListener('click', () => this.testLLM());
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
          <input id="ob-search-apikey" type="password" value="${this.escape(this.config.searchApiKey)}" placeholder="tvly-..." />
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

  private testLLM() {
    const baseUrl = (this.element.querySelector('#ob-baseurl') as HTMLInputElement).value.trim();
    const apiKey = (this.element.querySelector('#ob-apikey') as HTMLInputElement).value.trim();
    const resultEl = this.element.querySelector('#ob-test-result') as HTMLElement;

    resultEl.textContent = 'Teste Verbindung...';
    resultEl.className = 'test-result test-pending';

    testConnection({ baseUrl, apiKey }).then(res => {
      if (res.ok) {
        const list = res.models.length ? `\n${res.models.slice(0, 10).join('\n')}` : 'Keine Models aufgelistet';
        resultEl.textContent = `✅ Verbindung OK. ${res.models.length} Modelle gefunden.\n${list}`;
        resultEl.className = 'test-result test-success';
      } else {
        resultEl.textContent = `❌ Verbindung fehlgeschlagen: ${res.error}`;
        resultEl.className = 'test-result test-error';
      }
    });
  }

  private saveLLM() {
    const baseUrl = (this.element.querySelector('#ob-baseurl') as HTMLInputElement).value.trim();
    const model = (this.element.querySelector('#ob-model') as HTMLInputElement).value.trim();
    const apiKey = (this.element.querySelector('#ob-apikey') as HTMLInputElement).value.trim();
    const maxTurns = parseInt((this.element.querySelector('#ob-maxturns') as HTMLInputElement).value) || 30;

    if (!baseUrl || !model) {
      alert('Bitte Base URL und Model angeben.');
      return;
    }

    this.config = saveConfig({ ...this.config, baseUrl, model, apiKey, maxTurns });
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

  private escape(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
