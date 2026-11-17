const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, dialog, clipboard, shell, nativeImage, nativeTheme, safeStorage,
  session: electronSession, desktopCapturer, globalShortcut, systemPreferences,
} = require('electron');

const { Store, DEFAULT_SETTINGS } = require('./store');
const { Repo } = require('./repo');
const { SecureStore } = require('./secure');
const accounts = require('./accounts');
const { Updater } = require('./updater');
const { ApiClient } = require('./api');
const { Telemetry, where: errorWhere } = require('./telemetry');
const { LicenceManager } = require('./licence');
const { createEngine } = require('./engine');
const { CloudEngine } = require('./engine/cloud');
const { AudioImporter } = require('./importer');
const { MediaDecoder } = require('./media-decoder');
const { SpeechModelManager } = require('./models');
const voicesLib = require('./voices');
const { VOICE_MODEL } = voicesLib;
const { EngineRouter } = require('./engine/router');
const { Session } = require('./session');
const { createHandlers } = require('./handlers');
const { createMain, createIsland } = require('./windows');
const { png } = require('./icons');
const { clock } = require('./util');
const brand = require('./brand');
const { Dictation } = require('./dictation');
const { UsageReporter } = require('./usage');
const { SyncManager } = require('./sync');
const { Pairing } = require('./pairing');
const { AudioArchive, retentionUntil, purgeExpired } = require('./audio-archive');
const { Refiner } = require('./refiner');
const { isAppPage, validApiBase } = require('./origins');

// Keep existing encrypted data in its original profile after the display rename.
const inheritedUserData = app.getPath('userData');
const legacyUserData = path.join(app.getPath('appData'), 'ivuenu-desktop');
const defaultUserData = ['Ivueno', 'ivueno-desktop'].map((name) => path.join(app.getPath('appData'), name));
const requestedUserData = process.env.IVUENO_USER_DATA_DIR || process.env.IVUENU_USER_DATA_DIR || app.commandLine.getSwitchValue('user-data-dir');
app.setName('Ivueno');
if (requestedUserData) app.setPath('userData', path.resolve(requestedUserData));
else if (defaultUserData.includes(inheritedUserData) && fs.existsSync(path.join(legacyUserData, 'ivuenu-data.json'))
         && !fs.existsSync(path.join(inheritedUserData, 'ivuenu-data.json'))) app.setPath('userData', legacyUserData);
