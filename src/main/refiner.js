const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vocabularyPrompt } = require('./engine/vocab');

const fail = (code, message) => Object.assign(new Error(message), { code, message });
const SHORT_TEXT = 0.2;                  // a new transcript with less than this share of the live text is distrusted and not used

const words = (t) => String(t || '').toLowerCase().match(/[a-zà-ú0-9]+/g) || [];
const jaccard = (a, b) => { const A = new Set(words(a)); const B = new Set(words(b)); let n = 0; for (const w of A) if (B.has(w)) n += 1; return n / Math.max(1, A.size + B.size - n); };

/**
 * What can be done with a meeting's audio kept on this computer, after the meeting. Two modes:
 *
 *   voices (the default): the transcript stays exactly as it was heard live; the audio is used to tell the VOICES apart and give each line to "Orador 1, 2…".
 *          This is what separates the people when everybody is in the same room and one microphone heard them. No new transcription, no extra cost.
 *   text:  also transcribe the audio again, in blocks of about 10 minutes, and use that transcript instead (the live one is set aside in meeting.liveSegments
 *          to compare). Only on request: on mixed Portuguese and English speech a long block tends to translate the English into Portuguese, and the
 *          larger model is not better than the fast one on what was tested (docs/CLOUD_AI.md), so this is for trying, not for every meeting.
 *
 * Neither makes things worse: if it fails, finds no text, or the person is offline, the transcript stays as it is and `meeting.refine` says why.
 * Failing to tell the voices apart never fails the text mode.
 *
 * engine: { canTranscribeFile(), transcribeAudio({data, mime, seconds, language, prompt, quality}) }   archive: AudioArchive
 * decode(bytes) -> 16 kHz mono PCM16 (the window decodes: Chromium has the audio decoders)   voices: { available(), modelPath(), identify(job, onProgress) } | null
 * notes(id) writes the notes   policy() -> 'off' | 'final' | '7d' | '30d'   glossary() -> the person's own terms (may be empty)
 * Emits 'progress' { id, mode, stage: 'transcribing'|'voices'|'notes', doneMs, totalMs, value?, done?, error? }.
 */
class Refiner extends EventEmitter {
  constructor({ repo, engine, archive, notes, voices = null, decode = null, policy = () => '7d', glossary = () => '', tmpDir = os.tmpdir(), now = () => Date.now() }) {
    super();
    Object.assign(this, { repo, engine, archive, notes, voices, decode, policy, glossary, tmpDir, now });
    this.active = null;
  }

  state() { return this.active ? { running: true, id: this.active.id, mode: this.active.mode, stage: this.active.stage, doneMs: this.active.doneMs, totalMs: this.active.totalMs } : { running: false }; }

  _progress(a, extra = {}) { this.emit('progress', { id: a.id, mode: a.mode, stage: a.stage, doneMs: a.doneMs, totalMs: a.totalMs, ...extra }); }

