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
  // Default build-time language; overwritten at runtime by AppController.
  const defaultLang = process.env.VITE_APP_LANG === 'en' ? 'en' : 'de';
  return {
    name: 'inject-html-version',
    transformIndexHtml(html) {
      return html
        .replace(
          /<head>/i,
          `<head>\n  <meta name="vibeagentgo-version" content="${version}" />`
        )
        .replace(
          /<html lang="__VITE_APP_LANG__">/i,
          `<html lang="${defaultLang}">`
        );
    },
  };
}

function injectServiceWorkerVersion(outDirName: string): Plugin {
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
      const outDir = resolve(__dirname, 'web', outDirName);
      const outPath = resolve(outDir, 'sw.js');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      // Pre-cache hashed assets referenced by index.html so the app is fully offline after install.
      const htmlPath = resolve(outDir, 'index.html');
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, 'utf-8');
        // Start with the ASSETS already declared in the SW template (static icons + entry files).
        const assetPaths = new Set<string>();
        const existingMatch = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
        if (existingMatch) {
          for (const m of existingMatch[1].matchAll(/'([^']+)'/g)) {
            assetPaths.add(m[1]);
          }
        }
        // Add script/link tags with relative paths to hashed chunks.
        for (const m of html.matchAll(/(?:src|href)=["'](\.\/assets\/[^"']+)["']/g)) {
          assetPaths.add(m[1]);
        }
        // Add any other JS referenced directly from the HTML (e.g. PDF worker, agent-worker).
        for (const m of html.matchAll(/(?:src|href)=["'](\.\/[^"']+\.js)["']/g)) {
          assetPaths.add(m[1]);
        }
        const assetArray = JSON.stringify(Array.from(assetPaths).sort(), null, 2).replace(/\n/g, '\n  ');
        sw = sw.replace(/const ASSETS = \[.*?\];/s, `const ASSETS = ${assetArray};`);
      }

      writeFileSync(outPath, sw);
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDevDeploy = mode === 'dev-deploy' || process.env.DEPLOY_TARGET === 'dev';
  const outDir = isDevDeploy ? 'dist-dev' : 'dist';

  return {
    root: 'web',
    base: './',
    build: {
      outDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('pdfjs-dist')) return 'pdfjs';
          },
        },
      },
    },
    plugins: [injectHtmlVersion(), injectServiceWorkerVersion(outDir)],
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
  };
});
