import { describe, it, expect } from 'vitest';
import { parseSkill, skillToMarkdown, skillTriggers, filterSkillsByTrigger } from '../src/core/skill_parser';
import type { Skill } from '../src/types';

describe('parseSkill', () => {
  it('parses YAML frontmatter with bracket triggers', () => {
    const markdown = `---
name: VibeAgentGo
description: Client-side PWA agent
triggers: ["vibeAgentGo", "VCR"]
---

When the user talks about vibeAgentGo, be concise.`;

    const skill = parseSkill(markdown);
    expect(skill.name).toBe('VibeAgentGo');
    expect(skill.description).toBe('Client-side PWA agent');
    expect(skill.trigger).toEqual(['vibeAgentGo', 'VCR']);
    expect(skill.content).toContain('When the user talks');
  });

  it('parses dash-list triggers', () => {
    const markdown = `---
name: DevOps
triggers:
  - docker
  - caddy
  - nginx
---

Focus on infrastructure and reverse proxy setup.`;

    const skill = parseSkill(markdown);
    expect(skill.trigger).toEqual(['docker', 'caddy', 'nginx']);
  });

  it('falls back to heuristics for plain markdown', () => {
    const skill = parseSkill('Just some plain body without frontmatter.');
    expect(skill.name).toBe('Unnamed Skill');
    expect(skill.content).toBe('Just some plain body without frontmatter.');
    expect(skill.trigger).toEqual([]);
  });

  it('parses comma-separated triggers without brackets', () => {
    const markdown = `---
name: SEO
triggers: keyword, seo, meta
---

Optimize for search engines.`;

    const skill = parseSkill(markdown);
    expect(skill.trigger).toEqual(['keyword', 'seo', 'meta']);
  });
});

describe('skillTriggers', () => {
  it('matches trigger word case-insensitively', () => {
    const skill: Skill = {
      name: 'Test',
      description: '',
      content: '',
      trigger: ['vibeAgentGo'],
    };
    expect(skillTriggers(skill, 'Was ist mit VibeAgentGo?')).toBe(true);
  });

  it('does not match when no triggers defined', () => {
    const skill: Skill = { name: 'Empty', description: '', content: '' };
    expect(skillTriggers(skill, 'anything')).toBe(false);
  });

  it('matches one of several triggers', () => {
    const skill: Skill = {
      name: 'Multi',
      description: '',
      content: '',
      trigger: ['a', 'b', 'c'],
    };
    expect(skillTriggers(skill, 'this is b here')).toBe(true);
    expect(skillTriggers(skill, 'nothing here')).toBe(false);
  });
});

describe('filterSkillsByTrigger', () => {
  it('returns matching skills and always-on skills', () => {
    const skills: Skill[] = [
      { name: 'VibeAgentGo', description: '', content: '', trigger: ['vibeAgentGo'] },
      { name: 'Docker', description: '', content: '', trigger: ['docker'] },
      { name: 'Always', description: '', content: '', trigger: [] },
    ];
    const result = filterSkillsByTrigger(skills, 'VibeAgentGo rocks', true);
    expect(result.map(s => s.name)).toEqual(['VibeAgentGo', 'Always']);
  });

  it('does not include always-on skills when disabled', () => {
    const skills: Skill[] = [
      { name: 'VibeAgentGo', description: '', content: '', trigger: ['vibeAgentGo'] },
      { name: 'Always', description: '', content: '', trigger: [] },
    ];
    const result = filterSkillsByTrigger(skills, 'hello', false);
    expect(result.map(s => s.name)).toEqual([]);
  });
});

describe('skillToMarkdown', () => {
  it('round-trips skill to markdown', () => {
    const skill = parseSkill(`---
name: VibeAgentGo
description: PWA agent
triggers: ["vibeAgentGo"]
---

Body here.`);
    const md = skillToMarkdown(skill);
    expect(md).toContain('name: VibeAgentGo');
    expect(md).toContain('triggers: ["vibeAgentGo"]');
    expect(md).toContain('Body here.');
  });
});
