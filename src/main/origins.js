const path = require('path');
const { fileURLToPath } = require('url');

const ROOT = path.resolve(__dirname, '..', '..', 'dist', 'renderer');

function isAppPage(value, devUrl = process.env.VITE_DEV_URL || '') {
  try {
    const url = new URL(value);
    if (devUrl) return url.origin === new URL(devUrl).origin && ['/', '/index.html', '/island.html'].includes(url.pathname);
    if (url.protocol !== 'file:' || url.host) return false;
    const file = path.resolve(fileURLToPath(url));
    return ['index.html', 'island.html'].some((name) => file === path.join(ROOT, name));
  } catch { return false; }
}

function validApiBase(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

module.exports = { isAppPage, validApiBase };
