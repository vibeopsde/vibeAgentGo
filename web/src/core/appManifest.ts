// ============================================================
// vibeAgentGo — vAG-App Manifest Parser
// Apps are single HTML files with embedded metadata in a
// <script type="application/vnd.vag+json"> block.
// ============================================================

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  icon: string;
  permissions: string[];
  minVibeAgentGo?: string;
  license?: string;
}

const DEFAULT_MANIFEST: Partial<AppManifest> = {
  version: '1.0.0',
  author: 'vibeops',
  category: 'Utilities',
  description: '',
  icon: '📦',
  permissions: [],
  license: 'MIT',
};

const ALLOWED_CATEGORIES = ['Productivity', 'Utilities', 'Development', 'Creative', 'Games', 'System'];

export function parseAppManifest(html: string): { manifest: AppManifest; error?: string } {
  const match = html.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    return {
      manifest: undefined as unknown as AppManifest,
      error: 'No <script type="application/vnd.vag+json"> manifest block found.',
    };
  }

  let parsed: Partial<AppManifest>;
  try {
    parsed = JSON.parse(match[1].trim()) as Partial<AppManifest>;
  } catch (e) {
    return {
      manifest: undefined as unknown as AppManifest,
      error: `Invalid JSON manifest: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const manifest = { ...DEFAULT_MANIFEST, ...parsed } as AppManifest;

  if (!manifest.id || !manifest.name) {
    return { manifest: undefined as unknown as AppManifest, error: 'Manifest must include "id" and "name".' };
  }
  if (!ALLOWED_CATEGORIES.includes(manifest.category)) {
    return {
      manifest: undefined as unknown as AppManifest,
      error: `Invalid category "${manifest.category}". Allowed: ${ALLOWED_CATEGORIES.join(', ')}.`,
    };
  }

  return { manifest };
}

export function injectAppManifest(html: string, manifest: AppManifest): string {
  const json = JSON.stringify(manifest, null, 2);
  const block = `<script type="application/vnd.vag+json">\n${json}\n</script>`;
  const existing = html.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>[\s\S]*?<\/script>/i);
  if (existing) {
    return html.replace(existing[0], block);
  }
  // Insert before </head> if present, otherwise at the top of the document.
  if (html.includes('</head>')) {
    return html.replace('</head>', `${block}\n</head>`);
  }
  return block + '\n' + html;
}

export function normalizeCategory(category: string): string {
  return ALLOWED_CATEGORIES.includes(category) ? category : 'Utilities';
}

export function defaultAppPath(manifest: AppManifest): string {
  return `apps/${manifest.category}/${manifest.id}`;
}