else app.setPath('userData', inheritedUserData);
app.setAppUserModelId('ao.ivueno.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

app.whenReady().then(() => {
const userData = app.getPath('userData');
const secure = new SecureStore(path.join(userData, 'ivuenu-secure.bin'), safeStorage);
const { LocalCipher } = require('./local-cipher');
const localCipher = new LocalCipher(secure);
// Each account has its own folder of local data (accounts.js). Data from the old single-folder layout moves into its owner's folder.
let activeId = accounts.getActive(userData);
const legacyFile = path.join(userData, accounts.DATA_FILE);
if (fs.existsSync(legacyFile)) {
  const legacyOwner = new Store(legacyFile, { cipher: localCipher }).data.accountId || (!activeId && secure.get('user')?.id) || null;
  if (legacyOwner && accounts.migrateLegacy(userData, legacyOwner) && !activeId) { accounts.setActive(userData, legacyOwner); activeId = legacyOwner; }
}
// The open account's data. Switching accounts (bindAccount) closes these and opens the other account's, without a restart:
// everything that belongs to one account is built by openStore() + openAccount() below and is replaced as a whole.
let dataDir = null;
let store = null;
function openStore() {
  dataDir = activeId ? accounts.accountDir(userData, activeId) : userData;
  store = new Store(path.join(dataDir, accounts.DATA_FILE), { cipher: localCipher });
  // The folder is the identity of its data: it always belongs to the account it is named after. Without a folder yet (nobody signed in), the signed-in account claims it.
  const folderOwner = activeId || secure.get('user')?.id;
  if (!store.data.accountId && folderOwner) {
    store.data.accountId = folderOwner;
    store.flush();
  }
}
openStore();
const apiBase = () => {
  let base = process.env.IVUENU_API_BASE || store.data.settings.apiBase;
  // An installed app always talks to the production server built into it: an address saved by an older version (an earlier host, or a local test
  // server from a development profile) must not keep an installed copy away from production. To use another server on purpose, set IVUENU_API_BASE.
  if (app.isPackaged && !process.env.IVUENU_API_BASE) base = DEFAULT_SETTINGS.apiBase;
  if (!validApiBase(base)) throw new Error('O servidor tem de usar HTTPS (HTTP apenas em localhost).');
  return base;
};
const isLocalApi = () => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(apiBase());

let mainWin = null;
let islandWin = null;
let tray = null;
let quitting = false;

const broadcast = (channel, payload) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
};

let syncRef = null;      // set below; a change to meetings asks it to sync soon
// Built per account by openAccount(): the meetings, the recording session, kept audio, imports, the accurate pass, sync, pairing, telemetry, and the request handlers.
let repo = null, session = null, importer = null, archive = null, refiner = null, telemetry = null, sync = null, pairing = null, handlers = null;
let accountGen = 0;      // bumped when an account closes: anything its objects still emit afterwards is dropped
let purgeTimer = null;
// Everything that needs AI runs in the cloud (the Ivueno server, which uses Groq): see engine/router.js. The demonstration engine only supplies the plain,
// rule-based text writers as a fallback (and the scripted conversation when IVUENU_ENGINE=demo, for development).
const demoEngine = createEngine('demo', { stepMs: Number(process.env.IVUENU_DEMO_STEP_MS) || 6000 });
let licenceRef = null;      // set below; the router asks which plan features are on
let apiRef = null;
const cloudEngine = new CloudEngine({
  api: { cloudTranscribe: (...a) => apiRef.cloudTranscribe(...a), cloudNotes: (...a) => apiRef.cloudNotes(...a), cloudAsk: (...a) => apiRef.cloudAsk(...a), cloudRecipe: (...a) => apiRef.cloudRecipe(...a),
    cloudSummarize: (...a) => apiRef.cloudSummarize(...a), cloudEmail: (...a) => apiRef.cloudEmail(...a), cloudClassify: (...a) => apiRef.cloudClassify(...a) },
  getSettings: () => store.data.settings, fallback: demoEngine,
});
const engine = new EngineRouter({ cloud: cloudEngine, demo: demoEngine, demoSpeech: process.env.IVUENU_ENGINE === 'demo', getSettings: () => store.data.settings, hasFeature: (f) => ((licenceRef && licenceRef.status().features) || []).includes(f) });
// Telling the voices of an imported recording apart needs one small model file (40 MB). The installer carries it (extraResources -> <install folder>/resources/models),
// so normally nothing is downloaded; the download in models.js stays as the fallback (e.g. a build made without it). See models.js and voices.js.
const bundledModels = app.isPackaged ? require('path').join(process.resourcesPath, 'models') : require('path').join(__dirname, '..', '..', 'assets', 'models');
const voiceDirs = [require('path').join(userData, 'models', 'voices'), bundledModels, require('path').join(require('os').homedir(), '.ivuenu', 'models', 'diarization')];
const voiceModelPath = () => { for (const dir of voiceDirs) { const f = require('path').join(dir, VOICE_MODEL.name); try { if (fs.statSync(f).size === VOICE_MODEL.sizeBytes) return f; } catch { /* not here */ } } return null; };
const voiceModels = new SpeechModelManager({
  dir: voiceDirs[0], name: VOICE_MODEL.name, single: true, sha256: VOICE_MODEL.sha256, sizeBytes: VOICE_MODEL.sizeBytes,
  url: (!app.isPackaged && process.env.IVUENU_VOICE_MODEL_URL) || VOICE_MODEL.url, allowInsecure: !app.isPackaged && !!process.env.IVUENU_VOICE_MODEL_URL,
  isInstalled: () => !!voiceModelPath(), freeBytes: () => services.freeDiskBytes(),
});
voiceModels.on('progress', (st) => broadcast('voices:progress', st));
const voices = { available: () => !!voiceModelPath(), modelPath: voiceModelPath, identify: voicesLib.identify };

// The accurate pass over a meeting's kept audio. The window decodes audio (Chromium has the decoders), so the refiner asks it for the samples of a block and waits.
const pendingDecodes = new Map();
function decodeInWindow(bytes) {
  return new Promise((resolve, reject) => {
    if (!mainWin || mainWin.isDestroyed()) { reject(Object.assign(new Error('no window'), { code: 'no_window' })); return; }
    const reqId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { pendingDecodes.delete(reqId); reject(Object.assign(new Error('decode timeout'), { code: 'decode_timeout' })); }, 90_000);
    pendingDecodes.set(reqId, { resolve, reject, timer });
    mainWin.webContents.send('refine:decode', { reqId, data: bytes });
  });
}
function decodeReply(reqId, pcm, error) {
  const pending = pendingDecodes.get(reqId);
  if (!pending) return;
  clearTimeout(pending.timer); pendingDecodes.delete(reqId);
  if (error || !pcm) pending.reject(Object.assign(new Error('decode failed'), { code: 'decode_failed' }));
  else pending.resolve(Buffer.from(pcm.buffer ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) : new Uint8Array(pcm)));
}
const api = new ApiClient({ getBase: apiBase, secure, deviceName: `Ivueno desktop em ${require('os').hostname()}` });
apiRef = api;
process.on('uncaughtExceptionMonitor', (err) => { if (telemetry) telemetry.error('main', err); });      // watches only: Electron still handles the crash as before
// Public keys that may sign licences, shipped inside the app. Empty in development (then the key is pinned on first
// sign-in). In a release build this list must hold the production key(s): see backend/scripts/make_licence_key.py.
function readKeyList(name) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', name), 'utf8')); } catch { return []; }
}
// Release keys always; the development key only when running from source, never in a packaged build.
function embeddedLicenceKeys() {
  return [...readKeyList('licence-public-keys.json'), ...(app.isPackaged ? [] : readKeyList('licence-public-keys.dev.json'))];
}
// What a packaged build must have: the release list alone.
const releaseKeyCount = () => readKeyList('licence-public-keys.json').length;
const licence = new LicenceManager({ secure, api, autoRepin: isLocalApi(), embeddedKeys: embeddedLicenceKeys() });
licenceRef = licence;

