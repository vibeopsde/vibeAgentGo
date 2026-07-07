import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

function injectServiceWorkerVersion(): Plugin {
  const versionPath = resolve(__dirname, 'web/src/version.ts');
  const versionMatch = /VERSION = '([^']+)'/.exec(readFileSync(versionPath, 'utf-8'));
  const version = versionMatch ? versionMatch[1] : 'unknown';

  return {
    name: 'inject-service-worker-version',
    closeBundle() {
      const swPath = resolve(__dirname, 'web/dist/sw.js');
      let sw = readFileSync(swPath, 'utf-8');
      const count = (sw.match(/vibeAgentGo-__VERSION__/g) || []).length;
      if (count === 0) {
        throw new Error(`Expected SW version placeholder in ${swPath}, found none.`);
      }
      sw = sw.replace(/vibeAgentGo-__VERSION__/g, `vibeAgentGo-${version}`);
      const check = (sw.match(new RegExp(`vibeAgentGo-${version}`, 'g')) || []).length;
      if (check !== count) {
        throw new Error(`SW version replacement mismatch: expected ${count}, got ${check}.`);
      }
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