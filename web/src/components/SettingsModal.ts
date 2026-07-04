// ============================================================
// HAG — SettingsModal (client-side, localStorage config)
// ============================================================

import { loadConfig, saveConfig, hasApiKey } from '../core/memory.js';

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

    this.modal.innerHTML = `
      <h2>⚙️ Settings</h2>
      <div class="form-group">
        <label for="cfg-model">Model</label>
        <input id="cfg-model" type="text" value="${this.escape(config.model)}" placeholder="qwen/qwen3.6-35b-a3b" />
      </div>
      <div class="form-group">
        <label for="cfg-baseurl">Base URL</label>
        <input id="cfg-baseurl" type="text" value="${this.escape(config.baseUrl)}" placeholder="https://ki.vibeops.de/v1" />
      </div>
      <div class="form-group">
        <label for="cfg-apikey">API Key ${config.apiKey ? '✓' : ''}</label>
        <input id="cfg-apikey" type="password" value="${this.escape(config.apiKey)}" placeholder="lm-studio:..." />
      </div>
      <div class="form-group">
        <label for="cfg-maxturns">Max Turns</label>
        <input id="cfg-maxturns" type="number" value="${config.maxTurns}" min="1" max="100" />
      </div>
      <div class="form-actions">
        <button id="cfg-cancel" class="btn btn-secondary">Abbrechen</button>
        <button id="cfg-save" class="btn btn-primary">Speichern</button>
      </div>
      <div class="config-hint">
        <p><strong>🔒 Datenhoheit:</strong> Alle Daten liegen in deinem Browser (IndexedDB). Nur LLM-Anfragen gehen an den konfigurierten Server.</p>
        <p><strong>⚠️ Sicherheit:</strong> Der API-Key wird unverschlüsselt im localStorage gespeichert. Nicht auf fremden Geräten oder im Inkognito-Modus verwenden.</p>
        <p><strong>Provider:</strong> Jeder OpenAI-kompatible Endpoint mit CORS funktioniert.</p>
        <p><strong>Beispiele:</strong></p>
        <ul>
          <li>Mac Studio: <code>https://ki.vibeops.de/v1</code></li>
          <li>OpenRouter: <code>https://openrouter.ai/v1</code></li>
          <li>OpenAI: <code>https://api.openai.com/v1</code></li>
        </ul>
      </div>
    `;

    this.modal.querySelector('#cfg-cancel')!.addEventListener('click', () => this.close());
    this.modal.querySelector('#cfg-save')!.addEventListener('click', () => this.save());
  }

  private save() {
    const model = (this.modal.querySelector('#cfg-model') as HTMLInputElement).value;
    const baseUrl = (this.modal.querySelector('#cfg-baseurl') as HTMLInputElement).value;
    const apiKey = (this.modal.querySelector('#cfg-apikey') as HTMLInputElement).value;
    const maxTurns = parseInt((this.modal.querySelector('#cfg-maxturns') as HTMLInputElement).value);

    saveConfig({ model, baseUrl, apiKey, maxTurns });
    this.close();
  }

  private escape(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}