// ============================================================
// vibeAgentGo — Workspace Registry (localStorage)
// Multiple IndexedDB databases, one per workspace.
// Config (API key, model, provider) stays shared in localStorage.
// ============================================================

const WORKSPACES_KEY = 'vibeAgentGo-workspaces';
const ACTIVE_WORKSPACE_KEY = 'vibeAgentGo-activeWorkspace';

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

/** Generate a short unique ID for a new workspace. */
function generateWorkspaceId(): string {
  return 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/** Get all registered workspaces, sorted by creation date (oldest first). */
export function listWorkspaces(): Workspace[] {
  const stored = localStorage.getItem(WORKSPACES_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as Workspace[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

function saveWorkspaces(workspaces: Workspace[]): void {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
}

/** Get the active workspace ID. Falls back to the first workspace or 'default'. */
export function getActiveWorkspaceId(): string {
  const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  if (stored && listWorkspaces().some((w) => w.id === stored)) return stored;
  // Fall back to first workspace
  const workspaces = listWorkspaces();
  if (workspaces.length > 0) {
    setActiveWorkspaceId(workspaces[0].id);
    return workspaces[0].id;
  }
  // No workspaces at all — create default
  const defaultWs = createWorkspace('Default');
  setActiveWorkspaceId(defaultWs.id);
  return defaultWs.id;
}

/** Set the active workspace ID. */
export function setActiveWorkspaceId(id: string): void {
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
}

/** Get the active workspace object. */
export function getActiveWorkspace(): Workspace {
  const id = getActiveWorkspaceId();
  const ws = listWorkspaces().find((w) => w.id === id);
  return ws ?? { id, name: 'Default', createdAt: new Date().toISOString() };
}

/** Create a new workspace with the given name. Returns the created workspace. */
export function createWorkspace(name: string): Workspace {
  const workspaces = listWorkspaces();
  const ws: Workspace = {
    id: generateWorkspaceId(),
    name: name.trim() || 'Workspace',
    createdAt: new Date().toISOString(),
  };
  workspaces.push(ws);
  saveWorkspaces(workspaces);
  return ws;
}

/** Rename a workspace by ID. */
export function renameWorkspace(id: string, newName: string): boolean {
  const workspaces = listWorkspaces();
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return false;
  ws.name = newName.trim() || ws.name;
  saveWorkspaces(workspaces);
  return true;
}

/** Delete a workspace by ID. Also deletes its IndexedDB database.
 *  Cannot delete the last remaining workspace — a default is auto-created. */
export async function deleteWorkspace(id: string): Promise<boolean> {
  const workspaces = listWorkspaces();
  if (workspaces.length <= 1) return false;
  const filtered = workspaces.filter((w) => w.id !== id);
  if (filtered.length === workspaces.length) return false;
  saveWorkspaces(filtered);

  // Delete the IndexedDB for this workspace
  const dbName = `vibeAgentGo-agent-${id}`;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

  // If the active workspace was deleted, switch to the first remaining one
  const active = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  if (active === id) {
    setActiveWorkspaceId(filtered[0].id);
  }
  return true;
}

/** Switch to a workspace by ID. Returns true if the active workspace changed. */
export function switchWorkspace(id: string): boolean {
  const workspaces = listWorkspaces();
  if (!workspaces.some((w) => w.id === id)) return false;
  const current = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  if (current === id) return false;
  setActiveWorkspaceId(id);
  return true;
}

/** One-time migration: if there are no registered workspaces but the old
 *  un-namespaced DB 'vibeAgentGo-agent' exists, register it as the 'default'
 *  workspace. This preserves existing users' data. */
export async function migrateLegacyWorkspace(): Promise<void> {
  const workspaces = listWorkspaces();
  if (workspaces.length > 0) return;

  // Check if the old DB name exists
  const oldDbName = 'vibeAgentGo-agent';
  let oldExists = false;
  try {
    oldExists = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open(oldDbName);
      req.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // If the DB has stores, it has data from a previous install
        oldExists = db.objectStoreNames.length > 0;
        db.close();
        resolve(oldExists);
      };
      req.onerror = () => resolve(false);
      // If upgradeneeded fires, the DB didn't exist before
      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Don't create any stores — just close. The DB was just created (empty).
        db.close();
        resolve(false);
      };
    });
  } catch {
    oldExists = false;
  }

  if (oldExists) {
    // Create a default workspace entry and migrate the DB name
    const ws: Workspace = {
      id: 'default',
      name: 'Default',
      createdAt: new Date().toISOString(),
    };
    saveWorkspaces([ws]);
    setActiveWorkspaceId('default');

    // The old DB 'vibeAgentGo-agent' is kept as-is.
    // db.ts will use 'vibeAgentGo-agent-default' for the 'default' workspace.
    // We need to copy the old DB to the new name.
    await copyDatabase(oldDbName, `vibeAgentGo-agent-default`);
  } else {
    // Fresh install — create a default workspace
    const ws: Workspace = {
      id: 'default',
      name: 'Default',
      createdAt: new Date().toISOString(),
    };
    saveWorkspaces([ws]);
    setActiveWorkspaceId('default');
  }
}

/** Copy all data from one IndexedDB to another (same schema). */
async function copyDatabase(sourceName: string, targetName: string): Promise<void> {
  const DB_VERSION = 5;
  const STORE_NAMES = ['memory', 'sessions', 'skills', 'files', 'logs'];

  // Open source DB
  const sourceDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(sourceName, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (event) => {
      // If the source DB doesn't exist, this creates it — but it'll be empty.
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('memory')) {
        const memStore = db.createObjectStore('memory', { keyPath: 'id', autoIncrement: true });
        memStore.createIndex('category', 'category', { unique: false });
        memStore.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessStore.createIndex('updated_at', 'updated_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('skills')) {
        db.createObjectStore('skills', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
        logStore.createIndex('level', 'level', { unique: false });
        logStore.createIndex('source', 'source', { unique: false });
      }
    };
  });

  // Open target DB (create if needed)
  const targetDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(targetName, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('memory')) {
        const memStore = db.createObjectStore('memory', { keyPath: 'id', autoIncrement: true });
        memStore.createIndex('category', 'category', { unique: false });
        memStore.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessStore.createIndex('updated_at', 'updated_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('skills')) {
        db.createObjectStore('skills', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
        logStore.createIndex('level', 'level', { unique: false });
        logStore.createIndex('source', 'source', { unique: false });
      }
    };
  });

  // Copy each store
  for (const storeName of STORE_NAMES) {
    if (!sourceDb.objectStoreNames.contains(storeName)) continue;

    // Read all from source
    const allRecords = await new Promise<any[]>((resolve, reject) => {
      const tx = sourceDb.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (allRecords.length === 0) continue;

    // Write all to target
    await new Promise<void>((resolve, reject) => {
      const tx = targetDb.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const record of allRecords) {
        store.put(record);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  sourceDb.close();
  targetDb.close();
}