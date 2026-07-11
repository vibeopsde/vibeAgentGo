// ============================================================
// vibeAgentGo — Settings UI: LLM Config Section (shared)
// Provider → API key → verify → model dropdown (populated from API)
// Used by both SettingsModal and OnboardingWizard.
// ============================================================

import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';
import { testConnection } from '../core/llm_client.js';
import { PROVIDER_PRESETS, findPresetByKey, type ProviderPreset } from '../core/presets.js';
import type { ClientConfig } from '../core/memory.js';

export interface LLMConfigResult {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTurns: number;
}

/**
 * Render the LLM config section into `container`.
 * Returns a live result object whose getters reflect the current DOM state.
 */
export function renderLLMConfigSection(
  container: HTMLElement,
  config: ClientConfig,
  selectedPreset: ProviderPreset
): LLMConfigResult {
  const initialPreset = selectedPreset;
  const savedModel = config.model;

  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="form-group">
      <label for="cfg-provider">${t('settings.provider')}</label>
      <select id="cfg-provider">
        ${PROVIDER_PRESETS.map((p) => `<option value="${escapeHtml(p.key)}" ${initialPreset.key === p.key ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
      </select>
      <p class="field-hint">${t('settings.providerHint')}</p>
    </div>
    <div class="form-group" id="cfg-apikey-group">
      <label for="cfg-apikey">${t('settings.apiKey')}</label>
      <input id="cfg-apikey" type="password" value="${escapeHtml(config.apiKey)}" placeholder="sk-..." />
      <p class="field-hint" id="cfg-apikey-hint">${t('onboarding.apiKeyHint')}</p>
    </div>
    <div class="form-group">
      <button id="cfg-verify" class="btn btn-secondary">${t('onboarding.testConnection')}</button>
    </div>
    <div class="form-group">
      <label for="cfg-model">${t('settings.model')}</label>
      <select id="cfg-model" disabled>
        <option value="">${t('onboarding.verifyFirst')}</option>
      </select>
      <input id="cfg-model-manual" type="text" style="display:none; margin-top:8px;" placeholder="model-id" />
    </div>
    <div class="form-group">
      <label for="cfg-maxturns">${t('settings.maxTurns')}</label>
      <input id="cfg-maxturns" type="number" value="${config.maxTurns}" min="1" max="100" />
    </div>
    <div id="cfg-test-result" class="test-result"></div>
  `
  );

  const providerSelect = container.querySelector('#cfg-provider') as HTMLSelectElement;
  const apiKeyInput = container.querySelector('#cfg-apikey') as HTMLInputElement;
  const apiKeyGroup = container.querySelector('#cfg-apikey-group') as HTMLElement;
  const apiKeyHint = container.querySelector('#cfg-apikey-hint') as HTMLElement;
  const verifyBtn = container.querySelector('#cfg-verify') as HTMLButtonElement;
  const modelSelect = container.querySelector('#cfg-model') as HTMLSelectElement;
  const modelManual = container.querySelector('#cfg-model-manual') as HTMLInputElement;
  const resultEl = container.querySelector('#cfg-test-result') as HTMLElement;

  let currentBaseUrl = initialPreset.baseUrl;

  // ── Preset switching ──────────────────────────────────────
  const updateVerifyButton = () => {
    const preset = findPresetByKey(providerSelect.value);
    if (preset && !preset.apiKeyRequired) {
      verifyBtn.disabled = false;
    } else {
      verifyBtn.disabled = apiKeyInput.value.trim().length === 0;
    }
  };

  const applyProviderPreset = (key: string, isInitial = false) => {
    const preset = findPresetByKey(key);
    if (!preset) return;
    currentBaseUrl = preset.baseUrl;
    apiKeyInput.placeholder = preset.apiKeyPlaceholder;
    // Beim Initial-Render gespeicherten API-Key behalten; beim Wechsel des Providers Feld leeren.
    if (!isInitial) {
      apiKeyInput.value = '';
    }
    apiKeyGroup.style.display = preset.apiKeyRequired ? 'block' : 'none';
    apiKeyHint.textContent = preset.apiKeyRequired ? t('onboarding.apiKeyRequired') : t('onboarding.apiKeyHint');
    // Reset model dropdown to "verify first" state
    modelManual.style.display = 'none';
    modelManual.value = '';
    modelSelect.style.display = 'block';
    modelSelect.disabled = true;
    modelSelect.innerHTML = `<option value="">${t('onboarding.verifyFirst')}</option>`;
    updateVerifyButton();
  };

  // Initialise with the current preset — keep saved apiKey + model.
  applyProviderPreset(initialPreset.key, true);

  // Wenn ein gespeichertes Modell existiert, es direkt im Dropdown anzeigen (ohne Verify).
  if (savedModel) {
    modelSelect.innerHTML = `<option value="${escapeHtml(savedModel)}" selected>${escapeHtml(savedModel)}</option>`;
    modelSelect.disabled = false;
    modelSelect.value = savedModel;
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  providerSelect.addEventListener('change', () => applyProviderPreset(providerSelect.value));
  apiKeyInput.addEventListener('input', updateVerifyButton);

  // ── Verify + populate model dropdown ──────────────────────
  verifyBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    resultEl.textContent = t('common.loading');
    resultEl.className = 'test-result test-pending';
    verifyBtn.disabled = true;

    const res = await testConnection({ baseUrl: currentBaseUrl, apiKey });
    verifyBtn.disabled = false;

    if (!res.ok) {
      resultEl.textContent = `❌ ${t('settings.connectionError')}: ${res.error}`;
      resultEl.className = 'test-result test-error';
      modelSelect.disabled = true;
      modelSelect.innerHTML = `<option value="">${t('settings.connectionError')}</option>`;
      modelManual.style.display = 'none';
      return;
    }

    const models = res.models;
    resultEl.textContent = `✅ ${t('settings.connectionSuccess')} (${models.length})`;
    resultEl.className = 'test-result test-success';

    if (models.length > 0) {
      const selectedModel = savedModel && models.includes(savedModel) ? savedModel : models[0];
      const options = models
        .map(
          (m) => `<option value="${escapeHtml(m)}" ${m === selectedModel ? 'selected' : ''}>${escapeHtml(m)}</option>`
        )
        .join('');
      modelSelect.innerHTML = `<option value="">${t('onboarding.pickModel')}</option>${options}`;
      modelSelect.disabled = false;
      modelManual.style.display = 'none';
      modelSelect.value = selectedModel;
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // No models listed — fall back to manual input
      modelSelect.innerHTML = `<option value="">${t('onboarding.noModelsManual')}</option>`;
      modelSelect.disabled = true;
      modelManual.style.display = 'block';
      modelManual.value = savedModel;
    }
  });

  return {
    get baseUrl() {
      return currentBaseUrl;
    },
    get model() {
      if (modelManual.style.display === 'block') return modelManual.value.trim();
      return modelSelect.value.trim();
    },
    get apiKey() {
      return apiKeyInput.value.trim();
    },
    get maxTurns() {
      return parseInt((container.querySelector('#cfg-maxturns') as HTMLInputElement).value) || 30;
    },
  };
}

