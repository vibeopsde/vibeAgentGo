import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

function injectServiceWorkerVersion(): Plugin {
  const versionPath = resolve(__dirname, 'web/src/version.ts');
  const versionMatch = /VERSION = '([^']+)'/.exec(readFileSync(versionPath, 'utf-8'));
  const version = versionMatch ? versionMatch[1] : 'unknown';

  return {
    name: 'inject-service-worker-version',
    closeBundle() {
      // In Vite 8 (rolldown), public/ files are copied after closeBundle.
      // Read the template from public/ and write the substituted version to dist/.
      const srcPath = resolve(__dirname, 'web/public/sw.js');
      let sw = readFileSync(srcPath, 'utf-8');
      const count = (sw.match(/vibeAgentGo-__VERSION__/g) || []).length;
      if (count === 0) {
        throw new Error(`Expected SW version placeholder in ${srcPath}, found none.`);
      }
      sw = sw.replace(/vibeAgentGo-__VERSION__/g, `vibeAgentGo-${version}`);
      const check = (sw.match(new RegExp(`vibeAgentGo-${version}`, 'g')) || []).length;
      if (check !== count) {
        throw new Error(`SW version replacement mismatch: expected ${count}, got ${check}.`);
      }
      const outPath = resolve(__dirname, 'web/dist/sw.js');
      const outDir = resolve(__dirname, 'web/dist');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(outPath, sw);
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