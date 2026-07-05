// ============================================================
// vibeAgentGo — Shared LLM Provider Presets
// Centralized presets used by SettingsModal and OnboardingWizard.
// Keep vendor-specific URLs and models out of component code.
// ============================================================

export interface ProviderPreset {
  key: string;
  label: string;
  model: string;
  baseUrl: string;
  apiKeyPlaceholder: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'openrouter',
    label: 'OpenRouter',
    model: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyPlaceholder: 'sk-or-...',
  },
  {
    key: 'opencode',
    label: 'OpenCode (go/zen)',
    model: '',
    baseUrl: 'https://opencode.go/zen',
    apiKeyPlaceholder: 'oc-...',
  },
  {
    key: 'ollama-cloud',
    label: 'Ollama Cloud',
    model: 'llama3.2',
    baseUrl: 'https://ollama.cloud/v1',
    apiKeyPlaceholder: 'ollama cloud key',
  },
];

export function findPresetByUrlAndModel(
  baseUrl: string,
  model: string
): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => {
    if (p.baseUrl !== baseUrl) return false;
    if (p.model === '') return true; // generic endpoint: any model matches
    return p.model === model;
  });
}

export function findPresetByKey(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.key === key);
}
