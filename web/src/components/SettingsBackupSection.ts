// ============================================================
// vibeAgentGo — Settings UI: Backup & Restore Section
// ============================================================

import { t } from '../i18n/index.js';
import { BackupManager } from '../core/backup.js';
import { GitBackupManager, type GitCredentials } from '../core/gitBackup.js';
import { loadConfig, saveConfig } from '../core/memory.js';
import { VERSION } from '../version.js';
import { escapeHtml } from '../utils/escape.js';

export interface BackupHandlers {
  onMessage: (message: string, kind: 'success' | 'error') => void;
  onReload: () => void;
}

export function renderBackupSection(modal: HTMLElement, handlers: BackupHandlers): void {
  const config = loadConfig();
  const gitUrl = config.gitUrl ?? '';
  const gitUsername = config.gitUsername ?? '';
  const gitToken = config.gitToken ?? '';
  const gitCorsProxy = config.gitCorsProxy ?? '';
  const gitAutoBackup = config.gitAutoBackup ?? false;

  modal.insertAdjacentHTML(
    'beforeend',
    `
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

    <hr class="settings-divider" />
    <h3 class="settings-section-subtitle">🔗 ${t('settings.gitBackup')}</h3>
    <p class="settings-panel-hint">${t('settings.gitBackupHint')}</p>
    <div class="settings-form">
      <div class="form-group">
        <label for="cfg-git-url">${t('settings.gitUrl')}</label>
        <input type="text" id="cfg-git-url" value="${escapeHtml(gitUrl)}" placeholder="https://github.com/user/repo.git" />
      </div>
      <div class="form-group">
        <label for="cfg-git-username">${t('settings.gitUsername')}</label>
        <input type="text" id="cfg-git-username" value="${escapeHtml(gitUsername)}" placeholder="user" />
      </div>
      <div class="form-group">
        <label for="cfg-git-token">${t('settings.gitToken')}</label>
        <input type="password" id="cfg-git-token" value="${escapeHtml(gitToken)}" placeholder="ghp_..." />
      </div>
      <div class="form-group">
        <label for="cfg-git-cors-proxy">${t('settings.gitCorsProxy')}</label>
        <input type="text" id="cfg-git-cors-proxy" value="${escapeHtml(gitCorsProxy)}" placeholder="https://cors.isomorphic-git.example" />
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input id="cfg-git-auto" type="checkbox" ${gitAutoBackup ? 'checked' : ''} />
          ${t('settings.gitAutoBackup')}
        </label>
      </div>
    </div>
    <div class="form-actions">
      <button id="cfg-git-save" class="btn btn-secondary">${t('common.save')}</button>
      <button id="cfg-git-clone" class="btn btn-secondary">${t('settings.gitClone')}</button>
      <button id="cfg-git-pull" class="btn btn-secondary">${t('settings.gitPull')}</button>
      <button id="cfg-git-push" class="btn btn-primary">${t('settings.gitPush')}</button>
    </div>
  `
  );

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

  const gitSave = modal.querySelector('#cfg-git-save') as HTMLButtonElement;
  const gitClone = modal.querySelector('#cfg-git-clone') as HTMLButtonElement;
  const gitPull = modal.querySelector('#cfg-git-pull') as HTMLButtonElement;
  const gitPush = modal.querySelector('#cfg-git-push') as HTMLButtonElement;

  const getCreds = (): GitCredentials => ({
    url: (modal.querySelector('#cfg-git-url') as HTMLInputElement)?.value?.trim() ?? '',
    username: (modal.querySelector('#cfg-git-username') as HTMLInputElement)?.value?.trim() ?? '',
    token: (modal.querySelector('#cfg-git-token') as HTMLInputElement)?.value?.trim() ?? '',
    corsProxy: (modal.querySelector('#cfg-git-cors-proxy') as HTMLInputElement)?.value?.trim() ?? '',
  });

  const saveGitSettings = () => {
    const creds = getCreds();
    const autoBackup = (modal.querySelector('#cfg-git-auto') as HTMLInputElement)?.checked ?? false;
    saveConfig({
      gitUrl: creds.url,
      gitUsername: creds.username,
      gitToken: creds.token,
      gitCorsProxy: creds.corsProxy,
      gitAutoBackup: autoBackup,
    });
    handlers.onMessage(t('settings.gitSaved'), 'success');
  };

  gitSave?.addEventListener('click', saveGitSettings);

  const setBusy = (busy: boolean) => {
    [gitClone, gitPull, gitPush, gitSave].forEach((btn) => {
      if (btn) btn.disabled = busy;
    });
  };

  gitClone?.addEventListener('click', async () => {
    const creds = getCreds();
    if (!creds.url || !creds.token) {
      handlers.onMessage(t('settings.gitMissingCreds'), 'error');
      return;
    }
    saveGitSettings();
    setBusy(true);
    const manager = new GitBackupManager();
    try {
      await manager.clone(creds);
      handlers.onMessage(t('settings.gitCloneSuccess'), 'success');
    } catch (err) {
      handlers.onMessage(t('settings.gitCloneError') + ': ' + (err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  });

  gitPull?.addEventListener('click', async () => {
    const creds = getCreds();
    if (!creds.url || !creds.token) {
      handlers.onMessage(t('settings.gitMissingCreds'), 'error');
      return;
    }
    saveGitSettings();
    setBusy(true);
    const manager = new GitBackupManager();
    try {
      const { imported, deleted } = await manager.pull(creds);
      handlers.onMessage(
        t('settings.gitPullSuccess').replace('{{imported}}', String(imported)).replace('{{deleted}}', String(deleted)),
        'success'
      );
      setTimeout(() => handlers.onReload(), 800);
    } catch (err) {
      handlers.onMessage(t('settings.gitPullError') + ': ' + (err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  });

  gitPush?.addEventListener('click', async () => {
    const creds = getCreds();
    if (!creds.url || !creds.token) {
      handlers.onMessage(t('settings.gitMissingCreds'), 'error');
      return;
    }
    saveGitSettings();
    setBusy(true);
    const manager = new GitBackupManager();
    try {
      await manager.push(creds, `backup: ${new Date().toISOString()}`);
      handlers.onMessage(t('settings.gitPushSuccess'), 'success');
    } catch (err) {
      handlers.onMessage(t('settings.gitPushError') + ': ' + (err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  });
}
