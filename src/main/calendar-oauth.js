// One-click calendar sign-in for Google and Microsoft: OAuth with PKCE through the system browser and a one-shot
// loopback page on this computer. Only read access to events. The refresh token is kept by the caller (encrypted);
// events are fetched straight from Google / Microsoft Graph and never pass through our servers.

const crypto = require('crypto');
const http = require('http');

const PROVIDERS = {
  google: {
    name: 'Google',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    extra: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    name: 'Microsoft',
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'offline_access Calendars.Read',
    extra: { prompt: 'select_account' },
  },
};

/** Client ids come from the environment (public "desktop app" clients: no secret is needed, Google's is not confidential). */
function clientOf(provider, env = process.env) {
  if (provider === 'google') return { id: env.IVUENU_GOOGLE_CLIENT_ID || '', secret: env.IVUENU_GOOGLE_CLIENT_SECRET || '' };
  if (provider === 'microsoft') return { id: env.IVUENU_MS_CLIENT_ID || '', secret: '' };
  return { id: '', secret: '' };
}

/** Which sign-in buttons can be shown. */
function available(env = process.env) {
  return Object.keys(PROVIDERS).filter((p) => clientOf(p, env).id);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PAGE = (ok) => `<!doctype html><meta charset="utf-8"><title>Ivueno</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#1F1D1A">
<div style="text-align:center"><h1 style="font-size:22px">${ok ? 'Tudo certo' : 'Não foi possível continuar'}</h1>
<p>${ok ? 'Já podes fechar esta janela e voltar à Ivueno.' : 'Volta à Ivueno e tenta outra vez.'}</p></div>`;

async function postForm(fetchImpl, url, body) {
  const res = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || `HTTP ${res.status}`), { code: json.error === 'invalid_grant' ? 'calendar_revoked' : 'calendar_unreachable' });
  return json;
}

/**
 * Opens the browser, waits for the approval and returns { refreshToken }.
 * `openExternal(url)` opens the system browser. `timeoutMs` is how long we wait for the person.
 */
async function connect(provider, { openExternal, fetchImpl = fetch, env = process.env, timeoutMs = 180_000, scope, extra, needRefresh = true } = {}) {
  const def = PROVIDERS[provider];
  const client = clientOf(provider, env);
  if (!def || !client.id) throw Object.assign(new Error('Esta ligação ainda não está configurada.'), { code: 'invalid' });

  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(16));
  let finish;
  const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const code = u.searchParams.get('code');
    const ok = !!code && u.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE(ok));
    if (ok) finish.resolve(code);
    else finish.reject(Object.assign(new Error(u.searchParams.get('error') === 'access_denied' ? 'Cancelaste a ligação.' : 'A resposta do início de sessão não é válida.'), { code: 'invalid' }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const timer = setTimeout(() => finish.reject(Object.assign(new Error('O início de sessão demorou demasiado. Tenta outra vez.'), { code: 'timeout' })), timeoutMs);

  try {
    const url = new URL(def.auth);
    const q = {
      client_id: client.id, redirect_uri: redirect, response_type: 'code', scope: scope || def.scope, state,
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', ...(extra || def.extra),
    };
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    await openExternal(url.toString());
    const code = await done;
    const tok = await postForm(fetchImpl, def.token, {
      client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}), grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier,
    });
    if (needRefresh && !tok.refresh_token) throw Object.assign(new Error('O pedido não devolveu acesso permanente. Tenta outra vez.'), { code: 'invalid' });
    return { refreshToken: tok.refresh_token, idToken: tok.id_token, scope: tok.scope || '' };
  } finally {
    clearTimeout(timer);
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
  }
}

/**
 * Sign in to Ivueno with Google, and connect the calendar in the same step. Returns { idToken } for the Ivueno server to verify and, when
 * the person allowed calendar access (Google lets them untick it), { calendar: { provider, refreshToken } }.
 */
