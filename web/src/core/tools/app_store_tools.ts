// ============================================================
// vibeAgentGo — vAG-App Store tools
// Split from tools.ts (v2608.1.0); keep tool result caps unchanged.
// ============================================================

import type { Tool } from '../../types/index.js';
import { corsFetch } from '../cors_fetch.js';
import { parseAppManifest, injectAppManifest } from '../appManifest.js';
import {
  getMemoryStore,
  asString,
  asBoolean,
  asNumber,
  ALLOWED_APP_CATEGORIES,
  isValidAppId,
  isValidAppCategory,
  isValidRepoRoot,
  isSafeRelPath,
} from './shared.js';

// --- vAG-App Store Tools ---

const APP_STORE_INDEX_URL = 'https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/index.json';

interface StoreAppEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  icon: string;
  path: string;
  minVibeAgentGo: string | null;
  license: string | null;
  permissions: string[];
}

interface StoreIndex {
  generatedAt: string;
  count: number;
  apps: StoreAppEntry[];
}

async function fetchStoreIndex(): Promise<StoreIndex | { error: string }> {
  try {
    const res = await corsFetch(APP_STORE_INDEX_URL);
    if (!res.ok) {
      return { error: `App Store index returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as StoreIndex;
    return data;
  } catch (e) {
    return { error: `Failed to load App Store index: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const app_store_search: Tool = {
  name: 'app_store_search',
  description:
    'Search the vAG-App Store for installable mini-apps. Each app is a single index.html with embedded metadata. Returns id, name, version, author, category, description, and permissions.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional search term for name, description, or id.',
      },
      category: {
        type: 'string',
        description:
          'Optional category filter. Allowed: Productivity, Utilities, Development, Creative, Games, System.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return. Default: 20.',
      },
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const index = await fetchStoreIndex();
    if ('error' in index) return index.error;

    const query = asString(args.query).toLowerCase().trim();
    const category = asString(args.category).trim();
    const limit = Math.max(1, Math.min(100, asNumber(args.limit, 20)));

    if (category && !isValidAppCategory(category)) {
      return `Invalid category "${category}". Allowed: ${ALLOWED_APP_CATEGORIES.join(', ')}.`;
    }

    let apps = index.apps;
    if (category) {
      apps = apps.filter((a) => a.category === category);
    }
    if (query) {
      apps = apps.filter(
        (a) =>
          a.id.toLowerCase().includes(query) ||
          a.name.toLowerCase().includes(query) ||
          a.description.toLowerCase().includes(query) ||
          a.author.toLowerCase().includes(query)
      );
    }
    apps = apps.slice(0, limit);

    if (apps.length === 0) {
      return 'No matching apps found in the vAG-App Store.';
    }

    return apps
      .map(
        (a) =>
          `- ${a.name} (${a.id})\n  Category: ${a.category} | v${a.version} | by ${a.author}\n  ${a.description}\n  Permissions: ${a.permissions.length ? a.permissions.join(', ') : 'none'}`
      )
      .join('\n\n');
  },
};

export const app_store_install: Tool = {
  name: 'app_store_install',
  description:
    'Install an app from the vAG-App Store into the local workspace as a single HTML file under apps/<Category>/<id>/index.html. The app becomes visible in the Explorer and can be launched from there or via the App Store.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The unique app id from the vAG-App Store (e.g. "vibeops.example.calculator").',
      },
    },
    required: ['id'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const id = asString(args.id).trim();
    if (!id) return 'Error: id is required.';

    const index = await fetchStoreIndex();
    if ('error' in index) return index.error;

    const app = index.apps.find((a) => a.id === id);
    if (!app) return `App "${id}" not found in the vAG-App Store.`;

    const basePath = `apps/${app.category}/${app.id}`;
    const targetPath = `${basePath}/index.html`;
    if (!isValidAppCategory(app.category)) {
      return `Install refused: invalid app category "${app.category}". Allowed: ${ALLOWED_APP_CATEGORIES.join(', ')}.`;
    }
    if (!isValidAppId(app.id)) {
      return `Install refused: invalid app id "${app.id}" (must be lowercase alphanumeric with . or - separators).`;
    }
    if (!isSafeRelPath(targetPath)) {
      return `Install refused: unsafe target path "${targetPath}".`;
    }

    const entryUrl = `https://raw.githubusercontent.com/vibeopsde/vAG-Apps/main/apps/${app.path}/index.html`;

    try {
      const res = await corsFetch(entryUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entryContent = await res.text();
      await mem.writeFile(targetPath, entryContent);
      return `Installed ${app.name} (${app.id}) into workspace at ${targetPath}.`;
    } catch (e) {
      return `Install failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

export const app_store_publish: Tool = {
  name: 'app_store_publish',
  description:
    'Prepare a local workspace app for publishing to the vAG-App Store. The app must be a single HTML file at source_path (e.g. "apps/Productivity/myapp/index.html") with a <script type="application/vnd.vag+json"> manifest block. The file is copied into a vAG-Apps-compatible repository structure under target_repo_root (default: "vAG-Apps"). If no manifest block exists, a minimal one is generated from the provided id, name, category, and description.',
  parameters: {
    type: 'object',
    properties: {
      source_path: {
        type: 'string',
        description: 'Workspace path to the app file (e.g. "apps/Productivity/myapp/index.html") or app folder.',
      },
      target_repo_root: {
        type: 'string',
        description: 'Workspace path to the vAG-Apps repository root. Default: "vAG-Apps".',
      },
      id: {
        type: 'string',
        description: 'App id. Used only when creating a new manifest.',
      },
      name: {
        type: 'string',
        description: 'App display name. Used only when creating a new manifest.',
      },
      category: {
        type: 'string',
        description:
          'App category. Used only when creating a new manifest. Allowed: Productivity, Utilities, Development, Creative, Games, System.',
      },
      description: {
        type: 'string',
        description: 'Short description. Used only when creating a new manifest.',
      },
      author: {
        type: 'string',
        description: 'App author. Used only when creating a new manifest. Default: "vibeops"',
      },
      icon: {
        type: 'string',
        description: 'Emoji icon (e.g. "🌤️"). Used only when creating a new manifest. Default: "📦"',
      },
    },
    required: ['source_path'],
  },
  handler: async (args: Record<string, unknown>, ctx) => {
    const mem = getMemoryStore(ctx);
    const sourcePath = asString(args.source_path).replace(/\/$/, '');
    const targetRepoRoot = asString(args.target_repo_root, 'vAG-Apps').replace(/\/$/, '');

    if (!sourcePath) return 'Error: source_path is required.';
    if (!isValidRepoRoot(targetRepoRoot)) {
      return 'Error: target_repo_root must be a bare folder name (a-z / A-Z / 0-9 / . / _ / -), e.g. "vAG-Apps".';
    }

    const htmlPath = sourcePath.endsWith('.html') ? sourcePath : `${sourcePath}/index.html`;
    if (!isSafeRelPath(htmlPath)) {
      return `Error: unsafe source path "${htmlPath}" (no '..' segments, no absolute paths).`;
    }
    const htmlContent = await mem.readFile(htmlPath);
    if (htmlContent === null) {
      return `App file not found in workspace: ${htmlPath}`;
    }

    const parsed = parseAppManifest(htmlContent);

    let manifest = parsed.manifest;
    if (!manifest) {
      const id = asString(args.id).trim();
      const name = asString(args.name).trim();
      const category = asString(args.category).trim();
      const description = asString(args.description).trim();
      const author = asString(args.author, 'vibeops').trim();
      const icon = asString(args.icon, '📦').trim();
      if (!id || !name || !category || !description) {
        return 'No manifest block found and missing required fields. Pass id, name, category, and description to create one.';
      }
      if (!isValidAppCategory(category)) {
        return `Invalid category "${category}". Allowed: ${ALLOWED_APP_CATEGORIES.join(', ')}.`;
      }
      manifest = {
        id,
        name,
        version: '1.0.0',
        author,
        category,
        description,
        icon,
        permissions: [],
      };
    }

    if (!isValidAppCategory(manifest.category)) {
      return `Publish refused: invalid app category "${manifest.category}". Allowed: ${ALLOWED_APP_CATEGORIES.join(', ')}.`;
    }
    if (!isValidAppId(manifest.id)) {
      return `Publish refused: invalid app id "${manifest.id}" (must be lowercase alphanumeric with . or - separators).`;
    }

    const targetPath = `${targetRepoRoot}/apps/${manifest.category}/${manifest.id}/index.html`;
    if (!isSafeRelPath(targetPath)) {
      return `Publish refused: unsafe target path "${targetPath}".`;
    }
    const targetHtml = injectAppManifest(htmlContent, manifest);
    await mem.writeFile(targetPath, targetHtml);

    return `Prepared app "${manifest.name}" (${manifest.id}) for publishing.\n\nFile written:\n  - ${targetPath}\n\nNext steps: Commit and push the file to the vAG-Apps repository.`;
  },
};

// --- Memory (IndexedDB) ---
