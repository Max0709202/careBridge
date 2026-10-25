import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API is reached at a relative `/api/v1`, as in the family web app: in
// production nginx proxies it from the same origin, so there is no CORS and no
// API hostname in the bundle. In development Vite plays nginx's part.
//
// Its own port, because it is its own origin — the same reason the ops console
// is. A driver's session and a family's must never share storage.
const apiTarget = process.env.CAREBRIDGE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  // `xfwd` so the API's rate limits see each visitor's address rather than
  // this proxy's, when the preview build is served to other machines.
  preview: {
    port: 4174,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true, xfwd: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
