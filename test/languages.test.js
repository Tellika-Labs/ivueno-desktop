const test = require('node:test');
const assert = require('node:assert/strict');
const { languageCode, meetingLanguage } = require('../src/main/languages');
const { CloudEngine } = require('../src/main/engine/cloud');
const { DemoEngine } = require('../src/main/engine/demo');
const { templateEmail } = require('../src/main/engine/email');

test('meeting output language follows an explicit target, then spoken language, then detected transcript', () => {
  assert.equal(languageCode('French'), 'fr'); assert.equal(languageCode('es-MX'), 'es');
  assert.equal(meetingLanguage({ language: 'fr', translateTo: 'es' }), 'es');
  assert.equal(meetingLanguage({ language: 'fr' }), 'fr');
  assert.equal(meetingLanguage({ language: 'auto', segments: [{ language: 'spanish', text: 'Hola a todos.' }] }), 'es');
  assert.equal(meetingLanguage({ language: null, segments: [{ language: 'french', text: 'Bonjour.' }] }), 'fr');
  assert.equal(meetingLanguage({}), 'auto');
});

for (const language of ['fr', 'es']) {
  test(`${language}: the meeting's spoken language wins over the global setting and remains fixed while recording`, async () => {
    const settings = { language: 'pt' }, requests = [], lines = [];
    const cloud = new CloudEngine({ getSettings: () => settings, api: { cloudTranscribe: async (...args) => {
      requests.push(args); return { language, segments: [{ start_ms: 0, text: 'Bonjour. Hola.' }] };
    } } });
    cloud.start({ id: 'm', language }, { final: line => lines.push(line) }, () => 1000);
    settings.language = 'en';
    await cloud.feed({ source: 'system', mime: 'audio/webm', seconds: 1, data: Buffer.from('audio') });
    assert.equal(requests[0][3], language); assert.equal(lines[0].language, language);
    cloud.start({ id: 'm2', language: null }, { final() {} }, () => 1000);
    await cloud.feed({ source: 'system', mime: 'audio/webm', seconds: 1, data: Buffer.from('audio') });
    assert.equal(requests[1][3], undefined); // explicit auto does not inherit the global setting
  });

  test(`${language}: notes and summaries preserve the requested output language`, async () => {
    const requests = [];
    const cloud = new CloudEngine({ api: {
      cloudNotes: async body => { requests.push(body); return { notes_markdown: 'Notes', action_items: [] }; },
      cloudSummarize: async body => { requests.push(body); return { text: 'Summary' }; },
    } });
    const meeting = { language: null, segments: [{ speakerKey: 'spk_1', language, text: 'Bonjour. Hola.' }], aiBlocks: [], aiExtra: [], tasks: [] };
    await cloud.writeNotes(meeting, () => 'Ana');
    await cloud.summarize({ text: 'Bonjour. Hola.', language, meeting });
    assert.deepEqual(requests.map(body => body.language), [language, language]);
  });

  test(`${language}: offline follow-up email uses the requested language or detected transcript language`, async () => {
    const meeting = { title: 'Project', summary: 'Bonjour. Hola.', segments: [{ language, text: 'Bonjour. Hola.' }] };
    const direct = templateEmail({ meeting, language, attendeeNames: ['Ana Silva', 'Bruno Costa'] });
    const fallback = await new DemoEngine().draftEmail({ meeting, language: 'auto', attendeeNames: ['Ana Silva', 'Bruno Costa'] }, () => 'Ana');
    assert.match(direct.body, language === 'fr' ? /Ana et Bruno/ : /Ana y Bruno/);
    assert.match(fallback.subject, language === 'fr' ? /Récapitulatif/ : /Resumen/);
  });
}
