// ============================================================
// vibeAgentGo — Settings UI: Danger Zone Section (data reset)
// ============================================================

import { t } from '../i18n/index.js';
import { resetLocalData } from '../core/memory.js';

export function renderDangerZoneSection(modal: HTMLElement, onReload: () => void): void {
  modal.insertAdjacentHTML(
    'beforeend',
    `
    <h3>⚠️ ${t('settings.dangerZone')}</h3>
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
  `
  );

  const resetBtn = modal.querySelector('#cfg-reset') as HTMLButtonElement;
  const resetConfirm = modal.querySelector('#cfg-reset-confirm') as HTMLElement;
  const resetCancel = modal.querySelector('#cfg-reset-cancel') as HTMLButtonElement;
  const resetConfirmBtn = modal.querySelector('#cfg-reset-confirm-btn') as HTMLButtonElement;

  resetBtn.addEventListener('click', () => {
    resetConfirm.style.display = 'block';
    resetBtn.style.display = 'none';
  });

  resetCancel.addEventListener('click', () => {
    resetConfirm.style.display = 'none';
    resetBtn.style.display = 'block';
  });

  resetConfirmBtn.addEventListener('click', async () => {
    await resetLocalData();
    onReload();
  });
}
