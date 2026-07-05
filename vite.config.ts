import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

function injectServiceWorkerVersion(): Plugin {
  return {
    name: 'inject-service-worker-version',
    closeBundle() {
      const versionPath = resolve(__dirname, 'web/src/version.ts');
      const swPath = resolve(__dirname, 'web/dist/sw.js');
      const versionMatch = /VERSION = '([^']+)'/.exec(readFileSync(versionPath, 'utf-8'));
      const version = versionMatch ? versionMatch[1] : 'unknown';
      let sw = readFileSync(swPath, 'utf-8');
      sw = sw.replace(/vibeAgentGo-__VERSION__/g, `vibeAgentGo-${version}`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [injectServiceWorkerVersion()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'web/src'),
      '@types': resolve(__dirname, 'web/src/types'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});