// ============================================================
// vibeAgentGo — MemoryPanel (client-side, IndexedDB)
// ============================================================

import { MemoryStore } from '../core/memory.js';
import { escapeHtml } from '../utils/escape.js';
import { t } from '../i18n/index.js';

export class MemoryPanel {
  element: HTMLElement;
  private overlay: HTMLElement;
  private modal: HTMLElement;
  private memory: MemoryStore;

  constructor() {
    this.element = document.createElement('div');
    this.element.style.display = 'contents';
    this.memory = new MemoryStore();

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    this.modal = document.createElement('div');
    this.modal.className = 'modal modal-wide';

    this.overlay.appendChild(this.modal);
    this.element.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  open() {
    this.loadMemory();
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }

  private async loadMemory() {
    try {
      const data = await this.memory.getAllMemory();

      const profileHtml = data.profile
        .map(
          (m: any) => `
        <div class="memory-item memory-user">
          <span class="memory-id">#${m.id}</span>
          <span class="memory-content">${escapeHtml(m.content)}</span>
          <button class="memory-delete" data-id="${m.id}">🗑</button>
        </div>
      `
        )
        .join('');

      const memoriesHtml = data.memories
        .map(
          (m: any) => `
        <div class="memory-item memory-general">
          <span class="memory-id">#${m.id}</span>
          <span class="memory-content">${escapeHtml(m.content)}</span>
          <button class="memory-delete" data-id="${m.id}">🗑</button>
        </div>
      `
        )
        .join('');

      this.modal.innerHTML = `
        <h2>🧠 ${t('memory.title')} <span class="mem-location-hint">(IndexedDB — ${t('memory.local')})</span></h2>
        <div class="memory-section">
          <h3>${t('memory.userProfile')} (${data.profile.length})</h3>
          <div class="memory-list">${profileHtml || `<p class="empty">${t('memory.empty')}</p>`}</div>
        </div>
        <div class="memory-section">
          <h3>${t('memory.memories')} (${data.memories.length})</h3>
          <div class="memory-list">${memoriesHtml || `<p class="empty">${t('memory.empty')}</p>`}</div>
        </div>
        <div class="form-actions">
          <button id="mem-close" class="btn btn-primary">${t('common.close')}</button>
        </div>
      `;

      this.modal.querySelector('#mem-close')!.addEventListener('click', () => this.close());

      this.modal.querySelectorAll('.memory-delete').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const id = parseInt((e.target as HTMLElement).dataset.id!);
          await this.memory.deleteMemory(id);
          this.loadMemory();
        });
      });
    } catch (e) {
      this.modal.innerHTML = `<p>${t('common.error')}: ${escapeHtml(String(e))}</p>`;
    }
  }
}
