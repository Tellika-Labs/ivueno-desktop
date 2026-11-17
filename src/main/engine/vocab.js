/**
 * Names and terms the speakers are likely to use, sent to the speech service as a hint so it spells them right: the people of the meeting, and the terms the person
 * wrote in Settings (their company, their clients, local words such as "kwanzas"). There is NO built-in glossary: a hint is only worth sending when it is the person's own.
 * Whisper repeats the hint when a piece is short or unclear ("Africell, Africell, Africell") and a long hint can make it skip words, so it is kept short and optional.
 */
const MAX = 380;

function vocabularyPrompt(meeting, glossary = '') {
  const people = ((meeting && meeting.attendees) || []).map((a) => String(a.name || '').trim()).filter(Boolean).join(', ');
  const own = String(glossary || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).join(', ');
  return [people, own].filter(Boolean).join(', ').slice(0, MAX);
}

module.exports = { vocabularyPrompt };