  async run(id, { mode = 'voices' } = {}) {
    if (mode !== 'voices' && mode !== 'text') throw fail('invalid', 'Modo inválido.');
    if (this.active) throw fail('refine_busy', 'Já há uma reunião a ser tratada.');
    const m = this.repo.getMeeting(id);
    if (!m) throw fail('not_found', 'Reunião não encontrada.');
    const blocks = this.archive.blocks(id);
    if (!blocks.length) throw fail('no_audio', 'O áudio desta reunião já não está guardado.');
    if (mode === 'text' && !this.engine.canTranscribeFile()) throw fail('engine_missing', 'A transcrição não está disponível.');
    const a = this.active = { id, mode, stage: mode === 'text' ? 'transcribing' : 'voices', doneMs: 0, totalMs: Math.round(blocks.reduce((n, b) => n + b.seconds * 1000, 0)) };
    this.repo.updateMeeting(id, { refine: { state: 'running', mode, at: new Date(this.now()).toISOString(), error: '' } });
    this._progress(a);
    try {
      let lines;
      if (mode === 'text') {
        lines = dedupeEcho(await this._transcribe(m, blocks, a));
        if (!lines.length) throw fail('no_text', 'Não foi percebida fala no áudio guardado.');
        const before = m.segments.reduce((n, s) => n + words(s.text).length, 0);
        if (before > 50 && lines.reduce((n, l) => n + words(l.text).length, 0) < SHORT_TEXT * before) throw fail('too_little_text', 'A nova transcrição encontrou muito menos texto do que a primeira: ficou a primeira.');
      } else {
        lines = liveLines(m);
        if (lines.length < 2) throw fail('no_text', 'Esta reunião quase não tem transcrição para separar as vozes.');
      }
      const voiceInfo = await this._voices(m, blocks, lines, a);
      let notesNeeded = mode === 'text';
      if (mode === 'text') this._store(id, lines, voiceInfo);
      else notesNeeded = this._assign(id, lines, voiceInfo);                 // true when the people now have different names in the transcript
      if (notesNeeded) { a.stage = 'notes'; this._progress(a); await this.notes(id); }
      this.repo.addConsent(id, 'refined', mode === 'text' ? 'Transcrição refeita a partir do áudio guardado neste computador.' : 'Vozes separadas a partir do áudio guardado neste computador.');
      this.repo.updateMeeting(id, { refine: { state: 'done', mode, at: new Date(this.now()).toISOString(), voices: voiceInfo.voices, voiceState: voiceInfo.state, error: '' } });
      if (this.policy() === 'final') { this.archive.remove(id); this.repo.updateMeeting(id, { audio: null, liveSegments: null }); }
      this._progress(a, { done: true });
      return { meeting: this.repo.getMeeting(id), voices: voiceInfo.voices, voiceState: voiceInfo.state };
    } catch (e) {
      this.repo.updateMeeting(id, { refine: { state: 'failed', mode, at: new Date(this.now()).toISOString(), error: e.code || 'failed' } });
      this._progress(a, { done: true, error: e.code || 'failed' });
      throw e;
    } finally {
      this.active = null;
    }
  }

  _prompt(meeting) { return vocabularyPrompt(meeting, this.glossary()) || undefined; }

  async _transcribe(m, blocks, a) {
    const lines = [];
    for (const source of [...new Set(blocks.map((b) => b.source))]) {
      for (const block of blocks.filter((b) => b.source === source)) {
        const res = await this.engine.transcribeAudio({
          data: this.archive.read(a.id, block.file), mime: 'audio/webm', seconds: Math.max(0.3, block.seconds), language: m.language || 'auto',
          prompt: this._prompt(m), quality: 'best',
        });
        for (const s of res.segments || []) {
          const text = String(s.text || '').trim();
          if (!text) continue;
          const startMs = block.startMs + (s.start_ms || 0);
          lines.push({ source, startMs, endMs: block.startMs + Math.max(s.end_ms || 0, (s.start_ms || 0) + 500), text, language: res.language || null });
        }
        a.doneMs += Math.round(block.seconds * 1000); this._progress(a);
      }
    }
    return lines.sort((x, y) => x.startMs - y.startMs);
  }

