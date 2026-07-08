// ============================================================
// vibeAgentGo — YouTube transcript tool tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { extractVideoId } from '../src/core/tools.js';
import { createDefaultTools } from '../src/core/tools.js';
import { loadConfig } from '../src/core/memory.js';

vi.mock('../src/core/memory.js', async () => {
  const actual = await vi.importActual('../src/core/memory.js');
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

const mockFetch = vi.fn();

function transcriptTool() {
  return createDefaultTools().find((t) => t.name === 'youtube_transcript')!;
}

function callHandler(args: Record<string, unknown>) {
  const ctx = {
    workspace: '',
    emit: vi.fn(),
    env: {},
  };
  return transcriptTool().handler(args, ctx);
}

describe('extractVideoId', () => {
  it('accepts a raw video ID', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from youtube.com/watch URLs', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=abc123_-xyz')).toBe('abc123_-xyz');
    expect(extractVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from youtu.be short links', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from Shorts, Embed and Live URLs', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for invalid URLs', () => {
    expect(extractVideoId('')).toBeNull();
    expect(extractVideoId('https://example.com')).toBeNull();
    expect(extractVideoId('not-an-id')).toBeNull();
  });
});

describe('youtube_transcript tool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns an error when no proxy is configured', async () => {
    (loadConfig as any).mockReturnValue({
      language: 'de',
      youtubeProxyUrl: '',
      youtubeLanguage: '',
    });

    const result = await callHandler({ url: 'https://youtu.be/dQw4w9WgXcQ' });

    expect(result).toContain('not configured');
    expect(result).toContain('Settings');
  });

  it('returns an error for an invalid URL', async () => {
    (loadConfig as any).mockReturnValue({
      language: 'de',
      youtubeProxyUrl: 'https://vag.vibeops.de/api/youtube/',
      youtubeLanguage: 'de',
    });

    const result = await callHandler({ url: 'https://example.com' });

    expect(result).toContain('Could not extract');
  });

  it('formats plain text without timestamps', async () => {
    (loadConfig as any).mockReturnValue({
      language: 'de',
      youtubeProxyUrl: 'https://vag.vibeops.de/api/youtube/',
      youtubeLanguage: 'de',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          video_id: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          language: 'en',
          transcript: [
            { text: 'Never gonna give you up', start: 0, duration: 2 },
            { text: 'never gonna let you down', start: 2, duration: 2 },
          ],
        }),
    });

    const result = await callHandler({ url: 'dQw4w9WgXcQ' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://vag.vibeops.de/api/youtube/transcript?video_id=dQw4w9WgXcQ&language=de&with_timestamps=false',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toContain('Never gonna give you up');
    expect(result).toContain('never gonna let you down');
    expect(result).not.toContain('[0:00]');
  });

  it('formats timestamps when requested', async () => {
    (loadConfig as any).mockReturnValue({
      language: 'de',
      youtubeProxyUrl: 'https://vag.vibeops.de/api/youtube/',
      youtubeLanguage: 'de',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          video_id: 'abc',
          language: 'de',
          transcript: [{ text: 'Hallo', start: 5, duration: 1 }],
        }),
    });

    const result = await callHandler({ url: 'dQw4w9WgXcQ', with_timestamps: true });

    expect(result).toContain('[00:05]');
    expect(result).toContain('Hallo');
  });

  it('reports HTTP errors from the proxy', async () => {
    (loadConfig as any).mockReturnValue({
      language: 'de',
      youtubeProxyUrl: 'https://vag.vibeops.de/api/youtube/',
      youtubeLanguage: 'de',
    });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Video not found',
    });

    const result = await callHandler({ url: 'dQw4w9WgXcQ' });

    expect(result).toContain('404');
  });

  it('reports an empty transcript', async () => {
    (loadConfig as any).mockReturnValue({
      language: 'de',
      youtubeProxyUrl: 'https://vag.vibeops.de/api/youtube/',
      youtubeLanguage: 'de',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          video_id: 'dQw4w9WgXcQ',
          language: 'de',
          transcript: [],
        }),
    });

    const result = await callHandler({ url: 'dQw4w9WgXcQ' });

    expect(result).toContain('No transcript available');
  });
});
