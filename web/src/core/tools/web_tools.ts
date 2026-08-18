// ============================================================
// vibeAgentGo — Web tools (search, YouTube transcripts)
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import { loadConfig } from '../memory.js';
import { asString, asBoolean } from './shared.js';

export const web_search: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information using a configured search provider. Returns titles, URLs, and short descriptions of search results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
  handler: async (args: Record<string, unknown>) => {
    const config = loadConfig();
    if (config.searchProvider !== 'tavily' || !config.searchApiKey) {
      return `Web search is not configured. Open Settings → Search Provider and add a Tavily API key.`;
    }
    const query = asString(args.query);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.searchApiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 8,
          include_answer: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        return `Tavily search error: HTTP ${res.status} ${text}`;
      }

      const data = (await res.json()) as Record<string, unknown>;
      const results: string[] = [];

      if (typeof data.answer === 'string') {
        results.push(`Answer: ${data.answer}`);
      }

      const rawResults = data.results;
      if (Array.isArray(rawResults)) {
        for (const r of rawResults.slice(0, 8)) {
          if (typeof r === 'object' && r !== null) {
            const title = asString(r.title);
            const url = asString(r.url);
            const content = asString(r.content).slice(0, 250);
            results.push(`- ${title}\n  ${url}\n  ${content}`);
          }
        }
      }

      return results.length > 0 ? results.join('\n\n') : `No results for "${query}"`;
    } catch (e: unknown) {
      return `Search error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// --- YouTube Transcript ---

export function extractVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // If the user passed an 11-character video ID directly, accept it.
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface TranscriptLine {
  text: string;
  start: number;
  duration?: number;
}

interface TranscriptResponse {
  video_id: string;
  title?: string;
  language?: string;
  transcript: TranscriptLine[];
}

function formatTranscript(data: TranscriptResponse, withTimestamps: boolean): string {
  const header = data.title ? `[${data.title}]\n\n` : '';
  if (withTimestamps) {
    return header + data.transcript.map((line) => `[${formatTimestamp(line.start)}] ${line.text}`).join('\n');
  }
  return header + data.transcript.map((line) => line.text).join(' ');
}

export const youtube_transcript: Tool = {
  name: 'youtube_transcript',
  description:
    'Fetch the transcript of a YouTube video. Accepts a full YouTube URL, a youtu.be short link, a YouTube Shorts/Embed/Live URL, or a raw 11-character video ID. Requires a YouTube transcript proxy to be configured in Settings.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'YouTube URL, short link, or raw video ID',
      },
      language: {
        type: 'string',
        description:
          'Preferred transcript language (e.g. "de", "en"). Defaults to the language configured in Settings.',
      },
      with_timestamps: {
        type: 'boolean',
        description: 'If true, include timestamps for each segment. Default: false.',
      },
    },
    required: ['url'],
  },
  handler: async (args: Record<string, unknown>) => {
    const config = loadConfig();
    const proxyUrl = 'https://vag.vibeops.de/api/youtube/';

    const videoId = extractVideoId(asString(args.url));
    if (!videoId) {
      return `Could not extract a valid YouTube video ID from "${asString(args.url)}". Please provide a standard youtube.com/watch?v=... link, a youtu.be/... short link, or the 11-character video ID.`;
    }

    const defaultLanguage = config.language || 'en';
    const requestedLanguage = asString(args.language, defaultLanguage);
    const withTimestamps = asBoolean(args.with_timestamps);

    const base = proxyUrl.endsWith('/') ? proxyUrl : `${proxyUrl}/`;
    const endpoint = `${base}transcript`;

    const params = new URLSearchParams({
      video_id: videoId,
      language: requestedLanguage,
      with_timestamps: String(withTimestamps),
    });

    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const text = await res.text().catch(() => `HTTP ${res.status}`);
      if (!res.ok) {
        return `YouTube transcript proxy error: HTTP ${res.status} ${text}`;
      }

      let data: TranscriptResponse;
      try {
        data = JSON.parse(text) as TranscriptResponse;
      } catch (e) {
        return `Invalid JSON from transcript proxy: ${text.slice(0, 200)}`;
      }

      if (!Array.isArray(data.transcript) || data.transcript.length === 0) {
        return `No transcript available for video ${videoId}${data.language ? ` (language: ${data.language})` : ''}. The video may have captions disabled or no captions in the requested language.`;
      }

      return formatTranscript(data, withTimestamps);
    } catch (e) {
      return `YouTube transcript fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};
