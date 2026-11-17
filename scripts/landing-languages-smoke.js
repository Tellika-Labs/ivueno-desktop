// Verify built landing routes in real Chromium, including French mobile layout.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../landing/dist');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ivueno-landing-languages-'));
app.setPath('userData', profile);
let server, win;
const report = result => fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
report({ status: 'starting' });
const deadline = setTimeout(() => { report({ status: 'failed', error: 'Landing language check timed out' }); console.error('Landing language check timed out'); app.exit(1); }, 45000);

app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { console.error('Browser check failed:', code); throw error; } };
  for (const [route, lang] of [['/', 'pt-AO'], ['/en/', 'en'], ['/fr/', 'fr']]) {
    await win.loadURL(base + route);
    assert.equal(await js('document.documentElement.lang'), lang);
    assert.equal(await js('document.querySelectorAll("[data-language-link]").length'), 3);
    assert.equal(await js('new URL(document.querySelector("[data-language-link][aria-current=page]").href).pathname'), route);
    assert.ok(await js('!!document.querySelector("link[hreflang=fr][rel=alternate]")'));
  }
  await js('document.fonts.ready.then(()=>true)');
  assert.match(await js('document.title'), /Vos notes de réunion/);
  assert.match(await js('document.querySelector("link[rel=canonical]").href'), /\/fr\/$/);
  assert.equal(await js(`document.querySelector('meta[property="og:locale"]').content`), 'fr_FR');
  assert.match(await js('document.querySelector("#como h2").textContent'), /Avant, pendant et après/);
  assert.match(await js('document.querySelector("#faq-title").textContent'), /Questions fréquentes/);
  assert.match(await js('document.querySelector(".leaf-head").textContent'), /[a-zéû]/);
  assert.equal(await js('document.querySelector("[data-waitlist]").dataset.lang'), 'fr');
  await js('document.querySelector(".language-menu summary").click()');
  assert.equal(await js('document.querySelector(".language-menu").open'), true);
  await js('document.querySelector(".language-menu summary").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
  assert.equal(await js('document.activeElement.getAttribute("lang")'), 'pt-AO');
  await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))');
  assert.equal(await js('document.activeElement.getAttribute("lang")'), 'fr');
  await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.equal(await js('document.querySelector(".language-menu").open'), false);
  assert.equal(await js('document.activeElement.tagName'), 'SUMMARY');
  await js('document.querySelector(".language-menu summary").click();document.querySelector("h1").click()');
  assert.equal(await js('document.querySelector(".language-menu").open'), false);
  const frenchErrors = [];
  win.webContents.on('console-message', event => { if (event.message.includes('Uncaught')) frenchErrors.push(event.message); });
  const desktop = path.join(profile, 'fr-desktop.png');
  await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
  await js('document.querySelector(".language-menu summary").click()');
  assert.equal(await js('document.querySelector(".language-menu").open'), true);
  await js('new Promise(resolve=>setTimeout(resolve,200))');
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(desktop, (await win.webContents.capturePage()).toPNG());
  win.setContentSize(390, 844);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const width = await js('({viewport:innerWidth,content:document.documentElement.scrollWidth})');
  assert.ok(width.content <= width.viewport + 1, `Mobile overflow: ${JSON.stringify(width)}`);
  assert.ok(await js('(()=>{const r=document.querySelector(".language-panel").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})()'));
  const mobile = path.join(profile, 'fr-mobile.png');
  fs.writeFileSync(mobile, (await win.webContents.capturePage()).toPNG());
  win.setContentSize(320, 844);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.ok(await js('(()=>{const r=document.querySelector(".language-panel").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()'), 'menu fits small phones');
  assert.deepEqual(frenchErrors, []);
  await js('history.replaceState(null,"","#precos")');
  const switched = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await js('document.querySelector("[data-language-link][lang=en]").click()');
  await switched;
  assert.equal(await js('location.pathname+location.hash'), '/en/#precos');
  assert.equal(await js('document.documentElement.lang'), 'en');
  // Use real touch input: HTMLElement.click() misses mobile focus/activation ordering.
  win.webContents.debugger.attach('1.3');
  const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  const point = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const touchStart = async selector => {
    const { x, y } = await point(selector);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  };
  const touchEnd = () => cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const tap = async selector => { await touchStart(selector); await touchEnd(); };
  for (const [language, route] of [['fr', '/fr/'], ['pt-AO', '/'], ['en', '/en/']]) {
    await js('history.replaceState(null,"","#precos");window.scrollTo(0,0)');
    await tap('.language-menu summary');
    assert.equal(await js('document.querySelector(".language-menu").open'), true);
    await js('document.querySelector(".language-menu summary").focus()');
    await touchStart(`[data-language-link][lang="${language}"]`);
    // Mobile browsers may blur summary to body (relatedTarget=null) before link activation.
    await js('document.querySelector(".language-menu summary").blur()');
    assert.equal(await js('document.querySelector(".language-menu").open'), true, 'focus loss during a tap must not hide its target');
    await touchEnd();
    const until = Date.now() + 4000;
    while ((new URL(win.webContents.getURL()).pathname !== route || win.webContents.isLoading()) && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(new URL(win.webContents.getURL()).pathname, route, `touch switches to ${language}`);
    assert.equal(await js('location.hash'), '#precos');
    assert.equal(await js('document.documentElement.lang'), language);
  }
  await js('window.scrollTo(0,0)');
  await tap('.language-menu summary');
  await tap('h1');
  assert.equal(await js('document.querySelector(".language-menu").open'), false, 'outside tap dismisses');
  await js('document.querySelector(".language-menu summary").click();document.querySelector(".language-menu summary").focus();document.querySelector(".site-header .btn").focus()');
  assert.equal(await js('document.querySelector(".language-menu").open'), false, 'keyboard focus outside dismisses');
  win.webContents.debugger.detach();
  const result = { status: 'passed', routes: ['/', '/en/', '/fr/'], dropdownNavigation: true, keyboardAndEscape: true, outsideClick: true, preservesSection: true, mobileTouchNavigation: true, mobileNullFocusDuringTap: true, frenchMetadata: true, frenchCopy: true, mobileOverflow: false, screenshots: [desktop, mobile] };
  report(result); console.log(JSON.stringify(result));
  clearTimeout(deadline); win.destroy(); server.close(); app.exit(0);
}).catch(error => { report({ status: 'failed', error: error.stack }); console.error(error); clearTimeout(deadline); win?.destroy(); server?.close(); app.exit(1); });
