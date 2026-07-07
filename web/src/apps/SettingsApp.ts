// ============================================================
// vibeAgentGo — SettingsApp
// First-class window-manager app with a tabbed settings UI.
// Includes LLM, Search, Appearance, Memory, Skills, Backup and Danger Zone.
// ============================================================

import { loadConfig, saveConfig, type ClientConfig } from '../core/memory.js';
import { findPresetByUrlAndModel, PROVIDER_PRESETS } from '../core/presets.js';
import { getTheme, setTheme, type ThemeMode } from '../core/theme.js';
import { escapeHtml } from '../utils/escape.js';
import { VERSION } from '../version.js';
import { sounds } from '../core/sounds.js';
import { t, setLanguage, getAvailableLanguages } from '../i18n/index.js';
import { renderLLMConfigSection } from '../components/SettingsLLMSection.js';
import { renderSearchConfigSection } from '../components/SettingsSearchSection.js';
import { renderBackupSection } from '../components/SettingsBackupSection.js';
import { renderDangerZoneSection } from '../components/SettingsDangerZoneSection.js';
import { MemoryPanel } from '../components/MemoryPanel.js';
import { SkillsPanel } from '../components/SkillsPanel.js';
import type { App } from '../types/index.js';

type TabKey = 'llm' | 'search' | 'appearance' | 'memory' | 'skills' | 'backup' | 'danger';

interface TabDef {
  id: TabKey;
  icon: string;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'llm', icon: '🤖', label: 'settings.tabLLM' },
  { id: 'search', icon: '🔍', label: 'settings.tabSearch' },
  { id: 'appearance', icon: '🎨', label: 'settings.tabAppearance' },
  { id: 'memory', icon: '🧠', label: 'header.memory' },
  { id: 'skills', icon: '🛠️', label: 'header.skills' },
  { id: 'backup', icon: '🗄️', label: 'settings.backup' },
  { id: 'danger', icon: '⚠️', label: 'settings.dangerZone' },
];