// --- services the handlers need from Electron -------------------------------------------------------

const services = {
  async gpuInfo() {
    try {
      const info = await app.getGPUInfo('basic');
      const dev = (info.gpuDevice || []).find((d) => d.vendorId === 0x10de || d.vendorId === 0x1002);
      return { hasDiscreteGpu: !!dev, name: dev ? `${dev.vendorId === 0x10de ? 'NVIDIA' : 'AMD'} ${dev.deviceString || ''}`.trim() : '' };
    } catch { return { hasDiscreteGpu: false }; }
  },
  async freeDiskBytes() {
    try { const s = fs.statfsSync(userData); return s.bavail * s.bsize; } catch { return 0; }
  },
  openExternal: (url) => shell.openExternal(url),
  async saveFile(name, buf, filters) {
    const r = await dialog.showSaveDialog(mainWin, { defaultPath: name, filters });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, buf);
    return { saved: true, name: path.basename(r.filePath), path: r.filePath };
  },
  writeClipboard: (text) => clipboard.writeText(text),
  // Dictation: put the text on the clipboard and press Ctrl+V (Windows) or Cmd+V (macOS) in whatever app has the focus
  // (the island never takes it), then give the clipboard back.
  async insertText(text) {
    const before = clipboard.readText();
    clipboard.writeText(text);
    const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => require('child_process').execFile(cmd, args, { timeout: 8000, ...opts }, (err) => (err ? reject(err) : resolve())));
    if (process.platform === 'win32') {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      // macOS lets an app press keys in another app only with Accessibility permission. The first time, this asks for it
      // (System Settings › Privacy & Security › Accessibility); until it is given, the text stays on the clipboard.
      if (!systemPreferences.isTrustedAccessibilityClient(false)) {
        systemPreferences.isTrustedAccessibilityClient(true);
        const e = new Error('accessibility'); e.code = 'accessibility'; throw e;
      }
      await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    } else { const e = new Error('unsupported'); e.code = 'unsupported'; throw e; }
    const t = setTimeout(() => { try { if (clipboard.readText() === text) clipboard.writeText(before); } catch { /* keep what we have */ } }, 700);
    if (t.unref) t.unref();
  },
  // Microphone permission. macOS keeps it per app and asks the person once: ask it here explicitly (the page's own request
  // does not always bring the prompt up). Elsewhere the page's request is enough.
  async micAccess() {
    if (process.platform !== 'darwin') return { status: 'granted' };
    let status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'not-determined') status = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
    return { status };
  },
  openMicSettings() {
    if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    else if (process.platform === 'win32') shell.openExternal('ms-settings:privacy-microphone');
  },
  revealFile: (file) => shell.showItemInFolder(file),
  async printPdf(html, { paper = 'A4' } = {}) {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await win.webContents.printToPDF({ pageSize: paper === 'Letter' ? 'Letter' : 'A4', printBackground: true });
    } finally { win.destroy(); }
  },
  async fetchText(url) {
    if (!/^https:/i.test(url)) throw Object.assign(new Error('Só são aceites endereços https.'), { code: 'invalid' });
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw Object.assign(new Error(`O calendário respondeu ${res.status}.`), { code: 'calendar_unreachable' });
    const text = await res.text();
    if (text.length > 8_000_000) throw Object.assign(new Error('O calendário é demasiado grande.'), { code: 'invalid' });
    return text;
  },
  async wipeLocal() {
    await sync.disable();
    sync.stop();
    for (const id of archive.ids()) archive.remove(id);
    store.wipe(); secure.clear({ keep: ['localDataKey'] });      // the data key stays: other accounts on this computer need it
    if (activeId) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* the folder is empty anyway */ } }
    broadcast('data:changed', { kind: 'all' });
  },
  setTheme: (t) => { nativeTheme.themeSource = t; },
  bindAccount(id) {
    const owner = store.data.accountId;
    if (!owner || owner === id) {          // nobody owned this data yet (it was made before signing in), or it is already this account's
      store.data.accountId = id;
      store.flush();
      return;
    }
    // Another account signs in on this computer: park the old account's own secrets in its folder, bring this account's back,
    // and point the app at this account's folder. The old account's data stays untouched.
    store.flush();
    try { accounts.stashKeys(secure, new SecureStore(path.join(accounts.accountDir(userData, owner), 'ivuenu-secure.bin'), safeStorage)); } catch { /* nothing to park */ }
    try { accounts.restoreKeys(secure, new SecureStore(path.join(accounts.accountDir(userData, id), 'ivuenu-secure.bin'), safeStorage)); } catch { /* a new account has none */ }
    accounts.setActive(userData, id);
    activeId = id;
    // The page shows "A abrir a tua conta…" at once (so the previous account's screens are never seen with this account
    // signed in). Once the sign-in call has answered, the app closes the previous account's data, opens this one's and
    // reloads the page behind the same screen. No restart.
    broadcast('account:switching');
    setTimeout(switchAccount, 0);
  },
  setIsland: () => syncIsland(session.snapshot()),
};

