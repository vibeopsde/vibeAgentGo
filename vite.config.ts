import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

function readVersion(): string {
  const pkgPath = resolve(__dirname, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return `v${pkg.version}`;
}

function injectHtmlVersion(): Plugin {
  const version = readVersion();
  return {
    name: 'inject-html-version',
    transformIndexHtml(html) {
      return html.replace(
        /<head>/i,
        `<head>\n  <meta name="vibeagentgo-version" content="${version}" />`
      );
    },
  };
}

function injectServiceWorkerVersion(): Plugin {
  const version = readVersion();

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
  plugins: [injectHtmlVersion(), injectServiceWorkerVersion()],
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