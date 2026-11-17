// Exercise the real checkout component, production CSP and navigation guards in
// Chromium. All WiPay pages and payment outcomes are local fixtures; no charges.
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { createHandlers } = require('../src/main/handlers');
const { lockDown } = require('../src/main/windows');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(root, '.payment-smoke-'));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ivuenu-payment-ui-')));
const checkout = 'https://pay.wiza.ao/?id=fixture-payment&nonce=fixture';
let win;
const navigation = [];
const report = result => fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify(result, null, 2));
report({ status: 'starting' });
const deadline = setTimeout(() => { report({ status: 'failed', error: 'Embedded checkout check timed out' }); console.error('Embedded checkout check timed out'); app.exit(1); }, 45000);

app.whenReady().then(async () => {
  report({ status: 'building' });
  const { build } = await import('vite');
  const config = (await import('../vite.config.mjs')).default;
  fs.writeFileSync(path.join(fixture, 'index.html'), '<html><head></head><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  fs.writeFileSync(path.join(fixture, 'main.jsx'), `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Checkout from '../src/renderer/screens/Checkout.jsx';
    import {AppContext} from '../src/renderer/lib/app-context.js';
    import '../src/renderer/styles/tokens.css'; import '../src/renderer/styles/app.css'; import '../src/renderer/styles/checkout.css';
    createRoot(document.getElementById('root')).render(<AppContext.Provider value={{
      settings:{appLanguage:'en',theme:'light',autoTours:false},route:{name:'checkout',resume:true},
      auth:{user:{name:'Payment Test',email:'payment@example.test',email_verified:true}},
      nav:()=>{},toast:()=>{},refreshAuth:()=>window.ivuenu.invoke('fixture:refreshAuth')
    }}><Checkout/></AppContext.Provider>);`);
  fs.writeFileSync(path.join(fixture, 'preload.js'), `
    const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('ivuenu',{
      invoke:async(channel,arg)=>{const r=await ipcRenderer.invoke('payment-smoke:call',channel,arg);if(r?.error)throw r.error;return r},
      on:()=>()=>{},send:()=>{}
    });`);
  await build({ configFile: false, root: fixture, base: './', plugins: config.plugins, logLevel: 'error', build: { outDir: 'dist' } });
  report({ status: 'loading' });

  let status = 'pending';
  let review = false;
  let secondsLeft = 0;
  let licenceRefreshes = 0;
  let authRefreshes = 0;
  const opened = [];
  const requested = [];
  const intent = () => ({ id: 'intent', plan: 'pro', months: 1, amount: '500.00', currency: 'AOA', status,
    vat_percent: 14, paid_until_if_paid_now: '2026-12-08T00:00:00Z' });
  const attempt = () => ({ id: 'attempt', method: 'wipay', status, checkout_url: status === 'pending' ? checkout : null,
    submitted: true, seconds_left: secondsLeft, confirming: secondsLeft === 0, requires_manual_review: review });
  const handlers = createHandlers({ repo: {}, secure: {}, services: { openExternal: async url => opened.push(url) },
    licence: { refresh: async () => { licenceRefreshes++; } }, api: {
      signedIn: () => true,
      billingSubscription: async () => ({ pending_intent: intent() }),
      billingIntent: async () => ({ ...intent(), attempts: [attempt()] }),
      billingMethods: async () => [{ id: 'wipay', name: 'WiPay', kind: 'hosted' }],
      attempt: async () => ({ intent: intent(), attempt: attempt() }),
      reportPaymentPaid: async () => { review = true; return { intent: intent(), attempt: attempt() }; },
    } });
  ipcMain.handle('payment-smoke:call', (event, channel, arg) => {
    if (event.senderFrame !== win.webContents.mainFrame) return { error: { code: 'forbidden' } };
    if (channel === 'plans:list') return [{ id: 'pro', name: 'Pro', price_aoa_month: 500 }];
    if (channel === 'fixture:refreshAuth') { authRefreshes++; return {}; }
    if (!channel.startsWith('billing:')) throw new Error('Unexpected fixture channel: ' + channel);
    return handlers[channel](arg);
  });
  await session.defaultSession.protocol.handle('https', request => {
    requested.push(request.url);
    if (new URL(request.url).hostname === 'challenges.cloudflare.com') {
      return new Response('<!doctype html><script>parent.postMessage({fixtureVerification:true},"https://pay.wiza.ao")</script>',
        { headers: { 'content-type': 'text/html' } });
    }
    return new Response('<!doctype html><html><body><h1>WiPay payment fixture</h1><label>Phone <input id="phone"></label><div id="countdown">01:30</div><button id="verify">Verify payment</button><script>parent.postMessage({status:"paid"},"*");document.querySelector("#verify").onclick=()=>{const frame=document.createElement("iframe");frame.src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/fixture";document.body.appendChild(frame)};addEventListener("message",e=>{if(e.origin==="https://challenges.cloudflare.com"&&e.data.fixtureVerification)document.body.dataset.verified="true"})</script></body></html>',
      { headers: { 'content-type': 'text/html' } });
  });
  shell.openExternal = async url => { opened.push(url); };
  win = new BrowserWindow({ show: false, width: 1280, height: 1000,
    webPreferences: { preload: path.join(fixture, 'preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  lockDown(win);
  win.webContents.on('will-frame-navigate', event => navigation.push({ url: event.url, main: event.isMainFrame, frame: event.frame?.url, initiator: event.initiator?.url }));
  const js = code => win.webContents.executeJavaScript(code);
  const until = async code => {
    for (let n = 0; n < 250; n++) {
      if (await js(code)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('UI check did not complete: ' + code);
  };
  await win.loadFile(path.join(fixture, 'dist/index.html'));
  report({ status: 'checking' });
  await until('!!document.querySelector("iframe")');
  for (let n = 0; n < 100 && !win.webContents.mainFrame.frames.find(frame => frame.url === checkout); n++) {
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const frame = win.webContents.mainFrame.frames.find(candidate => candidate.url === checkout);
  assert.ok(frame, 'WiPay frame loaded through production CSP');
  assert.equal(await frame.executeJavaScript('typeof window.ivuenu'), 'undefined', 'remote frame has no app bridge');
  assert.equal(await frame.executeJavaScript('typeof require'), 'undefined', 'remote frame has no Node access');
  assert.deepEqual(opened, [], 'checkout did not launch the browser');
  assert.equal(authRefreshes, 0, 'a page message cannot activate the subscription');
  await frame.executeJavaScript('document.querySelector("#verify").click()');
  for (let n = 0; n < 60; n++) {
    if (await frame.executeJavaScript('document.body.dataset.verified === "true"')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await frame.executeJavaScript('document.body.dataset.verified'), 'true', 'WiPay can complete its nested payment verification');
  await frame.executeJavaScript('document.querySelector("#phone").value="923456789"');
  await new Promise(resolve => setTimeout(resolve, 3300));
  assert.equal(await frame.executeJavaScript('document.querySelector("#phone").value'), '923456789', 'polling preserves payment input');
  assert.equal(requested.filter(url => url === checkout).length, 1, 'polling does not restart the countdown');
  const returnPage = 'https://api.example.test/account/payment/success';
  await frame.executeJavaScript(`setTimeout(()=>location.href=${JSON.stringify(returnPage)},50);true`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(frame.url, checkout, 'browser-return navigation leaves the checkout open');
  assert.equal(authRefreshes, 0, 'a return URL cannot activate the subscription');
  assert.equal(requested.includes(returnPage), false, 'the non-frameable return page is never loaded');
  await js(`(()=>{const frame=document.createElement('iframe');frame.id='foreign-frame';frame.src='https://evil.example/';document.body.appendChild(frame)})()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(requested.some(url => url.startsWith('https://evil.example/')), false, 'native host guard blocks foreign frames');
  await js(`document.querySelector('#foreign-frame').remove()`);
  fs.writeFileSync(path.join(fixture, 'embedded.png'), (await win.webContents.capturePage()).toPNG());
  await js(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Open in browser').click()`);
  await until('true');
  assert.deepEqual(opened, [checkout], 'fallback reuses the same payment');
  await js(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='I already confirmed payment on my phone').click()`);
  await until('document.body.textContent.includes("We are checking your payment")');
  assert.equal(await js('!!document.querySelector("iframe")'), false, 'a customer payment report removes the conflicting provider page');
  assert.equal(licenceRefreshes, 0, 'a payment report cannot activate a plan');
  assert.equal(authRefreshes, 0);
  status = 'paid';
  review = false;
  await until('document.body.textContent.includes("Payment confirmed")');
  assert.equal(await js('!!document.querySelector("iframe")'), false, 'confirmed payment removes the remote page');
  assert.equal(licenceRefreshes, 1, 'server confirmation refreshes the licence');
  assert.equal(authRefreshes, 1);
  // Independent happy path: a backend confirmation must end checkout while
  // there is still time on the payment countdown, without a customer report.
  status = 'pending'; review = false; secondsLeft = 120;
  await win.loadFile(path.join(fixture, 'dist/index.html'));
  await until('!!document.querySelector("iframe")');
  const confirmedAt = Date.now();
  status = 'paid';
  await until('document.body.textContent.includes("Payment confirmed")');
  const confirmationUiMs = Date.now() - confirmedAt;
  assert.ok(confirmationUiMs < 8000, 'the UI must not wait for the 120-second countdown');
  assert.equal(licenceRefreshes, 2);
  assert.equal(authRefreshes, 2);
  const result = { status: 'passed', embedded: true, customerPaymentReport: true, nestedPaymentVerification: true, noAutomaticBrowser: true, pollingPreservesInput: true, foreignFramesBlocked: true,
    remoteBridgeDenied: true, returnWaitsForBackend: true, confirmationRefreshesLicence: true,
    automaticConfirmationBeforeCountdown: true, confirmationUiMs,
    screenshot: path.join(fixture, 'embedded.png') };
  report(result);
  console.log(JSON.stringify(result));
  clearTimeout(deadline);
  app.exit(0);
}).catch(error => { report({ status: 'failed', error: error.stack, navigation }); console.error(error.stack); clearTimeout(deadline); app.exit(1); });