async function signIn(opts = {}) {
  const r = await connect('google', { ...opts, scope: `openid email profile ${PROVIDERS.google.scope}`, extra: { prompt: 'consent select_account', access_type: 'offline' }, needRefresh: false });
  if (!r.idToken) throw Object.assign(new Error('O Google não devolveu a identidade. Tenta outra vez.'), { code: 'invalid' });
  const calendar = r.refreshToken && r.scope.split(' ').includes(PROVIDERS.google.scope) ? { provider: 'google', refreshToken: r.refreshToken } : null;
  return { idToken: r.idToken, calendar };
}

const access = new Map();   // provider -> { token, until }

async function accessToken(provider, refreshToken, { fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  const hit = access.get(provider);
  if (hit && hit.until > now + 30_000) return hit.token;
  const client = clientOf(provider, env);
  const tok = await postForm(fetchImpl, PROVIDERS[provider].token, {
    client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}), grant_type: 'refresh_token', refresh_token: refreshToken, scope: PROVIDERS[provider].scope,
  });
  access.set(provider, { token: tok.access_token, until: now + (Number(tok.expires_in) || 3000) * 1000 });
  return tok.access_token;
}

// --- normalising the two APIs into the shape the app already uses: { id, title, start, end, allDay, attendees } ---

function fromGoogle(items) {
  return (items || []).filter((e) => e.status !== 'cancelled' && e.start).map((e) => ({
    id: e.id, title: e.summary || 'Sem título',
    start: Date.parse(e.start.dateTime || e.start.date), end: Date.parse((e.end && (e.end.dateTime || e.end.date)) || e.start.dateTime || e.start.date),
    allDay: !e.start.dateTime,
    attendees: (e.attendees || []).filter((a) => !a.resource).map((a) => ({ name: a.displayName || '', email: a.email || '' })),
  }));
}

function fromGraph(items) {
  const utc = (s) => Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(/(\.\d{3})\d+$/, '$1')}Z`);   // asked for UTC; Graph omits the "Z"
  return (items || []).filter((e) => !e.isCancelled && e.start).map((e) => ({
    id: e.id, title: e.subject || 'Sem título', start: utc(e.start.dateTime), end: utc(e.end.dateTime), allDay: !!e.isAllDay,
    attendees: (e.attendees || []).map((a) => ({ name: (a.emailAddress && a.emailAddress.name) || '', email: (a.emailAddress && a.emailAddress.address) || '' })),
  }));
}

/** Events happening between now and now + hours, soonest first, without all-day or finished ones (same rules as the .ics reader). */
async function upcoming(provider, refreshToken, { now = Date.now(), hours = 48, fetchImpl = fetch, env = process.env } = {}) {
  const token = await accessToken(provider, refreshToken, { fetchImpl, env, now });
  const from = new Date(now).toISOString();
  const to = new Date(now + hours * 3_600_000).toISOString();
  let url; let headers = { authorization: `Bearer ${token}` }; let map;
  if (provider === 'google') {
    url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: from, timeMax: to, maxResults: '50' })}`;
    map = (j) => fromGoogle(j.items);
  } else {
    url = `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: from, endDateTime: to, $top: '50', $orderby: 'start/dateTime', $select: 'id,subject,start,end,isAllDay,isCancelled,attendees' })}`;
    headers = { ...headers, prefer: 'outlook.timezone="UTC"' };
    map = (j) => fromGraph(j.value);
  }
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
  if (res.status === 401) access.delete(provider);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);               // Google / Microsoft say exactly what is wrong (API switched off, permission missing...)
    const why = detail && detail.error && (detail.error.message || detail.error.code);
    throw Object.assign(new Error(`O calendário respondeu ${res.status}${why ? `: ${why}` : ''}`), { code: 'calendar_unreachable', status: res.status });
  }
  return map(await res.json()).filter((e) => !e.allDay && e.end > now).sort((a, b) => a.start - b.start);
}

module.exports = { PROVIDERS, available, connect, signIn, upcoming, fromGoogle, fromGraph };
