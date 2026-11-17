import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// App requests stay in the main process. Remote frames require HTTPS here; the
// native frame-navigation guard in windows.js restricts them to exact WiPay hosts
// and Cloudflare verification frames nested inside those checkout pages.
// That guard also catches browser-return redirects before they blank the frame.
const csp = {
  name: 'ivuenu-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'none'; connect-src 'none'; object-src 'none'; frame-src https:">`),
};

export default defineConfig({
  root: path.resolve(here, 'src/renderer'),
  base: './',
  plugins: [react(), csp],
  build: {
    outDir: path.resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(here, 'src/renderer/index.html'),
        island: path.resolve(here, 'src/renderer/island.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
