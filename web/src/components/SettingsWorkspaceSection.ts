// ============================================================
// vibeAgentGo — Settings UI: Workspace Management Section
// ============================================================

import { t } from '../i18n/index.js';
import {
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  switchWorkspace,
  getActiveWorkspaceId,
  type Workspace,
} from '../core/workspace.js';
import { resetDBConnection } from '../core/db.js';

export function renderWorkspaceSection(modal: HTMLElement, onSwitch: () => void): void {
  modal.insertAdjacentHTML(
    'beforeend',
    `
    <h3 class="settings-panel-title">🗂️ ${t('workspace.title')}</h3>
    <p class="settings-panel-hint">${t('workspace.hint')}</p>
    <div class="settings-form">
      <div class="form-group">
        <label for="ws-new-name">${t('workspace.newName')}</label>
        <div class="ws-input-row">
          <input type="text" id="ws-new-name" placeholder="${t('workspace.newNamePlaceholder')}" />
          <button id="ws-create" class="btn btn-primary">${t('workspace.create')}</button>
        </div>
      </div>
    </div>
    <div class="ws-list" id="ws-list"></div>
  `
  );

  const listEl = modal.querySelector('#ws-list') as HTMLElement;

  const renderList = () => {
    const all = listWorkspaces();
    const currentActive = getActiveWorkspaceId();
    listEl.innerHTML = all.map((ws) => renderWorkspaceItem(ws, ws.id === currentActive)).join('');
    attachItemHandlers();
  };

  const renderWorkspaceItem = (ws: Workspace, isActive: boolean): string => {
    const activeBadge = isActive ? `<span class="ws-badge-active">${t('workspace.active')}</span>` : '';
    const switchBtn = !isActive
      ? `<button class="btn btn-secondary btn-sm ws-switch" data-id="${ws.id}">${t('workspace.switch')}</button>`
      : '';
    const isLast = all_count() <= 1;
    const deleteBtn = !isLast
      ? `<button class="btn btn-danger btn-sm ws-delete" data-id="${ws.id}">${t('common.delete')}</button>`
      : '';

    return `
      <div class="ws-item ${isActive ? 'ws-item-active' : ''}" data-id="${ws.id}">
        <div class="ws-item-info">
          <span class="ws-item-name" data-id="${ws.id}">${escapeText(ws.name)}</span>
          ${activeBadge}
        </div>
        <div class="ws-item-actions">
          <button class="btn btn-secondary btn-sm ws-rename" data-id="${ws.id}">${t('common.rename')}</button>
          ${switchBtn}
          ${deleteBtn}
        </div>
      </div>
    `;
  };

  function all_count(): number {
    return listWorkspaces().length;
  }

  function attachItemHandlers() {
    listEl.querySelectorAll('.ws-switch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        if (switchWorkspace(id)) {
          onSwitch();
        }
      });
    });

    listEl.querySelectorAll('.ws-rename').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ws = listWorkspaces().find((w) => w.id === id);
        if (!ws) return;
        const newName = prompt(t('workspace.renamePrompt'), ws.name);
        if (newName && newName.trim()) {
          renameWorkspace(id, newName.trim());
          renderList();
        }
      });
    });

    listEl.querySelectorAll('.ws-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ws = listWorkspaces().find((w) => w.id === id);
        if (!ws) return;
        if (!confirm(t('workspace.deleteConfirm').replace('{name}', ws.name))) return;
        await resetDBConnection();
        const deleted = await deleteWorkspace(id);
        if (deleted) {
          onSwitch();
        } else {
          alert(t('workspace.cannotDeleteLast'));
        }
      });
    });
  }

  // Create new workspace
  const createBtn = modal.querySelector('#ws-create') as HTMLButtonElement;
  const nameInput = modal.querySelector('#ws-new-name') as HTMLInputElement;

  const doCreate = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    createWorkspace(name);
    nameInput.value = '';
    renderList();
  };

  createBtn?.addEventListener('click', doCreate);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doCreate();
  });

  renderList();
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
