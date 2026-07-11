// ============================================================
// vibeAgentGo — SkillsPanel (client-side, IndexedDB)
// Project-style skills: Markdown + YAML frontmatter, trigger words.
// ============================================================

import { SkillStore, type SkillRecord } from '../core/memory.js';
import { parseSkill, skillToMarkdown } from '../core/skill_parser.js';
import { escapeHtml } from '../utils/escape.js';
import { t } from '../i18n/index.js';
import { randomUUID } from '../core/uuid.js';

const DEFAULT_SKILL_BODY = `When this skill is active, behave according to the instructions below.

## Context
Add project-specific facts, rules, tone, or shortcuts here.

## Examples
- User: ...
- You: ...
`;

export class SkillsPanel {
  element: HTMLElement;
  private skillStore: SkillStore;
  private editingId: string | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'panel-app skills-panel';
    this.skillStore = new SkillStore();
  }

  open() {
    this.renderList();
  }

  private async renderList() {
    this.editingId = null;
    const skills = await this.skillStore.listSkills();

    const rows = skills
      .map(
        (s) => `
      <div class="skill-row" data-id="${escapeHtml(s.id ?? '')}">
      <div class="skill-info">
        <div class="skill-name">${escapeHtml(s.name)}</div>
        <div class="skill-description">${escapeHtml(s.description) || '<em>no description</em>'}</div>
        <div class="skill-triggers">${(s.trigger || []).map((tr: string) => `<span class="skill-tag">${escapeHtml(tr)}</span>`).join('') || '<span class="skill-tag skill-tag-inactive">manual</span>'}</div>
      </div>
      <div class="skill-actions">
        <button class="btn btn-secondary skill-edit" data-id="${escapeHtml(s.id ?? '')}">${t('common.edit')}</button>
        <button class="btn btn-danger skill-delete" data-id="${escapeHtml(s.id ?? '')}">${t('common.delete')}</button>
      </div>
      </div>
      `
      )
      .join('');

    this.element.innerHTML = `
      <h2>🛠️ ${t('skills.title')}</h2>
      <p class="field-hint">${t('skills.hint')}</p>
      <div class="skills-list">${rows || `<p class="empty">${t('skills.empty')}</p>`}</div>
      <div class="form-actions">
        <button id="skills-new" class="btn btn-primary">${t('skills.new')}</button>
      </div>
    `;

    this.element.querySelector('#skills-new')?.addEventListener('click', () => this.renderEditor());
    this.element.querySelectorAll('.skill-edit').forEach((btn) => {
      btn.addEventListener('click', () => this.renderEditor((btn as HTMLElement).dataset.id || ''));
    });
    this.element.querySelectorAll('.skill-delete').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteSkill((btn as HTMLElement).dataset.id || ''));
    });
  }

  private async renderEditor(id?: string) {
    let record: SkillRecord | null = null;
    if (id) {
      record = await this.skillStore.getSkill(id);
      this.editingId = id;
    } else {
      this.editingId = null;
    }

    const name = record?.name || 'New Skill';
    const description = record?.description || '';
    const trigger = (record?.trigger || []).join(', ');
    const body = record?.content || DEFAULT_SKILL_BODY;

    this.element.innerHTML = `
      <h2>${id ? t('skills.edit') : t('skills.new')}</h2>
      <div class="form-group">
        <label for="skill-name">${t('skills.name')}</label>
        <input id="skill-name" type="text" value="${escapeHtml(name)}" />
      </div>
      <div class="form-group">
        <label for="skill-description">${t('skills.description')}</label>
        <input id="skill-description" type="text" value="${escapeHtml(description)}" />
      </div>
      <div class="form-group">
        <label for="skill-triggers">${t('skills.triggers')}</label>
        <input id="skill-triggers" type="text" value="${escapeHtml(trigger)}" placeholder="vibeAgentGo, VCR, devops" />
        <p class="field-hint">${t('skills.triggersHint')}</p>
      </div>
      <div class="form-group">
        <label for="skill-body">${t('skills.body')}</label>
        <textarea id="skill-body" class="skill-editor" rows="14">${escapeHtml(body)}</textarea>
      </div>
      <div class="form-actions">
        <button id="skill-save" class="btn btn-primary">${t('common.save')}</button>
        <button id="skill-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
      </div>
    `;

    this.element.querySelector('#skill-cancel')?.addEventListener('click', () => this.renderList());
    this.element.querySelector('#skill-save')?.addEventListener('click', () => this.saveFromEditor());
  }

  private async saveFromEditor() {
    const nameInput = this.element.querySelector('#skill-name') as HTMLInputElement;
    const descInput = this.element.querySelector('#skill-description') as HTMLInputElement;
    const triggersInput = this.element.querySelector('#skill-triggers') as HTMLInputElement;
    const bodyInput = this.element.querySelector('#skill-body') as HTMLTextAreaElement;

    const name = nameInput.value.trim() || 'Unnamed Skill';
    const description = descInput.value.trim();
    const trigger = triggersInput.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = bodyInput.value.trim();

    const id = this.editingId || randomUUID().slice(0, 8);
    await this.skillStore.saveSkill({ id, name, description, content: body, trigger });
    this.renderList();
  }

  private async deleteSkill(id: string) {
    if (confirm(t('skills.deleteConfirm'))) {
      await this.skillStore.deleteSkill(id);
      this.renderList();
    }
  }
}
