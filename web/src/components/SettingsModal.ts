// ============================================================
// HAG — SettingsModal Component
// ============================================================

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
    this.loadConfig();
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }

  private async loadConfig() {
    try {
      const res = await fetch('./api/config');
      const config = await res.json();

      this.modal.innerHTML = `
        <h2>⚙️ Settings</h2>
        <div class="form-group">
          <label for="cfg-model">Model</label>
          <input id="cfg-model" type="text" value="${config.model}" placeholder="gpt-4o-mini" />
        </div>
        <div class="form-group">
          <label for="cfg-baseurl">Base URL</label>
          <input id="cfg-baseurl" type="text" value="${config.baseUrl}" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="form-group">
          <label for="cfg-apikey">API Key ${config.hasApiKey ? '✓' : ''}</label>
          <input id="cfg-apikey" type="password" value="" placeholder="${config.hasApiKey ? '(gesetzt — leer lassen zum Behalten)' : 'sk-...'}" />
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
          <p><strong>Provider:</strong> Jeder OpenAI-kompatible Endpoint funktioniert.</p>
          <p><strong>Beispiele:</strong></p>
          <ul>
            <li>OpenAI: <code>https://api.openai.com/v1</code></li>
            <li>OpenRouter: <code>https://openrouter.ai/v1</code></li>
            <li>Mac Studio: <code>http://192.168.x.x:1234/v1</code></li>
          </ul>
        </div>
      `;

      this.modal.querySelector('#cfg-cancel')!.addEventListener('click', () => this.close());
      this.modal.querySelector('#cfg-save')!.addEventListener('click', () => this.save());
    } catch (e) {
      this.modal.innerHTML = `<p>Fehler beim Laden der Konfiguration: ${e}</p>`;
    }
  }

  private async save() {
    const model = (this.modal.querySelector('#cfg-model') as HTMLInputElement).value;
    const baseUrl = (this.modal.querySelector('#cfg-baseurl') as HTMLInputElement).value;
    const apiKey = (this.modal.querySelector('#cfg-apikey') as HTMLInputElement).value;
    const maxTurns = parseInt((this.modal.querySelector('#cfg-maxturns') as HTMLInputElement).value);

    const body: any = { model, baseUrl, maxTurns };
    if (apiKey) body.apiKey = apiKey;

    try {
      await fetch('./api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      this.close();
    } catch (e) {
      alert('Fehler beim Speichern: ' + e);
    }
  }
}