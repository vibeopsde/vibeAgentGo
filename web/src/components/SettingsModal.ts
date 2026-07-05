// ============================================================
// vibeAgentGo — SettingsModal (client-side, localStorage config)
// ============================================================

import { loadConfig, saveConfig, hasApiKey, resetLocalData } from '../core/memory.js';
import { BackupManager } from '../core/backup.js';
import { testConnection } from '../core/llm_client.js';
import { PROVIDER_PRESETS, findPresetByUrlAndModel, findPresetByKey } from '../core/presets.js';
import { getTheme, setTheme, type ThemeMode } from '../core/theme.js';
import { escapeHtml } from '../utils/escape.js';
import { VERSION } from '../version.js';
import { t, setLanguage, getAvailableLanguages } from '../i18n/index.js';

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
    const initialPreset = findPresetByUrlAndModel(config.baseUrl, config.model);
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
          ${PROVIDER_PRESETS.map(p => `<option value="${p.key}" ${initialPreset?.key === p.key ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
        </select>
        <p class="field-hint">${t('settings.providerHint')}</p>
      </div>
      <div class="form-group">
        <label for="cfg-model">${t('settings.model')}</label>
        <input id="cfg-model" type="text" value="${escapeHtml(config.model)}" placeholder="llama3.2" />
      </div>
      <div class="form-group">
        <label for="cfg-baseurl">${t('settings.baseUrl')}</label>
        <input id="cfg-baseurl" type="text" value="${escapeHtml(config.baseUrl)}" placeholder="https://openrouter.ai/api/v1" />
      </div>
      <div class="form-group">
        <label for="cfg-apikey">${t('settings.apiKey')} ${config.apiKey ? '✓' : ''}</label>
        <input id="cfg-apikey" type="password" value="${escapeHtml(config.apiKey)}" placeholder="sk-..." />
      </div>
      <div class="form-group">
        <label for="cfg-maxturns">${t('settings.maxTurns')}</label>
        <input id="cfg-maxturns" type="number" value="${config.maxTurns}" min="1" max="100" />
      </div>
      <h3>🗄️ ${t('settings.backup')}</h3>
      <div class="form-group">
        <label class="checkbox-label">
          <input id="cfg-backup-include-keys" type="checkbox" />
          ${t('settings.backupIncludeKeys')}
        </label>
      </div>
      <div class="form-actions">
        <button id="cfg-export" class="btn btn-secondary">${t('settings.export')}</button>
        <button id="cfg-import" class="btn btn-secondary">${t('settings.import')}</button>
      </div>
      <input id="cfg-import-file" type="file" accept=".zip" style="display:none;" />
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
          <li>${t('settings.openrouter')} <code>${t('settings.openrouterUrl')}</code></li>
          <li>${t('settings.opencode')} <code>${t('settings.opencodeUrl')}</code></li>
          <li>${t('settings.ollamaCloud')} <code>${t('settings.ollamaCloudUrl')}</code></li>
        </ul>
      </div>
    `;

    this.modal.querySelector('#cfg-cancel')!.addEventListener('click', () => this.close());
    this.modal.querySelector('#cfg-save')!.addEventListener('click', () => this.save());
    this.modal.querySelector('#cfg-test')!.addEventListener('click', () => this.testConnection());

    const exportBtn = this.modal.querySelector('#cfg-export') as HTMLButtonElement;
    const importBtn = this.modal.querySelector('#cfg-import') as HTMLButtonElement;
    const importFile = this.modal.querySelector('#cfg-import-file') as HTMLInputElement;
    const includeKeys = this.modal.querySelector('#cfg-backup-include-keys') as HTMLInputElement;

    exportBtn?.addEventListener('click', () => this.exportBackup(includeKeys?.checked ?? false));
    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', (e) => this.importBackup(e));

    const providerSelect = this.modal.querySelector('#cfg-provider') as HTMLSelectElement;
    const modelInput = this.modal.querySelector('#cfg-model') as HTMLInputElement;
    const baseUrlInput = this.modal.querySelector('#cfg-baseurl') as HTMLInputElement;

    providerSelect.addEventListener('change', () => {
      const preset = findPresetByKey(providerSelect.value);
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

  private async exportBackup(includeApiKeys: boolean) {
    const manager = new BackupManager(VERSION);
    try {
      const blob = await manager.exportZip(includeApiKeys);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vibeAgentGo-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.showBackupMessage(t('settings.exportSuccess'), 'success');
    } catch (err) {
      this.showBackupMessage(t('settings.exportError') + ': ' + (err as Error).message, 'error');
    }
  }

  private async importBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (!confirm(t('settings.importConfirm'))) return;

    const manager = new BackupManager(VERSION);
    try {
      await manager.importZip(file);
      this.showBackupMessage(t('settings.importSuccess'), 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      this.showBackupMessage(t('settings.importError') + ': ' + (err as Error).message, 'error');
    }
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
