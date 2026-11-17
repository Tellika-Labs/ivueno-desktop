// Real Settings/Sidebar UI, local IPC handlers and store. No real account or meeting content.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { Store } = require('../src/main/store');
const { Repo } = require('../src/main/repo');
const { createHandlers } = require('../src/main/handlers');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(root, '.french-smoke-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ivueno-french-interface-'));
app.setPath('userData', profile);
let win;
const deadline = setTimeout(() => { console.error('French interface check timed out'); app.exit(1); }, 45000);

app.whenReady().then(async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  fs.writeFileSync(path.join(fixture, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  fs.writeFileSync(path.join(fixture, 'main.jsx'), `
    import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
    import Settings from '../src/renderer/screens/Settings.jsx';import Sidebar from '../src/renderer/components/Sidebar.jsx';
    import {AppContext}from'../src/renderer/lib/app-context.js';import{setErrorLang,friendly}from'../src/renderer/lib/errors.mjs';
    import'../src/renderer/styles/tokens.css';import'../src/renderer/styles/app.css';
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'test-mic',label:'USB microphone'}];
    function Fixture(){const[settings,setSettings]=useState(null);
      useEffect(()=>{window.ivuenu.invoke('settings:get').then(setSettings)},[]);
      if(!settings)return null;setErrorLang(settings.appLanguage);
      document.documentElement.lang=settings.appLanguage;
      document.documentElement.dataset.theme=settings.theme;
      const patchSettings=async patch=>setSettings(await window.ivuenu.invoke('settings:patch',patch));
      return <AppContext.Provider value={{settings,patchSettings,info:{engine:{realTranscription:true}},route:{name:'settings',section:'perfil'},auth:{user:{name:'UI Test',email:'test@example.test',email_verified:true},licence:{plan:'pro'}},rec:{phase:'idle'},nav:()=>{},openStart:()=>{},toast:()=>{},logout:()=>{},refreshAuth:async()=>{}}}>
        <div style={{display:'flex',height:'100vh'}}><Sidebar/><Settings/></div>
        <div data-error>{friendly({code:'stt_failed'})}</div>
      </AppContext.Provider>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);`);
  fs.writeFileSync(path.join(fixture, 'preload.js'), `
    const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('ivuenu',{
      invoke:(channel,arg)=>ipcRenderer.invoke('french-smoke:call',channel,arg),on:()=>()=>{},send:()=>{}
    });`);
  await build({ configFile: false, root: fixture, base: './', plugins: [react()], logLevel: 'error', build: { outDir: 'dist' } });
  const file = path.join(profile, 'settings.json');
  const store = new Store(file);
  const repo = new Repo(store);
  repo.patchSettings({ appLanguage: 'en', language: 'es', theme: 'light' });
  const handlers = createHandlers({ repo, services: { refreshLanguage() {}, setTheme() {} }, api: { signedIn: () => true }, licence: {}, secure: {} });
  ipcMain.handle('french-smoke:call', (_, channel, arg) => {
    if (channel === 'folders:list') return [];
    if (channel === 'tasks:overview') return { open: [], overdue: [], total: 0 };
    if (channel === 'cloud:usage') return { minutes_used: 0, minutes_limit: 600 };
    if (channel === 'audio:usage') return { meetings: 0, bytes: 0 };
    if (!['settings:get', 'settings:patch'].includes(channel)) throw new Error('Unexpected UI check channel');
    return handlers[channel](arg);
  });
  win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(fixture, 'preload.js'), sandbox: true, contextIsolation: true } });
  const js = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    for(let i=0;i<200;i++){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,25));}
    throw new Error('UI check did not complete: '+code);
  };
  await win.loadFile(path.join(fixture, 'dist/index.html'));
  await until('!!document.querySelector("#st-lang")');
  await js('document.querySelector("#st-lang").click()');
  await until('!!document.querySelector("[role=listbox]")');
  assert.ok(await js('document.querySelector("[role=option][data-picker-value=fr]").textContent.includes("Français")'));
  await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"f",bubbles:true}))');
  await until('document.activeElement.dataset.pickerValue==="fr"');
  await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await until('!document.querySelector("[role=listbox]")');
  assert.equal(await js('document.activeElement.id'), 'st-lang');
  assert.equal(repo.settings().appLanguage, 'en');
  await js('document.querySelector("#st-lang").click()');
  await until('!!document.querySelector("[role=listbox]")');
  await js('document.querySelector("h1").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
  await until('!document.querySelector("[role=listbox]")');
  await js('document.querySelector("#st-lang").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
  await until('!!document.querySelector("[role=listbox]")');
  await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))');
  await until('document.activeElement.dataset.pickerValue==="fr"');
  await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
  await until('document.querySelector("h1").textContent==="Paramètres"');
  assert.match(await js('document.querySelector(".sidebar").textContent'), /Accueil/);
  assert.match(await js('document.querySelector(".sidebar").textContent'), /Nouvelle réunion/);
  assert.equal(await js('document.documentElement.lang'), 'fr');
  assert.equal(repo.settings().language, 'es');
  store.flush();
  assert.equal(new Repo(new Store(file)).settings().appLanguage, 'fr');
  const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.reload();
  await reloaded;
  await until('document.querySelector("h1")?.textContent==="Paramètres"');
  const screenshots = [];
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await js('document.querySelector("#st-theme").click()');
      await until('!!document.querySelector("[role=listbox]")');
      await js('document.querySelector("[role=option][data-picker-value=dark]").click()');
      await until('document.documentElement.dataset.theme==="dark"');
      assert.equal(repo.settings().theme, 'dark');
    }
    await js('document.querySelector("#st-lang").click()');
    await until('!!document.querySelector("[role=listbox]")');
    const menu = await js('(()=>{const r=document.querySelector("[role=listbox]").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
    assert.ok(menu.left >= 0 && menu.right <= menu.width && menu.top >= 0 && menu.bottom <= menu.height);
    const color = await js('getComputedStyle(document.querySelector("[role=option][aria-selected=true]")).backgroundColor');
    assert.equal(color, theme === 'light' ? 'rgb(183, 245, 216)' : 'rgb(35, 75, 62)');
    win.setContentSize(1281, 900);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const screenshot = path.join(profile, `french-settings-${theme}.png`);
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG()); screenshots.push(screenshot);
    await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await until('!document.querySelector("[role=listbox]")');
  }
  await js('document.querySelector("#tab-grav").click()');
  await until('!!document.querySelector("#st-mic")');
  await js('document.querySelector("#st-mic").click()');
  await until('!!document.querySelector("[data-picker-value=test-mic]")');
  await js('document.querySelector("[data-picker-value=test-mic]").click()');
  assert.equal(repo.settings().micId, 'test-mic');
  await js('document.querySelector("#st-ns").click()');
  await until('!!document.querySelector("[data-picker-value=minutes]")');
  await js('document.querySelector("[data-picker-value=minutes]").click()');
  assert.equal(repo.settings().template, 'minutes');
  await js('document.querySelector("#st-keep").click()');
  await until('!!document.querySelector("[data-picker-value=off]")');
  await js('document.querySelector("[data-picker-value=off]").click()');
  await until('document.querySelector("#st-after").disabled');
  assert.equal(repo.settings().audioKeep, 'off');
  await js('document.querySelector("#st-after").click()');
  assert.equal(await js('document.querySelectorAll("[role=listbox]").length'), 0);
  assert.equal(await js('document.querySelectorAll("select").length'), 0);
  console.log(JSON.stringify({ frenchSelectable: true, keyboardAndTypeahead: true, escapeAndOutsideClick: true, lightAndDarkMenus: true, themeMicTemplateAndRetention: true, disabledPicker: true, settingsAndSidebarTranslated: true, survivesReload: true, spokenLanguageUnchanged: true, screenshots }));
  clearTimeout(deadline); win.destroy();
  if(!fixture.startsWith(root+path.sep+'.french-smoke-'))throw new Error('Unexpected fixture path');
  fs.rmSync(fixture,{recursive:true,force:true});app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(deadline);win?.destroy();app.exit(1)});
