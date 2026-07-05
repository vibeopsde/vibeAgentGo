// ============================================================
// vibeAgentGo — SettingsModal (client-side, localStorage config)
// ============================================================

import { loadConfig, saveConfig, hasApiKey, resetLocalData } from '../core/memory.js';
import { testConnection } from '../core/llm_client.js';
import { getTheme, setTheme, type ThemeMode } from '../core/theme.js';
import { escapeHtml } from '../utils/escape.js';

const PRESETS = {
  'openrouter': {
    model: 'moonshotai/kimi-k2.7-code',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'lm-studio': {
    model: 'qwen/qwen3.6-35b-a3b',
    baseUrl: 'https://ki.vibeops.de/v1',
  },
  'openai': {
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
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

    this.modal.innerHTML = `
      <h2>⚙️ Settings</h2>
      <div class="form-group">
        <label for="cfg-theme">Theme</label>
        <select id="cfg-theme">
          <option value="system" ${theme === 'system' ? 'selected' : ''}>System</option>
          <option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option>
        </select>
      </div>
      <div class="form-group">
        <label for="cfg-provider">Provider Preset</label>
        <select id="cfg-provider">
          <option value="custom" ${!initialPreset ? 'selected' : ''}>Benutzerdefiniert</option>
          <option value="openrouter" ${initialPreset === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
          <option value="lm-studio" ${initialPreset === 'lm-studio' ? 'selected' : ''}>Mac Studio (LM Studio)</option>
          <option value="openai" ${initialPreset === 'openai' ? 'selected' : ''}>OpenAI</option>
        </select>
        <p class="field-hint">Preset trägt Modell + Base URL ein. API Key musst du selbst einfügen.</p>
      </div>
      <div class="form-group">
        <label for="cfg-model">Model</label>
        <input id="cfg-model" type="text" value="${escapeHtml(config.model)}" placeholder="qwen/qwen3.6-35b-a3b" />
      </div>
      <div class="form-group">
        <label for="cfg-baseurl">Base URL</label>
        <input id="cfg-baseurl" type="text" value="${escapeHtml(config.baseUrl)}" placeholder="https://ki.vibeops.de/v1" />
      </div>
      <div class="form-group">
        <label for="cfg-apikey">API Key ${config.apiKey ? '✓' : ''}</label>
        <input id="cfg-apikey" type="password" value="${escapeHtml(config.apiKey)}" placeholder="lm-studio:..." />
      </div>
      <div class="form-group">
        <label for="cfg-maxturns">Max Turns</label>
        <input id="cfg-maxturns" type="number" value="${config.maxTurns}" min="1" max="100" />
      </div>
      <div class="form-group">
        <label for="cfg-maxtokens">Max Response Tokens</label>
        <input id="cfg-maxtokens" type="number" value="${config.maxTokens}" min="256" max="65536" step="256" />
        <p class="field-hint">Limits how many tokens the model may generate per turn. Lower = faster, cheaper answers. 0 = unlimited.</p>
      </div>
      <h3>🔍 Search Provider</h3>
      <div class="form-group">
        <label for="cfg-search-provider">Provider</label>
        <select id="cfg-search-provider">
          <option value="none" ${config.searchProvider === 'none' ? 'selected' : ''}>Deaktiviert</option>
          <option value="tavily" ${config.searchProvider === 'tavily' ? 'selected' : ''}>Tavily</option>
        </select>
      </div>
      <div class="form-group">
        <label for="cfg-search-apikey">Search API Key ${config.searchApiKey ? '✓' : ''}</label>
        <input id="cfg-search-apikey" type="password" value="${escapeHtml(config.searchApiKey)}" placeholder="tvly-..." />
        <p class="field-hint">Nur im Browser gespeichert. Für Tavily: <a href="https://app.tavily.com/" target="_blank" rel="noopener">app.tavily.com</a></p>
      </div>
      <div class="form-actions">
        <button id="cfg-cancel" class="btn btn-secondary">Abbrechen</button>
        <button id="cfg-test" class="btn btn-secondary">Verbindung testen</button>
        <button id="cfg-save" class="btn btn-primary">Speichern</button>
      </div>
      <div id="cfg-test-result" class="test-result"></div>
      <div class="form-actions">
        <button id="cfg-reset" class="btn btn-danger">Alle lokalen Daten löschen</button>
      </div>
      <div id="cfg-reset-confirm" class="reset-confirm" style="display:none;">
        <p><strong>⚠️ Achtung:</strong> Das löscht alle Sessions, Dateien, Memory-Einträge, Skills und Einstellungen aus diesem Browser. Das kann nicht rückgängig gemacht werden.</p>
        <div class="form-actions">
          <button id="cfg-reset-cancel" class="btn btn-secondary">Abbrechen</button>
          <button id="cfg-reset-confirm-btn" class="btn btn-danger">Ja, alles löschen</button>
        </div>
      </div>
      <div class="config-hint">
        <p><strong>🔒 Datenhoheit:</strong> Alle Daten liegen in deinem Browser (IndexedDB). Nur LLM-Anfragen gehen an den konfigurierten Server.</p>
        <p><strong>⚠️ Sicherheit:</strong> Der API-Key wird unverschlüsselt im localStorage gespeichert. Nicht auf fremden Geräten oder im Inkognito-Modus verwenden.</p>
        <p><strong>Provider:</strong> Jeder OpenAI-kompatible Endpoint mit CORS funktioniert.</p>
        <p><strong>Beispiele:</strong></p>
        <ul>
          <li>Mac Studio: <code>https://ki.vibeops.de/v1</code></li>
          <li>OpenRouter: <code>https://openrouter.ai/api/v1</code></li>
          <li>OpenAI: <code>https://api.openai.com/v1</code></li>
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
      if (preset.baseUrl === baseUrl && preset.model === model) return key;
    }
    return null;
  }

  private testConnection() {
    const baseUrl = (this.modal.querySelector('#cfg-baseurl') as HTMLInputElement).value.trim();
    const apiKey = (this.modal.querySelector('#cfg-apikey') as HTMLInputElement).value.trim();
    const resultEl = this.modal.querySelector('#cfg-test-result') as HTMLElement;

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

  private save() {
    const model = (this.modal.querySelector('#cfg-model') as HTMLInputElement).value;
    const baseUrl = (this.modal.querySelector('#cfg-baseurl') as HTMLInputElement).value;
    const apiKey = (this.modal.querySelector('#cfg-apikey') as HTMLInputElement).value;
    const maxTurns = parseInt((this.modal.querySelector('#cfg-maxturns') as HTMLInputElement).value);
    const maxTokens = parseInt((this.modal.querySelector('#cfg-maxtokens') as HTMLInputElement).value);
    const searchProvider = (this.modal.querySelector('#cfg-search-provider') as HTMLSelectElement).value as 'none' | 'tavily';
    const searchApiKey = (this.modal.querySelector('#cfg-search-apikey') as HTMLInputElement).value;
    const theme = (this.modal.querySelector('#cfg-theme') as HTMLSelectElement).value as ThemeMode;

    setTheme(theme);
    saveConfig({ model, baseUrl, apiKey, maxTurns, maxTokens, searchProvider, searchApiKey });
    this.close();
  }
}
