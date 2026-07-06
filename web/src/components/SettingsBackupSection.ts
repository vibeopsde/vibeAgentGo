// ============================================================
// vibeAgentGo — Settings UI: Backup & Restore Section
// ============================================================

import { t } from '../i18n/index.js';
import { BackupManager } from '../core/backup.js';
import { VERSION } from '../version.js';

export interface BackupHandlers {
  onMessage: (message: string, kind: 'success' | 'error') => void;
  onReload: () => void;
}

export function renderBackupSection(modal: HTMLElement, handlers: BackupHandlers): void {
  modal.innerHTML += `
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
  `;

  const exportBtn = modal.querySelector('#cfg-export') as HTMLButtonElement;
  const importBtn = modal.querySelector('#cfg-import') as HTMLButtonElement;
  const importFile = modal.querySelector('#cfg-import-file') as HTMLInputElement;
  const includeKeys = modal.querySelector('#cfg-backup-include-keys') as HTMLInputElement;

  exportBtn?.addEventListener('click', async () => {
    const manager = new BackupManager(VERSION);
    try {
      const blob = await manager.exportZip(includeKeys?.checked ?? false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vibeAgentGo-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      handlers.onMessage(t('settings.exportSuccess'), 'success');
    } catch (err) {
      handlers.onMessage(t('settings.exportError') + ': ' + (err as Error).message, 'error');
    }
  });

  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm(t('settings.importConfirm'))) return;

    const manager = new BackupManager(VERSION);
    try {
      await manager.importZip(file);
      handlers.onMessage(t('settings.importSuccess'), 'success');
      setTimeout(() => handlers.onReload(), 800);
    } catch (err) {
      handlers.onMessage(t('settings.importError') + ': ' + (err as Error).message, 'error');
    }
  });
}
