const languages = require('../shared/spoken-languages.json');
const codes = new Set(languages.map(l => l.id));
const names = { portuguese: 'pt', english: 'en', french: 'fr', spanish: 'es' };
function languageCode(value) {
  const text = String(value || '').toLowerCase();
  const code = names[text] || text.split(/[-_]/)[0];
  return codes.has(code) ? code : null;
}
function meetingLanguage(meeting, fallback = 'auto') {
  const explicit = languageCode(meeting?.translateTo) || languageCode(meeting?.language);
  if (explicit) return explicit;
  const counts = new Map();
  for (const line of meeting?.segments || []) {
    const code = languageCode(line.language);
    if (code) counts.set(code, (counts.get(code) || 0) + Math.max(1, (line.text || '').length));
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
}
module.exports = { languageCode, meetingLanguage };
