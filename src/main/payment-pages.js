// Keep the same exact hosts as backend/app/payments/wipay.py.
const WIPAY_HOSTS = ['hosted.wipay.ao', 'pay.wiza.ao'];

function checkoutUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { /* rejected below */ }
  if (!url || url.protocol !== 'https:' || !WIPAY_HOSTS.includes(url.hostname) || url.username || url.password || url.port ||
      !url.searchParams.get('id') || url.searchParams.get('id').length > 80 || String(value).length > 500) {
    throw Object.assign(new Error('Só abrimos a página de pagamento da WiPay.'), { code: 'blocked' });
  }
  return url.toString();
}

function isHostedFrameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && WIPAY_HOSTS.includes(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function isVerificationFrameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'challenges.cloudflare.com' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function isAllowedPaymentFrame(value, ancestors = []) {
  if (isHostedFrameUrl(value)) return true;
  // WiPay awaits Turnstile before it sends a payment. Its challenge is a nested
  // frame, never a top-level replacement for the checkout or an app-owned frame.
  if (!isVerificationFrameUrl(value)) return false;
  for (const ancestor of ancestors) {
    if (isHostedFrameUrl(ancestor)) return true;
    if (!isVerificationFrameUrl(ancestor)) return false;
  }
  return false;
}

module.exports = { WIPAY_HOSTS, checkoutUrl, isHostedFrameUrl, isAllowedPaymentFrame };
