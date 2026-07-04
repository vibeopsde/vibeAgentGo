// ============================================================
// HAG — MemoryPanel Component
// ============================================================

export class MemoryPanel {
  element: HTMLElement;
  private overlay: HTMLElement;
  private modal: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.style.display = 'contents';

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
      const res = await fetch('./api/memory');
      const data = await res.json();

      const profileHtml = data.profile.map((m: any) => `
        <div class="memory-item memory-user">
          <span class="memory-id">#${m.id}</span>
          <span class="memory-content">${this.escape(m.content)}</span>
          <button class="memory-delete" data-id="${m.id}">🗑</button>
        </div>
      `).join('');

      const memoriesHtml = data.memories.map((m: any) => `
        <div class="memory-item memory-general">
          <span class="memory-id">#${m.id}</span>
          <span class="memory-content">${this.escape(m.content)}</span>
          <button class="memory-delete" data-id="${m.id}">🗑</button>
        </div>
      `).join('');

      this.modal.innerHTML = `
        <h2>🧠 Memory</h2>
        <div class="memory-section">
          <h3>User Profile (${data.profile.length})</h3>
          <div class="memory-list">${profileHtml || '<p class="empty">Keine Profileinträge</p>'}</div>
        </div>
        <div class="memory-section">
          <h3>Memories (${data.memories.length})</h3>
          <div class="memory-list">${memoriesHtml || '<p class="empty">Keine Memories</p>'}</div>
        </div>
        <div class="form-actions">
          <button id="mem-close" class="btn btn-primary">Schließen</button>
        </div>
      `;

      this.modal.querySelector('#mem-close')!.addEventListener('click', () => this.close());

      // Wire delete buttons
      this.modal.querySelectorAll('.memory-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = (e.target as HTMLElement).dataset.id;
          await fetch(`./api/memory/${id}`, { method: 'DELETE' });
          this.loadMemory();
        });
      });
    } catch (e) {
      this.modal.innerHTML = `<p>Fehler: ${e}</p>`;
    }
  }

  private escape(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}