  /** Who spoke each line, per recorded source. Never throws: { state: 'on' | 'off' | 'model_missing' | 'failed', voices, perSource: {source: {voices, assignments}} } */
  async _voices(m, blocks, lines, a) {
    const out = { state: 'on', voices: 0, perSource: {} };
    if (!this.voices || !this.decode) return { ...out, state: 'off' };
    if (!this.voices.available()) return { ...out, state: 'model_missing' };
    a.stage = 'voices'; this._progress(a, { value: 0 });
    for (const source of [...new Set(blocks.map((b) => b.source))]) {
      const mine = lines.map((l, index) => ({ l, index })).filter((x) => x.l.source === source);
      if (mine.length < 2) continue;
      const pcmPath = path.join(this.tmpDir, `ivuenu-refine-${a.id}-${source}.pcm`);
      try {
        fs.rmSync(pcmPath, { force: true });
        for (const block of blocks.filter((b) => b.source === source)) {
          const pcm = Buffer.from(await this.decode(this.archive.read(a.id, block.file)));
          const at = Math.round(block.startMs * 32);                                       // 16 kHz x 2 bytes = 32 bytes per millisecond
          const have = fs.existsSync(pcmPath) ? fs.statSync(pcmPath).size : 0;
          if (have < at) fs.appendFileSync(pcmPath, Buffer.alloc(at - have));               // a gap between blocks stays silent, so the times still line up
          fs.appendFileSync(pcmPath, pcm);
        }
        const res = await this.voices.identify({
          pcmPath, modelPath: this.voices.modelPath(), segments: mine.map(({ l }) => ({ startMs: l.startMs, endMs: l.endMs })),
          totalSec: fs.statSync(pcmPath).size / 32000, voices: Math.max(0, Math.min(12, Number(m.voiceCount) || 0)),
        }, (value) => this._progress(a, { value }));
        out.perSource[source] = { voices: res.voices, assignments: new Map(mine.map((x, i) => [x.index, res.assignments[i]])) };
      } catch (e) {
        out.state = 'failed';
        console.error('[refine] telling the voices apart failed:', e && e.message);
      } finally { try { fs.rmSync(pcmPath, { force: true }); } catch { /* temporary */ } }
    }
    out.voices = Object.values(out.perSource).reduce((n, s) => Math.max(n, s.voices), 0);
    return out;
  }

  /**
   * The speaker key of a line. Without voices it is what the live recording used: the microphone is the person ("spk_me"), the computer's sound is "spk_2".
   * With several voices on the microphone (everybody in the same room) they become Orador 1, 2…, and the computer's sound continues the numbering.
   * Returns null when nothing should change for that line.
   */
  _key(line, index, voiceInfo) {
    const mic = voiceInfo.perSource.mic; const sys = voiceInfo.perSource.system;
    const room = !!mic && mic.voices >= 2;
    const sysBase = room ? mic.voices : 1;
    if (line.source === 'mic') return room ? `spk_${mic.assignments.get(index) + 1}` : 'spk_me';
    return sys && sys.voices >= 2 ? `spk_${sysBase + sys.assignments.get(index) + 1}` : `spk_${sysBase + 1}`;
  }

  /** The new transcript in place of the live one (text mode). */
  _store(id, lines, voiceInfo) {
    this.repo.replaceSegments(id, lines.map((l, index) => ({ clientId: `ref_${id}_${index}`, speakerKey: this._key(l, index, voiceInfo), source: l.source, text: l.text, language: l.language, startMs: l.startMs })));
  }

  /** Voices mode: give the existing lines to the voices found. Only lines of a source with several voices change. Returns whether anything changed. */
  _assign(id, lines, voiceInfo) {
    const mapping = [];
    lines.forEach((l, index) => {
      const track = voiceInfo.perSource[l.source];
      if (!track || track.voices < 2) return;
      mapping.push([l.rowId, this._key(l, index, voiceInfo)]);
    });
    if (!mapping.length) return false;
    this.repo.assignSpeakers(id, mapping);
    return true;
  }
}

/** The lines of the live transcript as the refiner sees them, with an end time (the next line of the same source, at most 12 s later). */
function liveLines(m) {
  const bySource = {};
  for (const s of m.segments) (bySource[s.source] ||= []).push(s);
  const out = [];
  for (const list of Object.values(bySource)) {
    list.sort((x, y) => x.startMs - y.startMs);
    list.forEach((s, i) => {
      const next = list[i + 1] ? list[i + 1].startMs : s.startMs + 8000;
      out.push({ rowId: s.id, source: s.source, startMs: s.startMs, endMs: Math.max(s.startMs + 1500, Math.min(next, s.startMs + 12000)), text: s.text, language: s.language });
    });
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}

/** The same words heard by the microphone and by the computer's sound (the other people, through the speakers): keep the cleaner computer-sound line. */
function dedupeEcho(lines) {
  const system = lines.filter((l) => l.source === 'system');
  if (!system.length) return lines;
  return lines.filter((l) => l.source !== 'mic' || !system.some((s) => Math.abs(s.startMs - l.startMs) <= 4000 && words(l.text).length >= 3 && jaccard(s.text, l.text) >= 0.5));
}

module.exports = { Refiner, dedupeEcho, liveLines };
