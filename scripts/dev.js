// Development: start the Vite dev server for the pages, then Electron pointing at it.
// Usage: npm run dev   (needs `npm install` first; the backend is optional: node ../backend ... see README)
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');

// Optional desktop/.env.local and .env (both git-ignored): KEY=value lines, e.g. IVUENU_GOOGLE_CLIENT_ID for the calendar sign-in.
// Values already in the environment win, then .env.local, then .env.
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of require('fs').readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* file missing: fine */ }
}
// VS Code's terminal (and other Electron-based hosts) export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;
const URL_ = 'http://localhost:5173';

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit' });

function up(cb) {
  http.get(`${URL_}/index.html`, (res) => { res.resume(); cb(res.statusCode < 500); }).on('error', () => cb(false));
}

// macOS names an app (Dock tooltip, Cmd-Tab, permission prompts) from its bundle, so the stock Electron.app shows "Electron".
// Keep a copy renamed to Ivueno, with our icon, under node_modules/.ivueno-dev and launch that instead. It is rebuilt when
// Electron or build/icon.png changes; if anything fails, the stock Electron is used. A packaged build is named by electron-builder.
function macDevApp(electron) {
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const src = path.resolve(electron, '..', '..', '..');                    // .../Electron.app
  const dir = path.join(root, 'node_modules', '.ivueno-dev');
  const app = path.join(dir, 'Ivueno.app');
  const bin = path.join(app, 'Contents', 'MacOS', path.basename(electron));
  const iconPng = path.join(root, 'build', 'icon.png');
  const stamp = `${require('electron/package.json').version} ${fs.statSync(iconPng).mtimeMs}`;
  const stampFile = path.join(dir, 'stamp');
  try { if (fs.readFileSync(stampFile, 'utf8') === stamp && fs.existsSync(bin)) return bin; } catch { /* build it */ }
  try {
    const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'ignore' });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    run('ditto', [src, app]);
    const plist = path.join(app, 'Contents', 'Info.plist');
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      try { run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Ivueno`, plist]); } catch { run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string Ivueno`, plist]); }
    }
    // Our icon as the bundle icon, so the Dock shows it from the first frame (the app also sets it once running).
    const set = path.join(dir, 'icon.iconset');
    fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      run('sips', ['-z', String(s), String(s), iconPng, '--out', path.join(set, `icon_${s}x${s}.png`)]);
      run('sips', ['-z', String(s * 2), String(s * 2), iconPng, '--out', path.join(set, `icon_${s}x${s}@2x.png`)]);
    }
    const icnsName = (() => { try { return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', plist], { encoding: 'utf8' }).trim(); } catch { return 'electron.icns'; } })();
    run('iconutil', ['-c', 'icns', set, '-o', path.join(app, 'Contents', 'Resources', icnsName.endsWith('.icns') ? icnsName : `${icnsName}.icns`)]);
    // Editing the bundle breaks Electron's signature; sign the copy for this machine only.
    run('codesign', ['--force', '--deep', '--sign', '-', app]);
    fs.writeFileSync(stampFile, stamp);
    return bin;
  } catch (e) {
    console.warn(`[dev] could not prepare Ivueno.app (${e.message}); using the stock Electron`);
    return electron;
  }
}

(function wait() {
  up((ok) => {
    if (!ok) return setTimeout(wait, 300);
    let electron = require('electron');
    if (process.platform === 'darwin') electron = macDevApp(electron);
    const args = process.env.IVUENU_USER_DATA_DIR ? ['.', `--user-data-dir=${process.env.IVUENU_USER_DATA_DIR}`] : ['.'];
    const child = spawn(electron, args, { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: URL_ } });
    child.on('exit', () => { vite.kill(); process.exit(0); });
  });
}());
