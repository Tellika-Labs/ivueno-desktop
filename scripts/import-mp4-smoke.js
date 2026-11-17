// Real import dialog + Electron IPC + native decoder, with a fake speech service (no uploads or charges).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { MediaDecoder, binaryPath } = require('../src/main/media-decoder');
const { AudioImporter } = require('../src/main/importer');
const { Store } = require('../src/main/store');
const { Repo } = require('../src/main/repo');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(root, '.import-smoke-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ivueno-import-smoke-'));
app.setPath('userData', profile);
let win;
const decoder = new MediaDecoder({ tmpDir: profile });
const deadline = setTimeout(() => { decoder.cancel(); console.error('MP4 import smoke timed out'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const media = path.join(profile, 'WhatsApp Audio.mp4');
  execFileSync(binaryPath(), ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', media], { windowsHide: true });
  // A valid MP4 free atom raises the file size above the direct-upload limit.
  const padding = Buffer.alloc(49500000 - fs.statSync(media).size);
  padding.writeUInt32BE(padding.length, 0); padding.write('free', 4);
  fs.appendFileSync(media, padding);
  fs.writeFileSync(path.join(fixture, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  fs.writeFileSync(path.join(fixture, 'main.jsx'), `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import ImportDialog from '../src/renderer/components/ImportDialog.jsx';
    import {AppContext} from '../src/renderer/lib/app-context.js';
    import '../src/renderer/styles/tokens.css'; import '../src/renderer/styles/app.css';
    OfflineAudioContext.prototype.decodeAudioData=async()=>{throw new Error('Unsupported browser codec')};
    const data=await window.ivuenu.invoke('fixture:file');
    createRoot(document.getElementById('root')).render(<AppContext.Provider value={{settings:{appLanguage:'en'},nav:()=>{},toast:()=>{}}}>
      <ImportDialog initialFile={new File([data],'WhatsApp Audio 2026-11-04.mp4',{type:'video/mp4'})} onClose={()=>{}}/>
    </AppContext.Provider>);`);
  fs.writeFileSync(path.join(fixture, 'preload.js'), `
    const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('ivuenu',{
      invoke:(channel,arg)=>ipcRenderer.invoke('import-smoke:call',channel,arg),
      on:()=>()=>{},send:()=>{}
    });`);
  await build({ configFile: false, root: fixture, base: './', plugins: [react()], logLevel: 'error', build: { outDir: 'dist' } });
  const repo = new Repo(new Store(path.join(profile, 'data.json')));
  let nativeCalls = 0, pieces = 0, result;
  const importer = new AudioImporter({ repo, tmpDir: profile, notes: async () => {},
    engine: { canTranscribeFile: () => true, transcribeAudio: async (req) => {
      assert.equal(req.language, 'fr');
      assert.equal(req.mime, 'audio/wav'); assert.equal(Buffer.from(req.data).subarray(0, 4).toString(), 'RIFF'); pieces++;
      return { language: 'french', segments: Array.from({ length: 7 }, (_, i) => ({ start_ms: i * 200, end_ms: i * 200 + 180, text: 'Intervenant de test ' + i })) };
    } },
    voices: { available: () => true, modelPath: () => 'fixture', identify: async (job) => {
      assert.equal(job.voices, 7); return { voices: 7, assignments: job.segments.map((_, i) => i) };
    } },
  });
  ipcMain.handle('import-smoke:call', async (_, channel, arg) => {
    if (channel === 'fixture:file') return fs.readFileSync(media);
    if (channel === 'import:available') return { ready: true, voices: true };
    if (channel === 'voices:status') return { state: 'ready' };
    if (channel === 'import:decode') { nativeCalls++; return decoder.decode(arg.data); }
    if (channel === 'import:decodeCancel') return decoder.cancel();
    if (channel === 'import:begin') return importer.begin(arg);
    if (channel === 'import:piece') return importer.piece(arg.id, arg);
    if (channel === 'import:pcm') return importer.pcm(arg.id, arg);
    if (channel === 'import:finish') { result = await importer.finish(arg.id); return result; }
    if (channel === 'import:cancel') return importer.cancel(arg.id);
    throw new Error('Unexpected smoke channel');
  });
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(fixture, 'preload.js'), sandbox: true, contextIsolation: true } });
  await win.loadFile(path.join(fixture, 'dist', 'index.html'));
  const js = code => win.webContents.executeJavaScript(code);
  for (let i = 0; i < 200 && !(await js('!!document.querySelector("#imp-language")')); i++) await new Promise(r => setTimeout(r, 25));
  await js('document.querySelector("#imp-language").click()');
  assert.deepEqual(await js('[...document.querySelectorAll("[role=option]")].map(o=>o.dataset.pickerValue)'), ['auto', 'pt', 'en', 'fr', 'es']);
  await js('document.querySelector("[role=option]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.ok(await js('!!document.querySelector("[role=dialog]")'), 'Escape closes the dropdown without closing the import dialog');
  assert.equal(await js('document.activeElement.id'), 'imp-language');
  await js('document.querySelector("#imp-language").click()');
  await js('document.querySelector("[role=option][data-picker-value=fr]").click()');
  await js('document.querySelector("#imp-people").click()');
  await js('[...document.querySelectorAll("[role=option]")].find(o=>o.dataset.pickerValue==="7").click()');
  await js('document.querySelectorAll("input[type=checkbox]")[1].click()');
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Import and transcribe').click()`);
  for (let i = 0; i < 1000 && !result; i++) await new Promise(r => setTimeout(r, 25));
  assert.ok(result, await js('document.body.innerText'));
  assert.equal(result.voices, 7); assert.equal(nativeCalls, 1); assert.equal(pieces, 1);
  assert.equal(repo.getMeeting(result.meeting.id).segments.length, 7);
  assert.equal(repo.getMeeting(result.meeting.id).language, 'fr');
  assert.ok(repo.getMeeting(result.meeting.id).segments.every(line => line.language === 'french'));
  assert.equal(fs.readdirSync(profile).some(name => name.startsWith('ivueno-decode-') || name.endsWith('.pcm')), false);
  console.log(JSON.stringify({ mp4Bytes: fs.statSync(media).size, nativeFallback: true, wavUploadPieces: pieces, voicesRequested: 7, spokenLanguage: 'fr', fourLanguageOptions: true, importCompleted: true, temporaryAudioRemoved: true }));
  clearTimeout(deadline); win.destroy();
  if (!fixture.startsWith(root + path.sep + '.import-smoke-')) throw new Error('Unexpected fixture path');
  fs.rmSync(fixture, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(deadline); decoder.cancel(); app.exit(1); });
