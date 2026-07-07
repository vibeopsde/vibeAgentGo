// ============================================================
// vibeAgentGo — SessionPanel (client-side, IndexedDB)
// ============================================================

import { MemoryStore } from '../core/memory.js';
import { escapeHtml } from '../utils/escape.js';
import { t } from '../i18n/index.js';

export class SessionPanel {
  element: HTMLElement;
  private memory: MemoryStore;
  onResume: ((sessionId: string) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'panel-app session-panel';
    this.memory = new MemoryStore();
  }

  open() {
    this.loadSessions();
  }

  private async loadSessions() {
    try {
      const sessions = await this.memory.listSessions();

      if (sessions.length === 0) {
        this.element.innerHTML = `
          <h2>💬 ${t('sessions.title')} <span class="mem-location-hint">(IndexedDB — ${t('memory.local')})</span></h2>
          <p class="empty">${t('sessions.empty')}</p>
        `;
        return;
      }

      const sessionsHtml = sessions
        .map((s: any) => {
          const lang = document.documentElement.lang || 'de';
          const date = new Date(s.updated_at).toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          return `
          <div class="session-item" data-id="${s.id}">
            <div class="session-info">
              <div class="session-title">${escapeHtml(s.title)}</div>
              <div class="session-date">${date}</div>
            </div>
            <div class="session-actions">
              <button class="session-resume" data-id="${s.id}">▶</button>
              <button class="session-delete" data-id="${s.id}">🗑</button>
            </div>
          </div>
        `;
        })
        .join('');

      this.element.innerHTML = `
        <h2>💬 ${t('sessions.title')} (${sessions.length}) <span class="mem-location-hint">(IndexedDB — ${t('memory.local')})</span></h2>
        <div class="session-list">${sessionsHtml}</div>
      `;

      this.element.querySelectorAll('.session-resume').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = (e.target as HTMLElement).dataset.id!;
          if (this.onResume) this.onResume(id);
        });
      });

      this.element.querySelectorAll('.session-delete').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = (e.target as HTMLElement).dataset.id!;
          await this.memory.deleteSession(id);
          this.loadSessions();
        });
      });

      this.element.querySelectorAll('.session-item').forEach((item) => {
        item.addEventListener('click', () => {
          const id = (item as HTMLElement).dataset.id!;
          if (this.onResume) this.onResume(id);
        });
      });
    } catch (e) {
      this.element.innerHTML = `<p>${t('common.error')}: ${escapeHtml(String(e))}</p>`;
    }
  }
}
