// Renders the macOS icons from the SVGs in assets/. Run with: npm run icons:mac
//  - build/icon.png: the Dock / Finder icon. macOS icons leave a margin around the tile (824 of 1024 px, with a soft shadow),
//    so the tile from app-icon.svg is shrunk onto that grid; otherwise the app looks bigger than every other icon in the Dock.
//  - assets/trayTemplate.png (+@2x) and trayRecordingTemplate.png (+@2x): the menu-bar icon in one colour. Electron treats
//    a file named *Template as a template image, which macOS recolours for a light or dark menu bar.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// A recording dot cut out of the bottom right of the template mark.
const withDot = (svg) => svg.replace('</mask>',
  '<circle cx="404" cy="404" r="96" fill="#000"/><circle cx="404" cy="404" r="68" fill="#fff"/></mask>');

const jobs = [
  { out: 'build/icon.png', svg: read('assets/app-icon.svg'), size: 1024, tile: { units: 472, of: 512, px: 824 }, shadow: true },
  ...[1, 2].flatMap((scale) => [
    { out: `assets/trayTemplate${scale > 1 ? '@2x' : ''}.png`, svg: read('assets/tray-template.svg'), size: 18 * scale },
    { out: `assets/trayRecordingTemplate${scale > 1 ? '@2x' : ''}.png`, svg: withDot(read('assets/tray-template.svg')), size: 18 * scale },
  ]),
];

function draw({ svg, size, tile, shadow }) {
  // Runs in the page: draw the SVG onto a canvas of exactly `size` px and return a PNG data URL.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      const drawn = tile ? (tile.px / tile.units) * tile.of : size;
      const off = (size - drawn) / 2;
      if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = size * 0.028; ctx.shadowOffsetY = size * 0.012; }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, off, off, drawn, drawn);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('svg failed to load'));
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<body></body>');
  for (const job of jobs) {
    const url = await win.webContents.executeJavaScript(`(${draw.toString()})(${JSON.stringify(job)})`);
    fs.writeFileSync(path.join(root, job.out), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', job.out, `${job.size}px`);
  }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
