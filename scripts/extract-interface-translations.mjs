import fs from 'node:fs';
import { EN_BY_PT } from '../src/renderer/lib/i18n-en.js';
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
function dictionary(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  const end = source.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error(`Missing dictionary ${name}`);
  return new Function(`return (${source.slice(start + `const ${name} = `.length, end + 2)})`)();
}
const keyed = dictionary(read('../src/renderer/lib/i18n.js'), 'en');
const errors = dictionary(read('../src/renderer/lib/errors.mjs'), 'EN');
fs.writeFileSync(new URL('./.french-source.json', import.meta.url), JSON.stringify({ ui: EN_BY_PT, keys: keyed, errors }, null, 2) + '\n');
console.log(JSON.stringify({ ui: Object.keys(EN_BY_PT).length, keys: Object.keys(keyed).length, errors: Object.keys(errors).length }));
