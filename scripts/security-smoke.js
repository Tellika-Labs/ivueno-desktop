const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ivuenu-security-smoke-'));
app.setPath('userData', directory);
BrowserWindow.prototype.show = function () {};
delete process.env.VITE_DEV_URL;
require('../src/main/index');

const deadline = setTimeout(() => { console.error('security smoke timed out'); app.exit(1); }, 20000);

app.whenReady().then(async () => {
  let window;
  for (let attempt = 0; attempt < 100; attempt++) {
    window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'));
    if (window && !window.webContents.isLoading()) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(window && !window.webContents.isLoading(), 'main renderer loaded');
  const settings = await window.webContents.executeJavaScript("window.ivuenu.invoke('settings:patch', { theme: 'dark' })");
  assert.equal(settings.theme, 'dark');
  const denied = await window.webContents.executeJavaScript("window.ivuenu.invoke('meetings:list').then(() => 'allowed', error => error.code)");
  assert.equal(denied, 'not_authenticated');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const saved = fs.readFileSync(path.join(directory, 'ivuenu-data.json'));
  assert.equal(saved.subarray(0, 8).toString(), 'IVUENU01');
  const attacker = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../src/preload/index.js'), sandbox: true, contextIsolation: true } });
  await attacker.loadURL('data:text/html,<h1>Untrusted</h1>');
  const forbidden = await attacker.webContents.executeJavaScript("window.ivuenu.invoke('settings:get').then(() => 'allowed', error => error.code)");
  assert.equal(forbidden, 'forbidden');
  console.log(JSON.stringify({ electron: process.versions.electron, encryptedStore: true, signedOutReadDenied: true, foreignSenderDenied: true }));
  clearTimeout(deadline);
  app.exit(0);
}).catch((error) => {
  console.error(error.message);
  clearTimeout(deadline);
  app.exit(1);
});
