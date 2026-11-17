// Development: start the Vite dev server for the pages, then Electron pointing at it.
// Usage: npm run dev   (needs `npm install` first; the backend is optional: node ../backend ... see README)
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');

// Optional desktop/.env.local (not committed): KEY=value lines, e.g. IVUENU_GOOGLE_CLIENT_ID for the calendar sign-in.
try {
  for (const line of require("fs").readFileSync(path.join(root, ".env.local"), "utf8").split(String.fromCharCode(10))) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env.local: fine */ }
const URL_ = 'http://localhost:5173';

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit' });

function up(cb) {
  http.get(`${URL_}/index.html`, (res) => { res.resume(); cb(res.statusCode < 500); }).on('error', () => cb(false));
}

(function wait() {
  up((ok) => {
    if (!ok) return setTimeout(wait, 300);
    const electron = require('electron');
    const child = spawn(electron, process.env.IVUENU_USER_DATA_DIR ? ['.', `--user-data-dir=${process.env.IVUENU_USER_DATA_DIR}`] : ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: URL_ } });
    child.on('exit', () => { vite.kill(); process.exit(0); });
  });
}());