let flushWaiter = null;
services.audioFlushed = () => { if (flushWaiter) flushWaiter(); };

const dictation = new Dictation({ engine, getSettings: () => store.data.settings, insertText: (t) => services.insertText(t) });
const usage = new UsageReporter({ api, secure });

// Global hotkeys: one to dictate, one to open/close the island. Each reports whether Windows let us have it.
let hotkeyResult = { dictation: null, island: null };
// The island shortcut opens/closes the meeting controls, so it only does something while a meeting is being recorded
// (recording or paused). Otherwise (dictating, a meeting that has ended, nothing going on) it is ignored.
const inMeeting = () => session.phase === 'recording' || session.phase === 'paused';
function toggleIsland() {
  if (islandWin && !islandWin.isDestroyed() && islandWin.mode === 'expanded') { setIslandMode('collapsed'); return; }   // closing always works
  if (inMeeting()) setIslandMode('expanded');
}
function applyHotkeys() {
  globalShortcut.unregisterAll();
  const s = store.data.settings;
  const reg = (accel, fn) => { try { return accel ? globalShortcut.register(accel, fn) : null; } catch { return false; } };
  hotkeyResult = {
    dictation: s.dictation ? reg(s.hotkeyDictation, () => dictation.toggle()) : null,
    island: reg(s.hotkeyIsland, toggleIsland),
  };
  broadcast('data:changed', { kind: 'hotkeys' });
}
services.applyHotkeys = applyHotkeys;
services.hotkeyStatus = () => hotkeyResult;
services.refreshLanguage = () => {
  buildTray(session.snapshot());
  if (islandWin && !islandWin.isDestroyed()) islandWin.setTitle(nativeText('Ivueno · a gravar', 'Ivueno · recording', 'Ivueno · enregistrement'));
};

const mediaDecoder = new MediaDecoder();
app.on('before-quit', () => mediaDecoder.cancel());
// Updates: only in an installed build (a development run has nothing to update). See updater.js and docs/RELEASING.md.
const updater = new Updater({ autoUpdater: app.isPackaged ? require('electron-updater').autoUpdater : null, emit: broadcast, enabled: app.isPackaged });
updater.start();