export class SettingsApp implements App {
  id = 'settings';
  title = t('settings.title');
  icon = '⚙️';
  element: HTMLElement;
  private container: HTMLElement | null = null;
  private currentTab: TabKey = 'llm';

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'settings-app';
  }

  private emitReload() {
    this.element.dispatchEvent(new CustomEvent('settings:reload', { bubbles: true }));
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.innerHTML = '';
    this.renderShell(container);
    this.renderTab(container, this.currentTab);
  }

  private renderShell(container: HTMLElement) {
    container.className = 'settings-app';
    container.innerHTML = `
      <aside class="settings-sidebar">
        <div class="settings-brand">
          <img class="settings-brand-logo" src="./logo-192.png" alt="vibeAgentGo" width="36" height="36" />
          <div>
            <h2>vibeAgentGo</h2>
            <span class="settings-version">${VERSION}</span>
          </div>
        </div>
        <nav class="settings-tabs" role="tablist">
          ${TABS.map((tab) => `
            <button
              class="settings-tab ${tab.id === this.currentTab ? 'active' : ''}"
              data-tab="${tab.id}"
              role="tab"
              aria-selected="${tab.id === this.currentTab ? 'true' : 'false'}"
            >
              <span class="tab-icon">${tab.icon}</span>
              <span class="tab-label">${t(tab.label)}</span>
            </button>
          `).join('')}
        </nav>
      </aside>
      <section class="settings-content">
        <div class="settings-panel" id="settings-panel"></div>
      </section>
    `;

    container.querySelectorAll('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).dataset.tab as TabKey;
        this.switchTab(container, tab);
      });
    });
  }

  private switchTab(container: HTMLElement, tab: TabKey) {
    this.currentTab = tab;
    container.querySelectorAll('.settings-tab').forEach((btn) => {
      const isActive = (btn as HTMLElement).dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      (btn as HTMLElement).setAttribute('aria-selected', String(isActive));
    });
    this.renderTab(container, tab);
  }

  private renderTab(container: HTMLElement, tab: TabKey) {
    const panel = container.querySelector('#settings-panel') as HTMLElement;
    if (!panel) return;
    panel.innerHTML = '';

    switch (tab) {
      case 'llm':
        this.renderLLMTab(panel);
        break;
      case 'search':
        this.renderSearchTab(panel);
        break;
      case 'appearance':
        this.renderAppearanceTab(panel);
        break;
      case 'memory':
        this.renderMemoryTab(panel);
        break;
      case 'skills':
        this.renderSkillsTab(panel);
        break;
      case 'backup':
        this.renderBackupTab(panel);
        break;
      case 'danger':
        this.renderDangerTab(panel);
        break;
    }
  }

  private renderLLMTab(panel: HTMLElement) {
    const config = loadConfig();
    const initialPreset = findPresetByUrlAndModel(config.baseUrl, config.model) ?? PROVIDER_PRESETS[0];

    panel.innerHTML = `
      <h3 class="settings-panel-title">🤖 ${t('settings.tabLLM')}</h3>
      <p class="settings-panel-hint">${t('settings.providerInfo')}</p>
      <div class="settings-form" id="llm-form"></div>
    `;

    const form = panel.querySelector('#llm-form') as HTMLElement;
    const llm = renderLLMConfigSection(form, config, initialPreset);

    this.addSaveAction(panel, () => {
      saveConfig({
        ...config,
        baseUrl: llm.baseUrl,
        model: llm.model,
        apiKey: llm.apiKey,
        maxTurns: llm.maxTurns,
      });
      this.emitReload();
    });
  }

  private renderSearchTab(panel: HTMLElement) {
    const config = loadConfig();

    panel.innerHTML = `
      <h3 class="settings-panel-title">🔍 ${t('settings.tabSearch')}</h3>
      <p class="settings-panel-hint">${t('onboarding.searchHint')}</p>
      <div class="settings-form" id="search-form"></div>
    `;

    const form = panel.querySelector('#search-form') as HTMLElement;
    const search = renderSearchConfigSection(form, config);

    this.addSaveAction(panel, () => {
      saveConfig({
        ...config,
        searchProvider: search.searchProvider,
        searchApiKey: search.searchApiKey,
      });
      this.emitReload();
    });
  }

  private renderAppearanceTab(panel: HTMLElement) {
    const config = loadConfig();
    const theme = getTheme();
    const languageOptions = getAvailableLanguages()
      .map(
        (l) =>
          `<option value="${escapeHtml(l.value)}" ${config.language === l.value ? 'selected' : ''}>${escapeHtml(l.label)}</option>`
      )
      .join('');

    panel.innerHTML = `
      <h3 class="settings-panel-title">🎨 ${t('settings.tabAppearance')}</h3>
      <p class="settings-panel-hint">${t('onboarding.languageHint')}</p>
      <div class="settings-form">
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
          <label>System-Sounds</label>
          <label class="toggle-row">
            <input type="checkbox" id="cfg-sounds" ${config.sounds !== false ? 'checked' : ''} />
            <span>🔊 Akustische Signale bei Tool-Aufrufen und Fertig-Meldung</span>
          </label>
        </div>
      </div>
    `;

    this.addSaveAction(panel, () => {
      const language = (panel.querySelector('#cfg-language') as HTMLSelectElement).value as 'de' | 'en';
      const themeValue = (panel.querySelector('#cfg-theme') as HTMLSelectElement).value as ThemeMode;
      const soundsEnabled = (panel.querySelector('#cfg-sounds') as HTMLInputElement).checked;
      setLanguage(language);
      setTheme(themeValue);
      sounds.setEnabled(soundsEnabled);
      saveConfig({ ...config, language, sounds: soundsEnabled });
      this.emitReload();
    });
  }

  private renderMemoryTab(panel: HTMLElement) {
    panel.innerHTML = `<h3 class="settings-panel-title">🧠 ${t('header.memory')}</h3>`;
    const memoryPanel = new MemoryPanel();
    panel.appendChild(memoryPanel.element);
    memoryPanel.open();
  }

  private renderSkillsTab(panel: HTMLElement) {
    panel.innerHTML = `<h3 class="settings-panel-title">🛠️ ${t('header.skills')}</h3>`;
    const skillsPanel = new SkillsPanel();
    panel.appendChild(skillsPanel.element);
    skillsPanel.open();
  }

  private renderBackupTab(panel: HTMLElement) {
    panel.innerHTML = `<h3 class="settings-panel-title">🗄️ ${t('settings.backup')}</h3>`;
    renderBackupSection(panel, {
      onMessage: (message, kind) => this.showBackupMessage(panel, message, kind),
      onReload: () => this.emitReload(),
    });
  }

  private renderDangerTab(panel: HTMLElement) {
    panel.innerHTML = `<h3 class="settings-panel-title">⚠️ ${t('settings.dangerZone')}</h3>`;
    renderDangerZoneSection(panel, () => this.emitReload());
  }

  private addSaveAction(panel: HTMLElement, onSave: () => void) {
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.innerHTML = `<button class="btn btn-primary">${t('common.save')}</button>`;
    actions.querySelector('button')!.addEventListener('click', onSave);
    panel.appendChild(actions);
  }

  private showBackupMessage(container: HTMLElement, message: string, kind: 'success' | 'error') {
    let resultEl = container.querySelector('#cfg-backup-result') as HTMLElement | null;
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.id = 'cfg-backup-result';
      container.insertBefore(resultEl, container.querySelector('#cfg-reset')?.parentElement || null);
    }
    resultEl.textContent = message;
    resultEl.className = `test-result test-${kind}`;
  }
}
