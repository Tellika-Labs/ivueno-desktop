const test = require('node:test');
const assert = require('node:assert/strict');
const { fromGoogle, fromGraph, available } = require('../src/main/calendar-oauth');

test('Google events become the app shape and skip cancelled ones', () => {
  const [e, ...rest] = fromGoogle([
    { id: 'a', summary: 'Chamada', start: { dateTime: '2026-10-20T14:00:00+01:00' }, end: { dateTime: '2026-10-20T14:45:00+01:00' },
      attendees: [{ email: 'x@exemplo.ao', displayName: 'X' }, { email: 'sala@exemplo.ao', resource: true }] },
    { id: 'b', summary: 'Cancelada', status: 'cancelled', start: { dateTime: '2026-10-20T15:00:00Z' } },
  ]);
  assert.equal(rest.length, 0);
  assert.equal(e.start, Date.parse('2026-10-20T13:00:00Z'));
  assert.equal(e.allDay, false);
  assert.deepEqual(e.attendees, [{ name: 'X', email: 'x@exemplo.ao' }]);
});

test('Graph events are read as UTC even though the time has no Z', () => {
  const [e] = fromGraph([{ id: 'm', subject: 'Reunião', start: { dateTime: '2026-10-20T13:00:00.0000000' }, end: { dateTime: '2026-10-20T13:45:00.0000000' }, isAllDay: false,
    attendees: [{ emailAddress: { name: 'Y', address: 'y@exemplo.ao' } }] }]);
  assert.equal(e.start, Date.parse('2026-10-20T13:00:00Z'));
  assert.equal(e.attendees[0].email, 'y@exemplo.ao');
  assert.equal(fromGraph([{ id: 'c', isCancelled: true, start: { dateTime: '2026-10-20T13:00:00' } }]).length, 0);
});

test('a sign-in button only exists when its client id is configured', () => {
  assert.deepEqual(available({}), []);
  assert.deepEqual(available({ IVUENU_GOOGLE_CLIENT_ID: 'g', IVUENU_MS_CLIENT_ID: 'm' }), ['google', 'microsoft']);
});

test('signing in with Google asks for the calendar too, and only keeps it when it was allowed', async () => {
  const { signIn } = require('../src/main/calendar-oauth');
  const env = { IVUENU_GOOGLE_CLIENT_ID: 'id', IVUENU_GOOGLE_CLIENT_SECRET: 's' };
  const run = async (scope) => {
    let asked;
    const fetchImpl = async () => ({ ok: true, json: async () => ({ id_token: 'idt', refresh_token: 'rt', scope }) });
    const openExternal = async (url) => {
      asked = new URL(url);
      await fetch(`${asked.searchParams.get('redirect_uri')}?code=c&state=${asked.searchParams.get('state')}`);
    };
    return { out: await signIn({ openExternal, fetchImpl, env }), asked };
  };
  const all = await run('openid email profile https://www.googleapis.com/auth/calendar.readonly');
  assert.ok(all.asked.searchParams.get('scope').includes('calendar.readonly'));
  assert.deepEqual(all.out.calendar, { provider: 'google', refreshToken: 'rt' });
  const noCal = await run('openid email profile');
  assert.equal(noCal.out.calendar, null);
  assert.equal(noCal.out.idToken, 'idt');
});