/** Builds everything that belongs to the open account (store must be open). Each object here only ever sees this account's data. */
function openAccount() {
  const gen = ++accountGen;
  const live = () => gen === accountGen;
  const emit = (channel, payload) => { if (live()) broadcast(channel, payload); };
  const st = store;
  const r = new Repo(st, (kind, id) => { emit('data:changed', { kind, id }); if (live() && kind === 'meetings' && syncRef) syncRef.schedule(); });
  const s = new Session({ repo: r, engine });
  const imp = new AudioImporter({ repo: r, engine, voices, glossary: () => st.data.settings.glossary, tmpDir: require('os').tmpdir(), notes: (id) => s.generateNotes(id) });
  const arc = new AudioArchive({ dir: path.join(dataDir, 'audio'), cipher: localCipher });
  arc.migrate();
  const ref = new Refiner({ repo: r, engine, archive: arc, voices, notes: (id) => s.generateNotes(id), decode: decodeInWindow, policy: () => st.data.settings.audioKeep, glossary: () => st.data.settings.glossary });
  ref.on('progress', (p) => emit('refine:progress', p));

  // When a meeting ends with its audio kept: decide until when, and (unless the person turned it off) improve the transcript from that audio.
  s.on('finished', (id) => {
    const m = r.getMeeting(id);
    if (!m || !m.audio || !m.audio.keep) return;
    if (!arc.has(id)) { r.updateMeeting(id, { audio: null }); return; }
    r.updateMeeting(id, { audio: { ...m.audio, keepUntil: retentionUntil(st.data.settings.audioKeep, Date.now()) } });
    const mode = m.audio.mode || st.data.settings.refineMode;
    if (mode === 'voices' || mode === 'text') ref.run(id, { mode }).catch(() => {});
  });
  // Audio past its date is deleted when the account opens and every few hours after.
  for (const m of r.d.meetings) if (m.refine && m.refine.state === 'running') r.updateMeeting(m.id, { refine: { ...m.refine, state: 'failed', error: 'interrupted' } });      // the app closed in the middle of it
  const purgeAudio = () => { try { purgeExpired({ repo: r, archive: arc }); } catch (e) { console.error('[audio] purge failed:', e && e.message); } };
  purgeAudio();
  clearInterval(purgeTimer);
  purgeTimer = setInterval(purgeAudio, 6 * 60 * 60 * 1000);
  purgeTimer.unref();
  imp.on('progress', (p) => emit('import:progress', p));
  r.recoverImports();

  // How the app is used (never what is said in it): see main/telemetry.js. IVUENU_TELEMETRY=off switches it off for a run.
  const tel = new Telemetry({
    api, store: st, secure, version: app.getVersion(), platform: process.platform, packaged: app.isPackaged,
    getLocale: () => st.data.settings.appLanguage, enabled: process.env.IVUENU_TELEMETRY !== 'off',
  });
  const syn = new SyncManager({ repo: r, store: st, api, secure, emit: () => emit('data:changed', { kind: 'sync' }) });
  const pair = new Pairing({ api, secure, getBase: apiBase });

  s.beforeStop = () => new Promise((resolve) => {
    const timer = setTimeout(() => { flushWaiter = null; resolve(); }, 4000);
    flushWaiter = () => { clearTimeout(timer); flushWaiter = null; resolve(); };
    emit('audio:flush');
  });
  s.on('state', (snap) => {
    if (!live()) return;
    broadcast('rec:state', snap);
    syncIsland(snap);
    const key = `${snap.phase}|${Math.floor(snap.elapsedMs / 1000)}`;
    if (key !== lastTrayKey) { lastTrayKey = key; buildTray(snap); }
  });
  s.on('segment', (payload) => emit('rec:segment', payload));
  s.on('levels', (levels) => { if (live() && islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('rec:levels', levels); });
  s.on('notes-state', (payload) => emit('data:changed', { kind: 'notes', ...payload }));
  s.on('notes', (id) => emit('data:changed', { kind: 'notes', id }));

  repo = r; session = s; importer = imp; archive = arc; refiner = ref; telemetry = tel; sync = syn; syncRef = syn; pairing = pair;
  handlers = createHandlers({ repo: r, session: s, engine, api, licence, secure, services, dictation, usage, sync: syn, pairing: pair, archive: arc, refiner: ref, decodeReply, importer: imp, mediaDecoder, voices, voiceModels, updater, version: app.getVersion() });
}

/** Stops what the open account still has running. Its objects keep pointing at its own folder, so anything already under way finishes there. */
function closeAccount() {
  accountGen++;
  clearInterval(purgeTimer); purgeTimer = null;
  try { sync.stop(); } catch { /* not started */ }
  try { telemetry.stop(); } catch { /* not started */ }
  try { pairing.cancel().catch(() => {}); } catch { /* nothing waiting */ }
  try { store.flush(); } catch { /* written already */ }
}

/** Closes the open account and opens the active one (activeId) in place, then reloads the pages on it. */
function switchAccount() {
  closeAccount();
  if (islandWin && !islandWin.isDestroyed()) { islandWin.close(); islandWin = null; }
  openStore();
  openAccount();
  applyHotkeys();
  buildTray(session.snapshot());
  services.refreshLanguage();
  startAccount();
  // The page reloads itself on the new account and keeps showing "A abrir a tua conta…" until it is ready (App.jsx, #account).
  // (Loading the same address with only a new #hash from here would not reload it: the browser treats that as a jump within the page.)
  broadcast('account:ready');
}

/** What runs once an account is open: its settings take effect and it talks to the server. */
function startAccount() {
  nativeTheme.themeSource = store.data.settings.theme;
  telemetry.start();
  if (api.signedIn()) usage.flush().catch(() => {});
  sync.start();
  if (api.signedIn()) sync.syncNow().catch(() => {});
  if (api.signedIn()) licence.refresh().then(() => broadcast('licence:changed', licence.status())).catch(() => {});
}

let lastTrayKey = '';
openAccount();

// Allowed senders: our own pages only.
const senderIsApp = (e) => {
  const url = e.senderFrame ? e.senderFrame.url : '';
  return isAppPage(url) && e.senderFrame === e.sender.mainFrame && [mainWin, islandWin].some((win) => win && !win.isDestroyed() && win.webContents === e.sender);
};

ipcMain.handle('ivuenu:call', async (event, channel, arg) => {
  if (!senderIsApp(event)) return { error: { code: 'forbidden', message: 'Origem não permitida.' } };
  const publicCall = /^(auth:|sso:|onboarding:|system:|settings:)/.test(channel) || ['app:info', 'plans:list', 'licence:status', 'voices:status', 'hotkeys:status', 'referral:check', 'update:status'].includes(channel);
  if (!publicCall && (!api.signedIn() || secure.get('user')?.id !== store.data.accountId)) return { error: { code: 'not_authenticated', message: 'Entra na tua conta para abrir os dados locais.' } };
  const fn = handlers[channel];
  if (!Object.hasOwn(handlers, channel) || typeof fn !== 'function') return { error: { code: 'unknown_channel', message: `Pedido desconhecido: ${channel}` } };
  const startedAt = Date.now();
  try {
    const value = await fn(arg);
    telemetry.call(channel, Date.now() - startedAt, true);
    return { value };
  } catch (err) {
    telemetry.call(channel, Date.now() - startedAt, false, typeof err.code === 'string' ? err.code : 'error');
    const { code, message, stack, ...extra } = err;
    return { error: { code: err.code || 'error', message: err.message || 'Algo correu mal.', extra: { ...extra, status: err.status } } };
  }
});

const onApp = (channel, handler) => ipcMain.on(channel, (event, ...args) => { if (senderIsApp(event)) handler(event, ...args); });
onApp('telemetry:event', (event, e) => { if (e && typeof e === 'object') telemetry.track(e.name, e.props); });     // checked against the allowlist inside
onApp('rec:levels', (event, levels) => session.pushLevels(levels || {}));
onApp('island:expand', () => { if (inMeeting()) setIslandMode('expanded'); });
onApp('island:collapse', () => setIslandMode('collapsed'));
onApp('island:toggle', toggleIsland);
onApp('island:open-main', () => showMain());
onApp('island:hover', (event, over) => { if (islandWin && !islandWin.isDestroyed() && event.sender === islandWin.webContents) islandWin.setInteractive(!!over); });

// Window buttons of our own title bar (the window is frameless so it is one rounded surface).
onApp('win:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
onApp('win:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
});
onApp('win:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

// --- the island -------------------------------------------------------------------------------------

function setIslandMode(mode) {
  if (!islandWin || islandWin.isDestroyed()) return;
  // The pill never takes the keyboard (dictation types into the app that has it). Opened, it holds the quick-note field,
  // so it may take the keyboard until it is closed again.
  const typing = mode === 'expanded';
  // Only when it changes: re-applying it to the visible pill on every dictation state made Windows drop the focus
  // from the field the person was typing in.
  if (islandWin._focusable !== typing) { islandWin._focusable = typing; islandWin.setFocusable(typing); }
  // The window keeps its size and place (windows.js); the page turns one island into the other inside it.
  islandWin.place(mode);
  islandWin.webContents.send('island:mode', mode);
  if (typing) islandWin.focus();
}

function syncIsland(snap) {
  const dictating = dictation.phase !== 'idle';
  const want = (store.data.settings.island && ['recording', 'paused', 'writing', 'done'].includes(snap.phase)) || dictating;
  if (want && (!islandWin || islandWin.isDestroyed())) {
    islandWin = createIsland({ saved: store.data.settings.islandPos, onMoved: (p) => repo.patchSettings({ islandPos: p }) });
    islandWin.setTitle(nativeText('Ivueno · a gravar', 'Ivueno · recording', 'Ivueno · enregistrement'));
    islandWin.once('ready-to-show', () => islandWin.showInactive());
  } else if (!want && islandWin && !islandWin.isDestroyed()) {
    islandWin.close(); islandWin = null;
  }
}

// --- tray -------------------------------------------------------------------------------------------

// macOS: a one-colour template image at menu-bar size (18pt, with an @2x file picked automatically), which the system recolours
// for a light or dark bar. Rendered from assets/tray-template.svg by `npm run icons:mac`. Elsewhere: the colour brand icon.
function trayImage(recording) {
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', recording ? 'trayRecordingTemplate.png' : 'trayTemplate.png'));
    if (!img.isEmpty()) { img.setTemplateImage(true); return img; }
  }
  return brand.icon(32, recording);
}

// Keep the three window buttons readable in both themes.
function syncOverlay() {
  const dark = nativeTheme.shouldUseDarkColors;
  if (mainWin && !mainWin.isDestroyed() && mainWin.setTitleBarOverlay) {
    mainWin.setTitleBarOverlay({ color: dark ? '#151412' : '#F7F5F2', symbolColor: dark ? '#EDE9E3' : '#1F1D1A', height: 32 });
  }
}
nativeTheme.on('updated', syncOverlay);

function buildTray(snap) {
  const recording = snap.phase === 'recording' || snap.phase === 'paused';
  if (!tray) { tray = new Tray(trayImage(false)); tray.on('click', showMain); }
  tray.setImage(trayImage(snap.phase === 'recording'));
  const state = snap.phase === 'paused' ? nativeText('Em pausa', 'Paused', 'En pause') : nativeText('A gravar', 'Recording', 'Enregistrement');
  tray.setToolTip(recording ? `Ivueno · ${state} ${clock(snap.elapsedMs)}` : 'Ivueno');
  const writing = snap.phase === 'writing';
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(recording ? [
      { label: `${state} · ${clock(snap.elapsedMs)}`, enabled: false },
      snap.phase === 'paused'
        ? { label: nativeText('Retomar', 'Resume', 'Reprendre'), click: () => session.resume() }
        : { label: nativeText('Pausar', 'Pause', 'Mettre en pause'), click: () => session.pause() },
      { label: nativeText('Parar a gravação', 'Stop recording', 'Arrêter l’enregistrement'), click: () => session.stop() },
      { label: nativeText('Mostrar mini gravador', 'Show mini recorder', 'Afficher le mini-enregistreur'), click: () => setIslandMode('expanded') },
    ] : writing ? [
      { label: nativeText('A escrever as notas…', 'Writing the notes…', 'Rédaction des notes…'), enabled: false },
    ] : [
      // The same two answers as the "Nova reunião" dialog: each starts recording and is kept in the consent record.
      { label: nativeText('Começar a gravar', 'Start recording', 'Commencer l’enregistrement'), submenu: [
        { label: nativeText('Já avisei os participantes', 'I told the participants', 'J’ai prévenu les participants'), click: () => trayStart('confirmed') },
        { label: nativeText('Só eu (notas pessoais)', 'Just me (personal notes)', 'Juste moi (notes personnelles)'), click: () => trayStart('solo') },
      ] },
      { label: nativeText('Nova reunião…', 'New meeting…', 'Nouvelle réunion…'), click: () => sendToMain('tray:new-meeting') },
    ]),
    { type: 'separator' },
    { label: nativeText('Abrir a Ivueno', 'Open Ivueno', 'Ouvrir Ivueno'), click: showMain },
    { label: nativeText('Sair', 'Quit', 'Quitter'), click: quitApp },
  ]));
}

