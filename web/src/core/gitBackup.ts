// ============================================================
// vibeAgentGo — Git Backup Manager (isomorphic-git in browser)
// Syncs only workspace files (MemoryStore.files) to a remote Git repo.
// Sessions, memory entries, skills and config are never synced.
// ============================================================

import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';
import { MemoryStore } from './memory.js';

const FS_NAME = 'vibeAgentGoGitFS';
const WORKDIR = '/workspace';
const GIT_REMOTE = 'origin';

export interface GitCredentials {
  url: string;
  username: string;
  token: string;
  corsProxy?: string;
}

export class GitBackupManager {
  private memory: MemoryStore;
  private fs: LightningFS;
  private pfs: any;

  constructor() {
    this.memory = new MemoryStore();
    this.fs = new LightningFS(FS_NAME);
    this.pfs = this.fs.promises;
  }

  private async ensureDir(dir: string) {
    try {
      await this.pfs.mkdir(dir, { recursive: true });
    } catch {
      // ignore
    }
  }

  private async emptyDir(dir: string) {
    const items = await this.pfs.readdir(dir).catch(() => []);
    for (const item of items) {
      if (item === '.git') continue;
      const fullPath = `${dir}/${item}`;
      const stat = await this.pfs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        await this.removeRecursive(fullPath);
      } else {
        await this.pfs.unlink(fullPath).catch(() => {});
      }
    }
  }

  private async removeRecursive(dir: string) {
    const items = await this.pfs.readdir(dir).catch(() => []);
    for (const item of items) {
      const fullPath = `${dir}/${item}`;
      const stat = await this.pfs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        await this.removeRecursive(fullPath);
      } else {
        await this.pfs.unlink(fullPath).catch(() => {});
      }
    }
    await this.pfs.rmdir(dir).catch(() => {});
  }

  private async writeFilesToFS(dir: string, files: { path: string; content: string }[]) {
    for (const f of files) {
      const parts = f.path.split('/').filter(Boolean);
      const fileName = parts.pop()!;
      let currentPath = dir;
      for (const part of parts) {
        currentPath += `/${part}`;
        await this.ensureDir(currentPath);
      }
      await this.pfs.writeFile(`${currentPath}/${fileName}`, f.content);
    }
  }

  private async readFilesFromFS(dir: string, prefix = ''): Promise<{ path: string; content: string }[]> {
    const result: { path: string; content: string }[] = [];
    const items = await this.pfs.readdir(dir).catch(() => []);
    for (const item of items) {
      if (item === '.git') continue;
      const fullPath = `${dir}/${item}`;
      const relativePath = prefix ? `${prefix}/${item}` : item;
      const stat = await this.pfs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        const nested = await this.readFilesFromFS(fullPath, relativePath);
        result.push(...nested);
      } else {
        const content = await this.pfs.readFile(fullPath, 'utf8');
        result.push({ path: relativePath, content });
      }
    }
    return result;
  }

  async clone(creds: GitCredentials): Promise<void> {
    await this.ensureDir(WORKDIR);
    await this.emptyDir(WORKDIR);
    await git.clone({
      fs: this.fs,
      http,
      dir: WORKDIR,
      url: creds.url,
      corsProxy: creds.corsProxy || undefined,
      singleBranch: true,
      depth: 1,
      onAuth: () => ({ username: creds.username, password: creds.token }),
    });
  }

  async status(creds: GitCredentials): Promise<{ ahead: number; behind: number; clean: boolean }> {
    await this.ensureRepo(creds);
    const currentBranch = await git.currentBranch({ fs: this.fs, dir: WORKDIR, fullname: false });
    const branch = currentBranch || 'main';
    await git.fetch({
      fs: this.fs,
      http,
      dir: WORKDIR,
      corsProxy: creds.corsProxy || undefined,
      onAuth: () => ({ username: creds.username, password: creds.token }),
    });
    const local = await git.log({ fs: this.fs, dir: WORKDIR, depth: 1 });
    const statusMatrix = await git.statusMatrix({ fs: this.fs, dir: WORKDIR });
    const clean = statusMatrix.every(([_, head, workdir, stage]) => head === workdir && workdir === stage);
    return { ahead: local.length, behind: 0, clean };
  }

  private async ensureRepo(creds: GitCredentials): Promise<void> {
    try {
      await this.pfs.stat(`${WORKDIR}/.git`);
    } catch {
      await this.clone(creds);
    }
  }

  async push(creds: GitCredentials, message: string): Promise<void> {
    await this.ensureRepo(creds);

    // Copy workspace files from IndexedDB into working dir
    const files = await this.memory.listFiles();
    await this.emptyDir(WORKDIR);
    await this.writeFilesToFS(WORKDIR, files);

    await git.add({ fs: this.fs, dir: WORKDIR, filepath: '.' });
    const statusMatrix = await git.statusMatrix({ fs: this.fs, dir: WORKDIR });
    const modified = statusMatrix.filter(([_, head, workdir, stage]) => head !== workdir || workdir !== stage);
    if (modified.length === 0) {
      return;
    }

    const user = creds.username || 'vibeAgentGo';
    await git.commit({
      fs: this.fs,
      dir: WORKDIR,
      message,
      author: { name: user, email: `${user}@vibeAgentGo.local` },
    });

    await git.push({
      fs: this.fs,
      http,
      dir: WORKDIR,
      remote: GIT_REMOTE,
      url: creds.url,
      corsProxy: creds.corsProxy || undefined,
      onAuth: () => ({ username: creds.username, password: creds.token }),
    });
  }

  async pull(creds: GitCredentials): Promise<{ imported: number; deleted: number }> {
    await this.ensureRepo(creds);

    await git.pull({
      fs: this.fs,
      http,
      dir: WORKDIR,
      corsProxy: creds.corsProxy || undefined,
      onAuth: () => ({ username: creds.username, password: creds.token }),
    });

    const beforeFiles = await this.memory.listFiles();
    const beforePaths = new Set(beforeFiles.map((f) => f.path));
    const pulledFiles = await this.readFilesFromFS(WORKDIR);
    const pulledPaths = new Set(pulledFiles.map((f) => f.path));

    let imported = 0;
    for (const f of pulledFiles) {
      await this.memory.writeFile(f.path, f.content);
      imported++;
    }

    let deleted = 0;
    for (const path of beforePaths) {
      if (!pulledPaths.has(path)) {
        await this.memory.deleteFile(path);
        deleted++;
      }
    }

    return { imported, deleted };
  }

  async isCloned(): Promise<boolean> {
    try {
      await this.pfs.stat(`${WORKDIR}/.git`);
      return true;
    } catch {
      return false;
    }
  }
}
