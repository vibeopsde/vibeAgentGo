// ============================================================
// vibeAgentGo — Settings UI: YouTube Transcript Config Section
// ============================================================

import { t } from '../i18n/index.js';
import { escapeHtml } from '../utils/escape.js';
import type { ClientConfig } from '../core/memory.js';

export interface YouTubeConfigResult {
  youtubeLanguage: string;
}

export function renderYouTubeConfigSection(modal: HTMLElement, config: ClientConfig): YouTubeConfigResult {
  modal.insertAdjacentHTML(
    'beforeend',
    `
    <h3>▶️ ${t('settings.youtube')}</h3>
    <div class="form-group">
      <label for="cfg-youtube-language">${t('settings.youtubeLanguage')}</label>
      <input id="cfg-youtube-language" type="text" value="${escapeHtml(config.youtubeLanguage || '')}" placeholder="de,en" />
      <p class="field-hint">${t('settings.youtubeLanguageHint')}</p>
    </div>
  `
  );

  return {
    get youtubeLanguage() {
      return (modal.querySelector('#cfg-youtube-language') as HTMLInputElement).value.trim();
    },
  };
}

/** Read the current YouTube config values from a container that contains the YouTube section elements. */
export function readYouTubeConfigFrom(container: HTMLElement): YouTubeConfigResult | null {
  const languageInput = container.querySelector('#cfg-youtube-language') as HTMLInputElement | null;
  if (!languageInput) return null;
  return {
    youtubeLanguage: languageInput.value.trim(),
  };
}
