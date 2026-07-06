// ============================================================
// vibeAgentGo — Settings UI: Search Config Section
// ============================================================

import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';
import type { ClientConfig } from '../core/memory.js';

export interface SearchConfigResult {
  searchProvider: 'none' | 'tavily';
  searchApiKey: string;
}

export function renderSearchConfigSection(modal: HTMLElement, config: ClientConfig): SearchConfigResult {
  modal.insertAdjacentHTML('beforeend', `
    <h3>🔍 ${t('settings.search')}</h3>
    <div class="form-group">
      <label for="cfg-search-provider">${t('settings.provider')}</label>
      <select id="cfg-search-provider">
        <option value="none" ${config.searchProvider === 'none' ? 'selected' : ''}>${t('settings.searchNone')}</option>
        <option value="tavily" ${config.searchProvider === 'tavily' ? 'selected' : ''}>${t('settings.searchTavily')}</option>
      </select>
    </div>
    <div class="form-group" id="cfg-search-apikey-group">
      <label for="cfg-search-apikey">${t('settings.searchApiKey')} ${config.searchApiKey ? '✓' : ''}</label>
      <input id="cfg-search-apikey" type="password" value="${escapeHtml(config.searchApiKey)}" placeholder="tvly-..." />
      <p class="field-hint">Tavily: <a href="https://app.tavily.com/" target="_blank" rel="noopener">app.tavily.com</a></p>
    </div>
  `);

  const providerSelect = modal.querySelector('#cfg-search-provider') as HTMLSelectElement;
  const keyGroup = modal.querySelector('#cfg-search-apikey-group') as HTMLElement;

  const updateVisibility = () => {
    keyGroup.style.display = providerSelect.value === 'tavily' ? 'block' : 'none';
  };
  updateVisibility();
  providerSelect.addEventListener('change', updateVisibility);

  return {
    get searchProvider() {
      return providerSelect.value as 'none' | 'tavily';
    },
    get searchApiKey() {
      return (modal.querySelector('#cfg-search-apikey') as HTMLInputElement).value.trim();
    },
  };
}

/** Read the current search config values from a container that contains the search section elements. */
export function readSearchConfigFrom(container: HTMLElement): SearchConfigResult | null {
  const providerSelect = container.querySelector('#cfg-search-provider') as HTMLSelectElement | null;
  const searchApiKeyInput = container.querySelector('#cfg-search-apikey') as HTMLInputElement | null;
  if (!providerSelect || !searchApiKeyInput) return null;
  return {
    searchProvider: providerSelect.value as 'none' | 'tavily',
    searchApiKey: searchApiKeyInput.value.trim(),
  };
}