/** Shows the main window (creating it if it was closed) and sends it one event once its page is ready. */
function sendToMain(channel, payload) {
  const fresh = !mainWin || mainWin.isDestroyed();
  showMain();
  const wc = mainWin && !mainWin.isDestroyed() ? mainWin.webContents : null;
  if (!wc) return;
  if (fresh || wc.isLoading()) wc.once('did-finish-load', () => setTimeout(() => wc.send(channel, payload), 300));
  else wc.send(channel, payload);
}

/** Starts a meeting from the menu-bar icon with the saved defaults (place, notes style, language, transcript, hiding). */
async function trayStart(consent) {
  if (!store.data.onboarded || !api.signedIn() || secure.get('user')?.id !== store.data.accountId) { showMain(); return; }   // the app asks to sign in / finish setup
  const s = store.data.settings;
  const place = s.meetingPlace || 'both';
  // The main window captures the sound, so it has to exist; it stays where it is if it is already open.
  if (!mainWin || mainWin.isDestroyed()) openMain();
  try {
    await handlers['rec:start']({
      consent,
      input: { place, title: '', folderId: null, template: s.template, language: s.language === 'auto' ? null : s.language, translateTo: null, keepTranscript: s.keepTranscript, redact: s.redact, attendees: [], calendarEventId: null },
    });
    telemetry.track('feature', { name: 'meeting_start', place, consent, template: s.template, ok: true });
    sendToMain('navigate', { name: 'live' });
  } catch (err) {
    telemetry.track('feature', { name: 'meeting_start', place, consent, template: s.template, ok: false, code: err && err.code });
    const blocked = err && (err.code === 'limit_reached' || err.code === 'plan_required');
    if (blocked) { sendToMain('navigate', { name: 'plans' }); return; }
    showMain();
    dialog.showMessageBox({ type: 'warning', message: nativeText('Não foi possível começar a gravar.', 'Could not start recording.', 'Impossible de commencer l’enregistrement.'), detail: (err && err.message) || '' });
  }
}

