// ============================================================
// vibeAgentGo — Shared LLM Provider Presets
// Centralized presets used by SettingsModal and OnboardingWizard.
// Only fixed providers that work via CORS proxies — no custom URL editing.
// ============================================================

export interface ProviderPreset {
  key: string;
  label: string;
  model: string;
  baseUrl: string;
  apiKeyPlaceholder: string;
  /** Whether an API key is required (local endpoints don't need one). */
  apiKeyRequired: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'ki-vibeops',
    label: 'ki.vibeops.de (LM Studio)',
    model: 'qwen/qwen3.6-35b-a3b',
    baseUrl: 'https://ki.vibeops.de/v1',
    apiKeyPlaceholder: 'nicht nötig (lokal)',
    apiKeyRequired: false,
  },
  {
    key: 'kimi-code',
    label: 'Kimi Code',
    model: 'kimi-k2.7-code',
    baseUrl: 'https://vag.vibeops.de/api/kimi',
    apiKeyPlaceholder: 'sk-...',
    apiKeyRequired: true,
  },
  {
    key: 'ollama-cloud',
    label: 'Ollama Cloud',
    model: 'llama3.2',
    baseUrl: 'https://vag.vibeops.de/api/ollama/v1',
    apiKeyPlaceholder: 'ollama cloud key',
    apiKeyRequired: true,
  },
  {
    key: 'opencode-go',
    label: 'OpenCode Go/Zen',
    model: 'kimi-k2.7-code',
    baseUrl: 'https://vag.vibeops.de/api/opencode',
    apiKeyPlaceholder: 'oc-...',
    apiKeyRequired: true,
  },
];

export function findPresetByUrlAndModel(baseUrl: string, model: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => {
    if (p.baseUrl !== baseUrl) return false;
    if (p.model === '') return true;
    return p.model === model;
  });
}

export function findPresetByKey(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.key === key);
}