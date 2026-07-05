// ============================================================
// vibeAgentGo — SessionPanel (client-side, IndexedDB)
// ============================================================

import { MemoryStore } from '../core/memory.js';
import { escapeHtml } from '../utils/escape.js';

export class SessionPanel {
  element: HTMLElement;
  private overlay: HTMLElement;
  private modal: HTMLElement;
  private memory: MemoryStore;
  onResume: ((sessionId: string) => void) | null = null;

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
    this.loadSessions();
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }

  private async loadSessions() {
    try {
      const sessions = await this.memory.listSessions();

      if (sessions.length === 0) {
        this.modal.innerHTML = `
          <h2>💬 Sessions <span class="mem-location-hint">(IndexedDB — lokal im Browser)</span></h2>
          <p class="empty">Keine gespeicherten Sessions. Starte eine Konversation!</p>
          <div class="form-actions">
            <button id="sess-close" class="btn btn-primary">Schließen</button>
          </div>
        `;
        this.modal.querySelector('#sess-close')!.addEventListener('click', () => this.close());
        return;
      }

      const sessionsHtml = sessions.map((s: any) => {
        const date = new Date(s.updated_at).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
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
      }).join('');

      this.modal.innerHTML = `
        <h2>💬 Sessions (${sessions.length}) <span class="mem-location-hint">(IndexedDB — lokal im Browser)</span></h2>
        <div class="session-list">${sessionsHtml}</div>
        <div class="form-actions">
          <button id="sess-close" class="btn btn-primary">Schließen</button>
        </div>
      `;

      this.modal.querySelector('#sess-close')!.addEventListener('click', () => this.close());

      this.modal.querySelectorAll('.session-resume').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = (e.target as HTMLElement).dataset.id!;
          this.close();
          if (this.onResume) this.onResume(id);
        });
      });

      this.modal.querySelectorAll('.session-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = (e.target as HTMLElement).dataset.id!;
          await this.memory.deleteSession(id);
          this.loadSessions();
        });
      });

      this.modal.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = (item as HTMLElement).dataset.id!;
          this.close();
          if (this.onResume) this.onResume(id);
        });
      });

    } catch (e) {
      this.modal.innerHTML = `<p>Fehler beim Laden: ${e}</p>`;
    }
  }
}
