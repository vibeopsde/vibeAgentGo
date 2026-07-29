// ============================================================
// vibeAgentGo — SettingsApp
// First-class window-manager app with a tabbed settings UI.
// Includes LLM, Search, Appearance, Memory, Backup and Danger Zone.
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
import { renderWorkspaceSection } from '../components/SettingsWorkspaceSection.js';
import { getActiveWorkspace } from '../core/workspace.js';
import { MemoryPanel } from '../components/MemoryPanel.js';
import type { App } from '../types/index.js';

type TabKey = 'llm' | 'workspaces' | 'appearance' | 'memory' | 'data' | 'about';

interface TabDef {
  id: TabKey;
  icon: string;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'llm', icon: '🤖', label: 'settings.tabLLM' },
  { id: 'workspaces', icon: '🗂️', label: 'workspace.tabLabel' },
  { id: 'appearance', icon: '🎨', label: 'settings.tabAppearance' },
  { id: 'memory', icon: '🧠', label: 'header.memory' },
  { id: 'data', icon: '💾', label: 'settings.data' },
  { id: 'about', icon: 'ℹ️', label: 'settings.about' },
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
    // Render into our own element, not the container — the container may be
    // a .wm-space (mobile) whose class must not be overwritten.
    this.renderShell(this.element);
    this.renderTab(this.element, this.currentTab);
    container.appendChild(this.element);
  }

  private renderShell(container: HTMLElement) {
    // Add settings-app class without overwriting other classes (e.g. 'focused').
    if (!container.classList.contains('settings-app')) {
      container.classList.add('settings-app');
    }
    container.innerHTML = `
      <aside class="settings-sidebar">
        <div class="settings-brand">
          <img class="settings-brand-logo" src="./logo-192.png" alt="vibeAgentGo" width="36" height="36" />
          <div>
            <h2>vibeAgentGo</h2>
            <span class="settings-version">${VERSION}</span>
            <div class="settings-workspace-badge">🗂️ ${escapeHtml(getActiveWorkspace().name)}</div>
          </div>
        </div>
        <nav class="settings-tabs" role="tablist">
          ${TABS.map(
            (tab) => `
            <button
              class="settings-tab ${tab.id === this.currentTab ? 'active' : ''}"
              data-tab="${tab.id}"
              role="tab"
              aria-selected="${tab.id === this.currentTab ? 'true' : 'false'}"
            >
              <span class="tab-icon">${tab.icon}</span>
              <span class="tab-label">${t(tab.label)}</span>
            </button>
          `
          ).join('')}
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
      case 'workspaces':
        this.renderWorkspaceTab(panel);
        break;
      case 'llm':
        this.renderLLMTab(panel);
        break;
      case 'appearance':
        this.renderAppearanceTab(panel);
        break;
      case 'memory':
        this.renderMemoryTab(panel);
        break;
      case 'data':
        this.renderDataTab(panel);
        break;
      case 'about':
        this.renderAboutTab(panel);
        break;
    }
  }

  private renderWorkspaceTab(panel: HTMLElement) {
    renderWorkspaceSection(panel, () => {
      this.element.dispatchEvent(new CustomEvent('settings:switch-workspace', { bubbles: true }));
    });
  }

  private renderLLMTab(panel: HTMLElement) {
    const config = loadConfig();
    const initialPreset = findPresetByUrlAndModel(config.baseUrl, config.model) ?? PROVIDER_PRESETS[0];

    panel.innerHTML = `
      <h3 class="settings-panel-title">🤖 ${t('settings.tabLLM')}</h3>
      <p class="settings-panel-hint">${t('settings.providerInfo')}</p>
      <div class="settings-form" id="llm-form"></div>
      <div class="settings-section-separator"></div>
      <div class="settings-form" id="search-form"></div>
    `;

    const llmForm = panel.querySelector('#llm-form') as HTMLElement;
    const llm = renderLLMConfigSection(llmForm, config, initialPreset);

    const searchForm = panel.querySelector('#search-form') as HTMLElement;
    const search = renderSearchConfigSection(searchForm, config);

    this.addSaveAction(panel, () => {
      saveConfig({
        ...config,
        baseUrl: llm.baseUrl,
        model: llm.model,
        apiKey: llm.apiKey,
        maxTurns: llm.maxTurns,
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
          <label>${t('settings.sounds')}</label>
          <label class="toggle-row">
            <input type="checkbox" id="cfg-sounds" ${config.sounds !== false ? 'checked' : ''} />
            <span>${t('settings.soundsHint')}</span>
          </label>
        </div>
        <div class="form-group">
          <label for="cfg-tab-size">${t('settings.editorTabSize')}</label>
          <input type="number" id="cfg-tab-size" min="1" max="8" value="${config.editorTabSize ?? 2}" />
        </div>
      </div>
    `;

    this.addSaveAction(panel, () => {
      const language = (panel.querySelector('#cfg-language') as HTMLSelectElement).value as 'de' | 'en';
      const themeValue = (panel.querySelector('#cfg-theme') as HTMLSelectElement).value as ThemeMode;
      const soundsEnabled = (panel.querySelector('#cfg-sounds') as HTMLInputElement).checked;
      const editorTabSize = Math.max(
        1,
        Math.min(8, Math.round(Number((panel.querySelector('#cfg-tab-size') as HTMLInputElement).value) || 2))
      );
      setLanguage(language);
      setTheme(themeValue);
      sounds.setEnabled(soundsEnabled);
      saveConfig({ ...config, language, sounds: soundsEnabled, editorTabSize });
      this.emitReload();
    });
  }

  private renderMemoryTab(panel: HTMLElement) {
    panel.innerHTML = `<h3 class="settings-panel-title">🧠 ${t('header.memory')}</h3>`;
    const memoryPanel = new MemoryPanel();
    panel.appendChild(memoryPanel.element);
    memoryPanel.open();
  }

  private renderDataTab(panel: HTMLElement) {
    panel.innerHTML = `<h3 class="settings-panel-title">💾 ${t('settings.data')}</h3>`;
    renderBackupSection(panel, {
      onMessage: (message, kind) => this.showBackupMessage(panel, message, kind),
      onReload: () => this.emitReload(),
    });
    // Separator between backup and danger zone
    const sep = document.createElement('div');
    sep.className = 'settings-section-separator';
    panel.appendChild(sep);
    renderDangerZoneSection(panel, () => this.emitReload());
  }

  private renderAboutTab(panel: HTMLElement) {
    panel.innerHTML = `
      <h3 class="settings-panel-title">ℹ️ ${t('settings.about')}</h3>
      <div class="about-section">
        <div class="about-brand">
          <img class="about-logo" src="./logo-192.png" alt="vibeAgentGo" width="64" height="64" />
          <div>
            <h2 class="about-name">vibeAgentGo</h2>
            <span class="about-version">${VERSION}</span>
          </div>
        </div>
        <p class="about-tagline">${t('about.tagline')}</p>
      </div>
      <div class="settings-section-separator"></div>
      <div class="about-section">
        <h3 class="settings-section-subtitle">${t('about.techStack')}</h3>
        <ul class="about-list">
          <li><strong>TypeScript</strong> + Vite</li>
          <li><strong>IndexedDB</strong> — lokale Datenspeicherung</li>
          <li><strong>Web Worker</strong> — Code-Sandbox</li>
          <li><strong>Prism.js</strong> — Syntax-Highlighting</li>
          <li><strong>Service Worker</strong> — Offline-PWA</li>
        </ul>
      </div>
      <div class="settings-section-separator"></div>
      <div class="about-section">
        <h3 class="settings-section-subtitle">${t('about.builtWith')}</h3>
        <p class="about-text">${t('about.builtWithText')}</p>
      </div>
      <div class="settings-section-separator"></div>
      <div class="about-section">
        <h3 class="settings-section-subtitle">${t('about.links')}</h3>
        <p class="about-text">
          <a href="https://github.com/vibeopsde/vibeAgentGo" target="_blank" rel="noopener">📦 GitHub Repository</a>
        </p>
        <p class="about-text">
          <a href="https://vibeops.de" target="_blank" rel="noopener">🌐 vibeops.de</a>
        </p>
      </div>
      <div class="settings-section-separator"></div>
      <div class="about-section">
        <p class="about-license">MIT License — Copyright Lars Greipl — vibeops.de</p>
      </div>
    `;
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
