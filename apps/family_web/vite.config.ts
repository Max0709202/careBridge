import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The standalone account-deletion page lives in the repo's `web/` folder, next
 * to the Flutter build it has always shipped with. It is served from here too,
 * rather than copied, so there is one page and one script — a second copy is
 * where the two would quietly drift apart. It is plain HTML on purpose (Google
 * Play needs it to work without the app bundle), so it is passed through
 * untouched.
 */
function standaloneDeletionPage(): Plugin {
  const source = resolve(__dirname, '../../web');
  const files: Record<string, string> = {
    'delete-account.html': 'text/html; charset=utf-8',
    'delete-account.js': 'text/javascript; charset=utf-8',
  };

  return {
    name: 'carebridge-standalone-deletion-page',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const name = path === 'delete-account' ? 'delete-account.html' : path;
        const type = files[name];
        if (!type) return next();
        res.setHeader('Content-Type', type);
        res.end(readFileSync(resolve(source, name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(files)) {
        this.emitFile({
          type: 'asset',
          fileName: name,
          source: readFileSync(resolve(source, name)),
        });
      }
    },
  };
}

// The API is reached at a relative `/api/v1`, exactly as the Flutter web build
// does: in production nginx proxies it from the same origin, so there is no
// CORS, no API hostname in the bundle, and `connect-src 'self'` holds. In
// development Vite plays nginx's part.
const apiTarget = process.env.CAREBRIDGE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), standaloneDeletionPage()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  // `xfwd` so the API's rate limits see each visitor's address rather than
  // this proxy's, when the preview build is served to other machines.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true, xfwd: true },
    },
  },
  build: {
    outDir: 'dist',
    // No public source maps: the bundle is what ships, not the source tree.
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
