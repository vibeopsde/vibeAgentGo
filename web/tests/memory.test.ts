// ============================================================
// vibeAgentGo — Config/Memory tests
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, saveConfig, CONFIG_KEY } from '../src/core/memory.js';

describe('loadConfig', () => {
  beforeEach(() => {
    localStorage.removeItem(CONFIG_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(CONFIG_KEY);
  });

  it('normalizes missing language to a valid value', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      model: 'old-model',
      baseUrl: 'https://old.example.com',
      apiKey: 'old-key',
      maxTurns: 20,
      maxTokens: 2048,
      // language intentionally missing
    }));
    const config = loadConfig();
    expect(config.language).toMatch(/^(de|en)$/);
    expect(config.model).toBe('old-model');
  });

  it('preserves existing en language', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      language: 'en',
      apiKey: 'key',
    }));
    const config = loadConfig();
    expect(config.language).toBe('en');
  });

  it('normalizes invalid language to de', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      language: 'fr',
      apiKey: 'key',
    }));
    const config = loadConfig();
    expect(config.language).toBe('de');
  });
});

describe('saveConfig', () => {
  beforeEach(() => {
    localStorage.removeItem(CONFIG_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(CONFIG_KEY);
  });

  it('normalizes language on save', () => {
    const config = saveConfig({ language: 'fr' as any });
    expect(config.language).toBe('de');
  });
});