function nativeText(pt, en, fr) {
  return ({ pt, en, fr })[store.data.settings.appLanguage] || pt;
}

dictation.on('state', (snap) => {
  broadcast('dictation:state', snap);
  syncIsland(session.snapshot());
  if (snap.phase !== 'idle' && islandWin && !islandWin.isDestroyed()) setIslandMode('collapsed');
});
onApp('dictation:levels', (event, levels) => { if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('rec:levels', levels); });

// --- app lifecycle ----------------------------------------------------------------------------------

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) { openMain(); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

function openMain() {
  mainWin = createMain({

    onClose: (event) => {
      const busy = session.phase === 'recording' || session.phase === 'paused' || session.phase === 'writing';
      if (!quitting && busy) { event.preventDefault(); mainWin.hide(); }      // keep recording in the background
    },
  });
  mainWin.on('closed', () => { mainWin = null; if (!quitting && process.platform !== 'darwin') app.quit(); });
}

async function quitApp() {
  const busy = session.phase === 'recording' || session.phase === 'paused';
  if (busy) {
    const r = await dialog.showMessageBox({
      type: 'question', buttons: [nativeText('Parar e sair', 'Stop and quit', 'Arrêter et quitter'), nativeText('Continuar a gravar', 'Keep recording', 'Continuer l’enregistrement')], defaultId: 1, cancelId: 1,
      message: nativeText('Está a decorrer uma gravação.', 'A recording is in progress.', 'Un enregistrement est en cours.'),
      detail: nativeText('Se saíres agora, a gravação pára e as notas são escritas primeiro.', 'If you quit now, recording stops and the notes are written first.', 'Si vous quittez maintenant, l’enregistrement s’arrête et les notes sont rédigées avant la fermeture.'),
    });
    if (r.response !== 0) return;
    await session.stop();
  }
  quitting = true; store.flush(); app.quit();
}

app.on('second-instance', showMain);
app.on('before-quit', () => {
  quitting = true; store.flush();
  telemetry.track('app_close', { session_s: Math.round((Date.now() - telemetry.startedAt) / 1000) }); telemetry.stop();
});
app.on('render-process-gone', (_e, _contents, details) => telemetry.track('error', { source: 'renderer', name: 'process_gone', reason: details && details.reason }));
app.on('child-process-gone', (_e, details) => telemetry.track('error', { source: 'main', name: 'child_gone', value: details && details.type, reason: details && details.reason }));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* the tray keeps the app alive while recording */ });

