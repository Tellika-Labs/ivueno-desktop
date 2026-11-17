// Real Chromium check of the rename dialog, IPC handler and meeting refresh.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { Store } = require('../src/main/store');
const { Repo } = require('../src/main/repo');
const { createHandlers } = require('../src/main/handlers');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(root, '.speaker-smoke-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ivueno-speaker-smoke-'));
app.setPath('userData', profile);
let win;
const deadline = setTimeout(() => { console.error('speaker rename smoke timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  fs.writeFileSync(path.join(fixture, 'index.html'), '<html><head></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>');
  fs.writeFileSync(path.join(fixture, 'fixture.jsx'), `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AppContext} from '../src/renderer/lib/app-context.js';
    import {useMeeting} from '../src/renderer/lib/hooks.js';
    import SpeakerName from '../src/renderer/components/SpeakerName.jsx';
    import '../src/renderer/styles/tokens.css'; import '../src/renderer/styles/app.css';
    function Fixture(){
      const {data:m}=useMeeting(new URLSearchParams(location.search).get('id'));
      return <AppContext.Provider value={{settings:{appLanguage:'pt'}}}>
        {m && <><SpeakerName meetingId={m.id} speaker={m.speakers.find(s=>s.key==='spk_1')} chip />
        {m.segments.map(s=><p data-segment key={s.id}><SpeakerName meetingId={m.id} speaker={m.speakers.find(p=>p.key===s.speakerKey)} />{s.text}</p>)}</>}
      </AppContext.Provider>;
    } createRoot(document.getElementById('root')).render(<Fixture/>);`);
  fs.writeFileSync(path.join(fixture, 'preload.js'), `
    const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('ivuenu',{
      invoke:(channel,arg)=>ipcRenderer.invoke('speaker-smoke:call',channel,arg),
      on:(channel,callback)=>{const fn=(_,data)=>callback(data);ipcRenderer.on(channel,fn);return()=>ipcRenderer.removeListener(channel,fn);}
    });`);
  await build({ configFile: false, root: fixture, base: './', plugins: [react()], logLevel: 'error', build: { outDir: 'dist' } });
  const store = new Store(path.join(profile, 'data.json'));
  const repo = new Repo(store, (kind, id) => win?.webContents.send('data:changed', { kind, id }));
  const m = repo.createMeeting({ title: 'Speaker rename UI check' });
  repo.addSegments(m.id, [{ text: 'First.', speakerKey: 'spk_1' }, { text: 'Second.', speakerKey: 'spk_1' }, { text: 'Other.', speakerKey: 'spk_2' }]);
  const handlers = createHandlers({ repo, session: {}, engine: {}, api: {}, licence: {}, secure: { get: () => ({ name: 'Test' }) }, services: {} });
  ipcMain.handle('speaker-smoke:call', (_, channel, arg) => {
    if (!['meetings:get', 'speakers:rename'].includes(channel)) throw new Error('unsupported smoke channel');
    return handlers[channel](arg);
  });
  win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { preload: path.join(fixture, 'preload.js'), sandbox: true, contextIsolation: true } });
  await win.loadFile(path.join(fixture, 'dist', 'index.html'), { query: { id: m.id } });
  const js = (code) => win.webContents.executeJavaScript(code);
  async function until(code) {
    for (let n = 0; n < 100; n++) { if (await js(code)) return; await new Promise(r => setTimeout(r, 30)); }
    throw new Error(`UI condition not reached: ${code}`);
  }
  await until('document.querySelectorAll("[data-segment]").length===3');
  await js('document.querySelector(".spk-chip").click()');
  await until('!!document.querySelector("[role=dialog] input")');
  await js('document.querySelector("[role=dialog] input").focus()');
  await win.webContents.insertText('Carlos Silva');
  // A blur must not silently discard the edited name.
  await js('document.querySelector("[role=dialog] button[type=submit]").focus()');
  assert.equal(await js('document.querySelector("[role=dialog] input").value'), 'Carlos Silva');
  await js('document.querySelector("[role=dialog] form").requestSubmit()');
  await until('!document.querySelector("[role=dialog]") && [...document.querySelectorAll("[data-segment] .speaker-name span")].map(n=>n.textContent).join("|")==="Carlos Silva|Carlos Silva|Orador 2"');
  repo.addSegments(m.id, [{ text: 'Future.', speakerKey: 'spk_1' }]);
  await until('document.querySelectorAll("[data-segment]").length===4');
  assert.equal(await js('document.querySelectorAll("[data-segment] .speaker-name span")[3].textContent'), 'Carlos Silva');
  await js('document.querySelector(".spk-chip").click()');
  await until('!!document.querySelector("[role=dialog] input")');
  await js('document.querySelector("[role=dialog] input").select()');
  await win.webContents.insertText('Unsaved name');
  await js('[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent==="Cancelar").click()');
  assert.equal(repo.speakerName(m, 'spk_1'), 'Carlos Silva');
  console.log(JSON.stringify({ allExistingPhrasesRenamed: true, futurePhraseRenamed: true, blurPreservesDraft: true, cancelPreservesSavedName: true }));
  clearTimeout(deadline);
  win.destroy();
  if (!fixture.startsWith(root + path.sep + '.speaker-smoke-')) throw new Error('unexpected fixture path');
  fs.rmSync(fixture, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => { console.error(error); clearTimeout(deadline); app.exit(1); });
