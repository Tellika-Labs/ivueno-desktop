const path = require('path');
const { BrowserWindow, screen, nativeImage, shell } = require('electron');
const { png } = require('./icons');
const { isAppPage } = require('./origins');
const { isAllowedPaymentFrame } = require('./payment-pages');

const DEV_URL = process.env.VITE_DEV_URL || '';
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const DIST = path.join(__dirname, '..', '..', 'dist', 'renderer');

// The shipped .ico is used directly (no waiting for the drawn icon, and the same file as the installer and the .exe).
const ICO = path.join(__dirname, '..', '..', 'assets', 'app-icon.ico');
const appIcon = () => { const img = nativeImage.createFromPath(ICO); return img.isEmpty() ? require('./brand').icon(256) : img; };

function pageUrl(page) {
  return DEV_URL ? `${DEV_URL}/${page}` : `file://${path.join(DIST, page).replace(/\\/g, '/')}`;
}

function isAppUrl(url) {
  return isAppPage(url, DEV_URL);
}

function lockDown(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  // WiPay and its nested verification widget may occupy remote frames. Keep its browser-return
  // redirect from replacing the checkout with our non-frameable return page.
  // The renderer continues polling the signed backend result to activate a plan.
  const keepCheckout = (event) => {
    if (event.isMainFrame) return;
    const ancestors = [];
    for (let frame = event.frame?.parent; frame; frame = frame.parent) ancestors.push(frame.url);
    if (!isAllowedPaymentFrame(event.url, ancestors)) event.preventDefault();
  };
  win.webContents.on('will-frame-navigate', keepCheckout);
  win.webContents.on('will-redirect', keepCheckout);
}

function createMain({ onClose, show = true } = {}) {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 940, minHeight: 640, show: false, title: 'Ivueno',
    backgroundColor: '#F7F5F2', icon: appIcon(),
    // No title bar: the content reaches the top edge; Windows draws only its three buttons over it (and rounds the corners).
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#F7F5F2', symbolColor: '#1F1D1A', height: 32 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  lockDown(win);
  win.once('ready-to-show', () => { if (show) win.show(); if (DEV_URL) win.webContents.openDevTools({ mode: 'detach' }); });   // development only: the console opens beside the app
  win.on('close', (event) => onClose && onClose(event));
  win.loadURL(pageUrl('index.html'));
  return win;
}

// The recording island: a small always-on-top pill, excluded from screen sharing, that never takes keyboard focus.
// The island's window never changes size: it is always big enough for the opened island (plus room on the sides, 24 px,
// and below, 32 px, for the shadow). Resizing a transparent window flickers (a frame of the old picture at the new size),
// so the pill and the opened island change shape inside it instead, and the empty, transparent part lets the mouse
// through to whatever is underneath (setInteractive, driven by the page as the pointer goes over the island or leaves it).
const SIZES = { collapsed: { w: 516, h: 268 }, expanded: { w: 516, h: 268 }, prompt: { w: 516, h: 268 } };

function createIsland({ saved, onMoved }) {
  const s = SIZES.expanded;
  const win = new BrowserWindow({
    width: s.w, height: s.h, frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, show: false, hasShadow: false, alwaysOnTop: true, title: 'Ivueno · a gravar',
    // macOS: a non-activating panel, so typing a quick note in it does not bring the main window or the app to the front.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);                       // not captured by screen sharing or recording
  lockDown(win);
  win.mode = 'collapsed';
  win.place = (mode) => {
    win.mode = mode;
    const size = SIZES[mode] || SIZES.expanded;
    const area = screen.getPrimaryDisplay().workArea;
    const cx = saved && saved.cx != null ? saved.cx : area.x + area.width / 2;
    const y = saved && saved.y != null ? saved.y : area.y;
    const b = { x: Math.round(cx - size.w / 2), y: Math.round(y), width: size.w, height: size.h };
    const now = win.getBounds();
    if (now.x !== b.x || now.y !== b.y || now.width !== b.width || now.height !== b.height) win.setBounds(b);
  };
  // Only the island catches the mouse; the rest of the window lets clicks through (forward: hover still reaches the page).
  win.interactive = false;
  win.setInteractive = (on) => {
    if (win.isDestroyed() || win.interactive === !!on) return;
    win.interactive = !!on;
    win.setIgnoreMouseEvents(!on, { forward: true });
  };
  win.setIgnoreMouseEvents(true, { forward: true });
  win.on('moved', () => {
    const b = win.getBounds();
    saved = { cx: b.x + b.width / 2, y: b.y };
    onMoved && onMoved(saved);
  });
  win.place('collapsed');
  win.loadURL(pageUrl('island.html'));
  return win;
}

// The "take notes?" card that slides in when a call starts (renderer/prompt.jsx). A small window in the top-right corner: it never takes the
// keyboard focus (the call keeps it), is not captured by screen sharing, and is shown with showInactive().
const PROMPT_SIZE = { w: 440, h: 270 };
function createMeetingPrompt() {
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: PROMPT_SIZE.w, height: PROMPT_SIZE.h, x: area.x + area.width - PROMPT_SIZE.w, y: area.y,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true, focusable: false,
    show: false, hasShadow: false, alwaysOnTop: true, title: 'Ivueno',
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);
  win.setIgnoreMouseEvents(true, { forward: true });      // only the banner catches the mouse (the page says when: meetprompt:hover)
  lockDown(win);
  win.loadURL(pageUrl('prompt.html'));
  return win;
}

module.exports = { createMain, createIsland, createMeetingPrompt, appIcon, SIZES, pageUrl, lockDown };
