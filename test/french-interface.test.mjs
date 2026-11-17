import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EN_BY_PT } from '../src/renderer/lib/i18n-en.js';
import french from '../src/shared/french.json' with { type: 'json' };
import { translate, missingKeys, LANGUAGES } from '../src/renderer/lib/i18n.js';
import { setFormatLang, dayHeading, monthName, passwordStrength } from '../src/renderer/lib/format.mjs';
import { setErrorLang, friendly } from '../src/renderer/lib/errors.mjs';

const placeholders = value => (value.match(/\{\w+\}/g) || []).sort();
test('French covers every interface string and preserves interpolation variables', () => {
  assert.ok(LANGUAGES.some(language => language.id === 'fr' && language.label === 'Français'));
  assert.deepEqual(missingKeys('fr'), []);
  assert.deepEqual(Object.keys(EN_BY_PT).filter(key => !french.ui[key]), []);
  for (const [key, english] of Object.entries(EN_BY_PT)) {
    assert.deepEqual(placeholders(french.ui[key]), placeholders(english), key);
    if (english.includes('Ivueno')) assert.ok(french.ui[key].includes('Ivueno'), key);
  }
  assert.match(translate('fr', 'welcome.body'), /Ivueno/);
  assert.equal(translate('fr', 'nav.home'), 'Accueil');
  assert.equal(translate('fr', 'set.title'), 'Paramètres');
  assert.equal(translate('fr', 'Orador {n}', { n: 4 }), 'Intervenant 4');
  assert.equal(translate('fr', 'Guardado: {name}', { name: 'Brian.pdf' }), 'Enregistré : Brian.pdf');
});

test('every coded error has French wording and technical messages never leak through', () => {
  const source = fs.readFileSync(new URL('../src/renderer/lib/errors.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const EN = {');
  const end = source.indexOf('\n};', start);
  const english = new Function(`return (${source.slice(start + 'const EN = '.length, end + 2)})`)();
  assert.deepEqual(Object.keys(english).filter(code => !french.errors[code]), []);
  setErrorLang('fr');
  for (const code of Object.keys(english)) assert.equal(friendly({ code }), french.errors[code]);
  assert.equal(friendly({ code: 'unknown', message: 'Não foi possível.' }), 'Une erreur est survenue. Réessayez.');
  assert.match(friendly({ status: 502 }), /serveur Ivueno/);
  setErrorLang('pt');
});

test('dates and password hints follow French independently from the spoken language', () => {
  setFormatLang('fr');
  const now = new Date(2026, 10, 7, 12);
  assert.match(dayHeading(now, now), /^Aujourd’hui/);
  assert.equal(monthName(now), 'Novembre');
  assert.match(passwordStrength('abc').label, /Faible/);
  setFormatLang('pt');
});