/** Read the current LLM config values from a container that contains the LLM section elements. */
export function readLLMConfigFrom(container: HTMLElement): LLMConfigResult | null {
  const providerSelect = container.querySelector('#cfg-provider') as HTMLSelectElement | null;
  const modelSelect = container.querySelector('#cfg-model') as HTMLSelectElement | null;
  const modelManual = container.querySelector('#cfg-model-manual') as HTMLInputElement | null;
  const apiKeyInput = container.querySelector('#cfg-apikey') as HTMLInputElement | null;
  const maxTurnsInput = container.querySelector('#cfg-maxturns') as HTMLInputElement | null;
  if (!providerSelect || !modelSelect || !apiKeyInput || !maxTurnsInput) return null;

  const preset = findPresetByKey(providerSelect.value);
  const model =
    modelManual && modelManual.style.display === 'block' ? modelManual.value.trim() : modelSelect.value.trim();

  return {
    baseUrl: preset?.baseUrl ?? '',
    model,
    apiKey: apiKeyInput.value.trim(),
    maxTurns: parseInt(maxTurnsInput.value) || 30,
  };
}

/** Run the connection test from a container and update the result UI. */
export async function testConnectionFrom(
  container: HTMLElement
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const resultEl = container.querySelector('#cfg-test-result') as HTMLElement | null;
  const cfg = readLLMConfigFrom(container);
  if (!cfg) return { ok: false, error: 'LLM section not found' };
  if (resultEl) {
    resultEl.textContent = t('common.loading');
    resultEl.className = 'test-result test-pending';
  }
  const res = await testConnection({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
  if (resultEl) {
    if (res.ok) {
      resultEl.textContent = `✅ ${t('settings.connectionSuccess')} (${res.models.length})`;
      resultEl.className = 'test-result test-success';
    } else {
      resultEl.textContent = `❌ ${t('settings.connectionError')}: ${res.error}`;
      resultEl.className = 'test-result test-error';
    }
  }
  return res;
}
