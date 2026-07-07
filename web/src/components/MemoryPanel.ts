// ============================================================
// vibeAgentGo — MemoryPanel (client-side, IndexedDB)
// ============================================================

import { MemoryStore } from '../core/memory.js';
import { escapeHtml } from '../utils/escape.js';
import { t } from '../i18n/index.js';

export class MemoryPanel {
  element: HTMLElement;
  private memory: MemoryStore;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'panel-app memory-panel';
    this.memory = new MemoryStore();
  }

  open() {
    this.loadMemory();
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

      this.element.innerHTML = `
        <h2>🧠 ${t('memory.title')} <span class="mem-location-hint">(IndexedDB — ${t('memory.local')})</span></h2>
        <div class="memory-section">
          <h3>${t('memory.userProfile')} (${data.profile.length})</h3>
          <div class="memory-list">${profileHtml || `<p class="empty">${t('memory.empty')}</p>`}</div>
        </div>
        <div class="memory-section">
          <h3>${t('memory.memories')} (${data.memories.length})</h3>
          <div class="memory-list">${memoriesHtml || `<p class="empty">${t('memory.empty')}</p>`}</div>
        </div>
      `;

      this.element.querySelectorAll('.memory-delete').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const id = parseInt((e.target as HTMLElement).dataset.id!);
          await this.memory.deleteMemory(id);
          this.loadMemory();
        });
      });
    } catch (e) {
      this.element.innerHTML = `<p>${t('common.error')}: ${escapeHtml(String(e))}</p>`;
    }
  }
}