return app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // A packaged (release) app must carry the production licence public key. Without it the app would trust whatever key the
  // server shows on first sign-in, which is only acceptable while developing. Refuse to start instead of shipping that.
  if (app.isPackaged && releaseKeyCount() === 0) {
    dialog.showErrorBox('Ivueno', 'Esta versão foi criada sem a chave de licença (assets/licence-public-keys.json). Não pode ser usada.\n\nThis build was made without the licence key and cannot be used.');
    app.quit();
    return;
  }
  // An unpackaged run is the stock Electron.app, so the Dock would show Electron's icon. A packaged app gets build/icon.png from electron-builder.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png'));
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }
  telemetry.track('app_open', { signed_in: api.signedIn(), onboarded: !!store.data.onboarded, packaged: app.isPackaged, first_run: !store.data.installId, lang: store.data.settings.appLanguage });
  nativeTheme.themeSource = store.data.settings.theme;
  // Development only: IVUENU_RESET_ONBOARDING=1 opens the setup wizard again (the data and the sign-in stay).
  if (!app.isPackaged && process.env.IVUENU_RESET_ONBOARDING === '1') repo.setOnboarded(false);

  const ses = electronSession.defaultSession;
  // Microphone and computer sound for our own pages only; nothing else may ask for anything.
  ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    ['media', 'display-capture'].includes(permission) && contents && isAppPage(contents.getURL()) && details.isMainFrame === true && (!details.requestingUrl || isAppPage(details.requestingUrl))));
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    ['media', 'display-capture'].includes(permission) && contents && isAppPage(contents.getURL()) && details.isMainFrame === true && (!details.requestingUrl || isAppPage(details.requestingUrl)));
  // "Computer sound" = Windows loopback audio, taken through the screen-capture API with the picture thrown away.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.frame || !isAppPage(request.frame.url) || request.frame.parent) return callback({});
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  }, { useSystemPicker: false });

  openMain();
  mainWin.once('ready-to-show', syncOverlay);
  await brand.prewarm();         // the tray icons (not needed by the window, so it opens first)
  buildTray(session.snapshot());
  applyHotkeys();
  // Settings, telemetry, sync, and a quiet licence renewal (works offline: the stored one keeps working).
  startAccount();
});
}).catch((error) => {
  dialog.showErrorBox('Ivueno', `Não foi possível abrir os dados protegidos: ${error.message}`);
  app.quit();
});
