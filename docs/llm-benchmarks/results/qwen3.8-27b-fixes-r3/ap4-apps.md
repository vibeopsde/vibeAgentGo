[0m
> build · ollama/qwen3.8:27b
[0m
[0m✱ [0mGlob "**/AppStoreApp.ts"[90m 1 match[0m
[0m✱ [0mGlob "**/appManifest.ts"[90m 1 match[0m
[0m✱ [0mGlob "**/escape.ts"[90m 1 match[0m
[0m→ [0mRead web/src/apps/AppStoreApp.ts
[0m→ [0mRead web/src/core/appManifest.ts
[0m→ [0mRead web/src/utils/escape.ts
[0m✱ [0mGlob "**/types/index.ts"[90m 1 match[0m
[0m✱ [0mGlob "**/window_manager*"[90m 2 matches[0m
Now let me examine the App interface convention, window manager, and other apps with timers.
[0m✱ [0mGlob "web/src/apps/*.ts"[90m 6 matches[0m
[0m✱ [0mGrep "unmount\(\)?\s*:|unmount\s*\(|interface App\b"[90m in web/src · 3 matches[0m
[0m✱ [0mGrep "setInterval|setTimeout|addEventListener|clearInterval"[90m in web/src/apps · 63 matches[0m
[0m→ [0mRead web/src/types/index.ts[90m [offset=160, limit=40][0m
Let me read the App interface, window_manager's closeWindow, the ExplorerApp unmount pattern, and SettingsApp for timers.
[0m→ [0mRead web/src/apps/ExplorerApp.ts[90m [offset=60, limit=130][0m
[0m✱ [0mGrep "unmount"[90m in web/src · 3 matches[0m
Now let me check how window_manager calls unmount, and inspect SettingsApp and other apps with timers.
[0m✱ [0mGrep "Timer|setInterval"[90m in web/src/apps · 12 matches[0m
[0m→ [0mRead web/src/core/window_manager.ts[90m [offset=280, limit=40][0m
[0m→ [0mRead web/src/apps/SettingsApp.ts
[0m✱ [0mGrep "injectAppManifest|parseAppManifest|defaultAppPath|normalizeCategory"[90m in . · 62 matches[0m
Now let me check where the manifest-parsed values flow to (consumers of appManifest) and check other apps for timers/global listeners.
[0m✱ [0mGrep "addEventListener\('?(message|resize|keydown|beforeunload)"[90m in web/src/apps · 6 matches[0m
[0m→ [0mRead web/src/core/app_store_db.ts
[0m→ [0mRead web/src/core/tools/app_store_tools.ts[90m [offset=220, limit=70][0m
Let me check the consumers of manifest values to complete fix 3b.
I have a full picture. Now implementing the three fixes.

**Fix 1: `unmount()` in AppStoreApp**
[0m
[0m← [0mEdit web/src/apps/AppStoreApp.ts
Index: /root/vibeAgentGo/web/src/apps/AppStoreApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/AppStoreApp.ts
+++ /root/vibeAgentGo/web/src/apps/AppStoreApp.ts
@@ -66,8 +66,13 @@
   this.startRefreshLoop();
   this.load();
 }
 
+unmount(): void {
+  this.stopRefreshLoop();
+  this.onBridgeRequest = null;
+}
+
 private async bridge(req: BridgeRequest): Promise<BridgeResponse> {
   if (!this.onBridgeRequest) return { ok: false, error: 'No bridge handler' };
   return this.onBridgeRequest(req);
 }

[0m
**Fix 2: escape all dynamic values (renderPermissions is unescaped)**
[0m← [0mEdit web/src/apps/AppStoreApp.ts
Index: /root/vibeAgentGo/web/src/apps/AppStoreApp.ts
===================================================================
--- /root/vibeAgentGo/web/src/apps/AppStoreApp.ts
+++ /root/vibeAgentGo/web/src/apps/AppStoreApp.ts
@@ -440,8 +440,10 @@
     return card;
   }
 
   private renderPermissions(perms: string[]): string {
-    if (!perms.length) return t('appstore.noPermissions') || 'No permissions required';
-    return `${t('appstore.permissions') || 'Permissions'}: ${perms.join(', ')}`;
+    if (!perms.length) return escapeHtml(t('appstore.noPermissions') || 'No permissions required');
+    return `${escapeHtml(t('appstore.permissions') || 'Permissions')}: ${perms
+      .map((p) => escapeHtml(String(p)))
+      .join(', ')}`;
   }
 }

[0m
**Fix 3: appManifest.ts** — (a) safe global replace + (b) escape `<` in the JSON script block to prevent `</script>` breakout.
[0m← [0mEdit web/src/core/appManifest.ts
Index: /root/vibeAgentGo/web/src/core/appManifest.ts
===================================================================
--- /root/vibeAgentGo/web/src/core/appManifest.ts
+++ /root/vibeAgentGo/web/src/core/appManifest.ts
@@ -62,18 +62,26 @@
 
   return { manifest };
 }
 
+function escapeRegExp(text: string): string {
+  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
+}
+
+function safeReplaceAll(haystack: string, needle: string, replacement: () => string): string {
+  return haystack.replace(new RegExp(escapeRegExp(needle), 'g'), replacement);
+}
+
 export function injectAppManifest(html: string, manifest: AppManifest): string {
-  const json = JSON.stringify(manifest, null, 2);
+  const json = JSON.stringify(manifest, null, 2).replace(/</g, '\\u003c');
   const block = `<script type="application/vnd.vag+json">\n${json}\n</script>`;
   const existing = html.match(/<script\s+type="application\/vnd\.vag\+json"[^>]*>[\s\S]*?<\/script>/i);
   if (existing) {
-    return html.replace(existing[0], block);
+    return safeReplaceAll(html, existing[0], () => block);
   }
   // Insert before </head> if present, otherwise at the top of the document.
   if (html.includes('</head>')) {
-    return html.replace('</head>', `${block}\n</head>`);
+    return safeReplaceAll(html, '</head>', () => `${block}\n</head>`);
   }
   return block + '\n' + html;
 }
 

[0m
Now let me verify the changes compile. Let me check for the build/typecheck command.
[0m→ [0mRead web/package.json
[0m
[0m$ [0mcat /root/vibeAgentGo/package.json 2>/dev/null; echo "---WC---"; ls /root/vibeAgentGo/web/*.json /root/vibeAgentGo/web/tsconfig* 2>/dev/null; echo "---ROOT---"; ls /root/vibeAgentGo/*.json 2>/dev/null; which tsc npx node 2>/dev/null
{
  "name": "vibeagentgo",
  "version": "2608.3.1",
  "description": "vibeAgentGo — Fully client-side AI agent PWA with memory and Web Worker code sandbox",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p web/tsconfig.json --noEmit",
    "build:dev": "DEPLOY_TARGET=dev vite build --mode dev-deploy && tsc -p web/tsconfig.json --noEmit",
    "preview": "vite preview",
    "preview:dev": "vite preview --outDir web/dist-dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint web/src --ext .ts,.js",
    "lint:fix": "eslint web/src --ext .ts,.js --fix",
    "format": "prettier --write \"web/src/**/*.{ts,js,json,md}\" \"*.md\""
  },
  "keywords": [
    "ai-agent",
    "agent",
    "pwa",
    "mobile",
    "ai",
    "typescript",
    "data-sovereignty"
  ],
  "license": "MIT",
  "dependencies": {
    "@types/sql.js": "^1.4.11",
    "dompurify": "^3.2.0",
    "jszip": "^3.10.1",
    "marked": "^15.0.0",
    "pdfjs-dist": "^6.1.200",
    "prismjs": "^1.30.0",
    "sql.js": "^1.14.1"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/dompurify": "^3.0.0",
    "@types/jszip": "^3.4.0",
    "@types/node": "^22.0.0",
    "@types/pdfjs-dist": "^2.10.377",
    "@types/prismjs": "^1.26.6",
    "eslint": "^10.6.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-prettier": "^5.5.6",
    "fake-indexeddb": "^6.2.5",
    "globals": "^17.7.0",
    "jsdom": "^26.0.0",
    "prettier": "^3.9.4",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.62.1",
    "vite": "^8.1.3",
    "vitest": "^3.0.0"
  }
}
---WC---
/root/vibeAgentGo/web/package-lock.json
/root/vibeAgentGo/web/package.json
/root/vibeAgentGo/web/tsconfig.json
/root/vibeAgentGo/web/tsconfig.json
---ROOT---
/root/vibeAgentGo/package-lock.json
/root/vibeAgentGo/package.json
/root/vibeAgentGo/tsconfig.json
/usr/local/lib/hermes-agent/node_modules/.bin/tsc
/root/.hermes/node/bin/npx
/root/.hermes/node/bin/node
[0m
Let me verify the changes typecheck and lint cleanly.
[0m$ [0mnpx tsc -p web/tsconfig.json --noEmit 2>&1 | head -40; echo "EXIT:$?"
npm notice run vibeagentgo@2608.3.1 npx
npm notice run 'tsc' -p web/tsconfig.json --noEmit
EXIT:0
[0m
[0m$ [0mnpx eslint web/src/apps/AppStoreApp.ts web/src/core/appManifest.ts 2>&1 | head -30; echo "EXIT:$?"
npm notice run vibeagentgo@2608.3.1 npx
npm notice run 'eslint' web/src/apps/AppStoreApp.ts web/src/core/appManifest.ts
EXIT:0
[0m
TSC & ESLint clean. Alle drei Fixes umgesetzt (visuell unverändert).

**Geänderte Stellen:**

1. `AppStoreApp.ts:70-73` — neue `unmount()`-Methode, die `stopRefreshLoop()` aufruft (clearInterval) und `onBridgeRequest` nullt; SettingsApp benötigt keinen Hinzufix (keine Timer/globalen Listener).
2. `AppStoreApp.ts:443-448` — `renderPermissions` escapet jetzt Label und jedes Permission-Element via `escapeHtml`, sodass keine Permissions mehr unescaped in `innerHTML` fließen.
3. `appManifest.ts:66-86` — `injectAppManifest` nutzt neue Helfer `escapeRegExp` + `safeReplaceAll` (Global-RegExp + Replacement-Callback statt `replace(string,string)`), und der JSON-Block escapet `<` als `\u003c`, um `</script>`-Breakout zu verhindern.
