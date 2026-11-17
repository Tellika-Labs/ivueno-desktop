import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import { call, on, send } from './lib/bridge.js';
import { clockStr, setFormatLang } from './lib/format.mjs';
import { translate } from './lib/i18n.js';

const BARS = 36;          // the pill's wave
const TRAY_BARS = 64;     // each row of the opened island
const h2 = (v) => `${Math.round(3 + v * 19)}px`;
const MIC = '#63C3A6';
const SYS = '#EDE9E3';
const QUIET = '#6B655C';

/** The recording island: always dark, always on top. Shows what is being heard. Collapsed it never takes the keyboard; opened it does, for the quick note. */
function Island() {
  const [snap, setSnap] = useState(null);
  const [mode, setMode] = useState('collapsed');
  const [mic, setMic] = useState(Array(TRAY_BARS).fill(0.04));
  const [sys, setSys] = useState(Array(TRAY_BARS).fill(0.04));
  const [main, setMain] = useState(Array(BARS).fill(0.04));
  const [note, setNote] = useState('');
  const noteRef = useRef(null);
  // One island turning into the other. The opened island is laid out at its full size from the start and revealed through a
  // clip in the shape of the pill, which grows to the whole island (and shrinks back on closing): the shape changes while
  // nothing inside is laid out again. Closing plays first and only then swaps to the pill (`shown` lags behind `mode`).
  const islandRef = useRef(null);
  const pillW = useRef(300);                  // the pill's last width: where the opening starts and the closing lands
  const [shown, setShown] = useState('collapsed');
  const morph = useRef(null);
  const lastShown = useRef(shown);
  useEffect(() => {
    if (mode === 'expanded') { if (morph.current) morph.current.cancel(); setShown('expanded'); return; }
    if (shown !== 'expanded') return;
    const el = islandRef.current;
    if (!el || !el.animate || reducedMotion()) { setShown('collapsed'); return; }
    for (const child of el.children) child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
    const a = el.animate([{ clipPath: 'inset(0 0 0 0 round 20px)' }, { clipPath: pillClip(el, pillW.current) }],
      { duration: MORPH_MS, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'forwards' });
    morph.current = a;
    a.onfinish = () => { morph.current = null; setShown('collapsed'); };
  }, [mode]);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = islandRef.current;
    const from = lastShown.current;
    lastShown.current = shown;
    if (!el) return;
    if (shown === 'collapsed') { pillW.current = el.offsetWidth; }
    if (from === shown || reducedMotion() || !el.animate) return;
    if (shown === 'expanded') {
      el.animate([{ clipPath: pillClip(el, pillW.current) }, { clipPath: 'inset(0 0 0 0 round 20px)' }], { duration: MORPH_MS, easing: 'cubic-bezier(.32, .72, 0, 1)' });
    }
    for (const child of el.children) {
      child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: shown === 'expanded' ? MORPH_MS * 0.35 : 0, easing: 'ease-out', fill: 'backwards' });
    }
  });
  // Only the island catches the mouse; the window's transparent rest lets clicks through (main: setInteractive).
  useEffect(() => {
    let over = false;
    const set = (v) => { if (v !== over) { over = v; send('island:hover', v); } };
    const move = (e) => set(!!(e.target && e.target.closest && e.target.closest('.island')));
    const leave = () => set(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', leave);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseleave', leave); };
  }, []);
  // Opened (by a click or the shortcut): the cursor goes straight to the quick note.
  useEffect(() => { if (mode === 'expanded') setTimeout(() => noteRef.current && noteRef.current.focus(), 60); }, [mode]);
  const reduce = useRef(false);
  // The island is its own window: it reads the interface language from the settings (and follows changes).
  const [lang, setLang] = useState('pt');
  const t = (key, vars) => translate(lang, key, vars);
  useEffect(() => { document.documentElement.lang = { pt: 'pt-AO', en: 'en', fr: 'fr' }[lang] || 'pt-AO'; }, [lang]);
  useEffect(() => {
    const load = () => call('settings:get').then((s) => { setLang(s.appLanguage || 'pt'); setFormatLang(s.appLanguage); }).catch(() => {});
    load();
    return on('data:changed', (e) => { if (e.kind === 'settings' || e.kind === 'all') load(); });
  }, []);

  useEffect(() => {
    try { reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* default */ }
    call('rec:state').then(setSnap).catch(() => {});
    const offs = [
      on('rec:state', setSnap),
      on('island:mode', setMode),
      on('rec:levels', ({ mic: m, sys: s }) => {
        const push = (a, v) => a.slice(1).concat([Math.max(0.04, v)]);
        setMic((a) => push(a, m)); setSys((a) => push(a, s)); setMain((a) => push(a, Math.max(m, s)));
      }),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  const [dict, setDict] = useState(null);      // null until the main process has said whether dictation is running
  useEffect(() => {
    call('dictation:state').then(setDict).catch(() => {});
    return on('dictation:state', setDict);
  }, []);

  // The last dictation state shown: when dictation ends and nothing is being recorded, the island keeps it for the moment
  // before its window closes, instead of falling through to the meeting pill (with the time of an earlier recording).
  const lastDict = useRef(null);
  if (dict && dict.phase !== 'idle') lastDict.current = dict;

  if (!snap || !dict) return null;

  // Dictation takes the island when nothing is being recorded: "A ditar" with the real microphone bars.
  const recordingNow = snap.phase === 'recording' || snap.phase === 'paused';
  const meetingShown = recordingNow || snap.phase === 'writing' || snap.phase === 'done';
  const d = dict.phase !== 'idle' ? dict : (!meetingShown ? lastDict.current : null);
  if (!d && !meetingShown) return null;
  if (d && !recordingNow) {
    const listening = d.phase === 'listening';
    return (
      <div className="island-root">
        <Pill role="status" aria-live="polite" style={{ cursor: 'default' }} outerRef={islandRef}>
          {listening ? <span className="dot pulse" style={{ background: '#63C3A6' }} /> : <span className="dot sq" />}
          {listening ? (
            <>
              <span style={{ fontWeight: 600, color: '#8AD8BF' }}>{t('A ditar')}</span>
              <span className="waves" aria-hidden="true">{main.map((v, i) => <i key={i} style={{ height: reduce.current ? '3px' : h2(v), background: MIC }} />)}</span>
            </>
          ) : d.phase === 'inserting' ? (
            <span className="ok-text" style={{ flex: 1 }}>{t('A transcrever…')}</span>
          ) : (
            <span className="warn" style={{ flex: 1 }}>{t(d.message || 'O ditado falhou.')}</span>
          )}
        </Pill>
      </div>
    );
  }
  const phase = snap.phase;
  const h = (v, max) => `${Math.round(3 + v * (max - 3))}px`;
  const src = snap.source;
  const color = src === 'them' ? SYS : src === 'me' ? MIC : QUIET;
  const who = src === 'me' ? t('Tu') : src === 'them' ? t('Outros') : t('Silêncio');
  const dotClass = phase === 'paused' ? 'dot sq' : phase === 'done' || phase === 'writing' ? 'dot done' : 'dot pulse';
  const time = phase === 'done' ? `${Math.max(1, Math.round(snap.elapsedMs / 60000))} min` : clockStr(snap.elapsedMs);
  const label = phase === 'writing' ? t('A escrever as notas…') : phase === 'done' ? t('Notas prontas') : phase === 'paused' ? t('Em pausa') : snap.quiet ? t('Sem som') : '';

  if (shown === 'collapsed') {
    return (
      <div className="island-root">
        <Pill as="button" type="button" aria-expanded="false" aria-label={t(phase === 'paused' ? 'Em pausa, {time}. Abrir controlos' : 'A gravar, {time}. Abrir controlos', { time })}
          onClick={() => (phase === 'done' ? (send('island:open-main')) : send('island:expand'))} style={{ color: '#EDE9E3', textAlign: 'left' }} outerRef={islandRef}>
          <span className={dotClass} />
          <span className="time" style={{ minWidth: 64, color: phase === 'paused' ? '#A0998F' : '#EDE9E3' }}>{time}</span>
          {phase === 'recording' || phase === 'paused' ? (
            <span className="waves" aria-hidden="true">{main.map((v, i) => <i key={i} style={{ height: reduce.current || phase === 'paused' ? '3px' : h(v, 22), background: color }} />)}</span>
          ) : <span className="grow" />}
          {label ? <span className={phase === 'done' || phase === 'writing' ? 'ok-text' : 'warn'}>{label}</span>
            : <span className="src"><Icon2 src={src} />{who}</span>}
        </Pill>
      </div>
    );
  }

  return (
    <div className="island-root">
      <div ref={islandRef} className="island open" role="region" aria-label={t('Ivueno a gravar')}>
        <div className="row" style={{ gap: 10 }}>
          <span className={dotClass} />
          <span style={{ fontWeight: 600, color: '#FF8A80' }}>{phase === 'paused' ? t('Em pausa') : phase === 'recording' ? t('A gravar') : label}</span>
          <span className="time">{time}</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{snap.title || t('Reunião sem título')}</span>
          <button type="button" className="collapse" aria-label={t('Recolher')} title={t('Recolher')} onClick={() => send('island:collapse')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
          </button>
        </div>
        <div className="tray">
          <span className="l">{t('Tu')}</span>
          <span className="waves" aria-hidden="true" style={{ height: 26 }}>{mic.map((v, i) => <i key={i} style={{ height: reduce.current ? '3px' : h(v, 26), background: MIC }} />)}</span>
          <span className="l">{t('Outros')}</span>
          <span className="waves" aria-hidden="true" style={{ height: 26 }}>{sys.map((v, i) => <i key={i} style={{ height: reduce.current ? '3px' : h(v, 26), background: SYS }} />)}</span>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { call('rec:quickNote', note.trim()); setNote(''); } }}>
          <label className="sr-only" htmlFor="il-note">{t('Nota rápida')}</label>
          <input id="il-note" ref={noteRef} onKeyDown={(e) => { if (e.key === 'Escape') send('island:collapse'); }} placeholder={t('Nota rápida · Enter junta às tuas notas')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="ib" aria-label={phase === 'paused' ? t('Retomar') : t('Pausar')} onClick={() => call(phase === 'paused' ? 'rec:resume' : 'rec:pause')}>{phase === 'paused' ? '▶' : '❚❚'}</button>
          <button type="button" className="ib" aria-label={t('Abrir a Ivueno')} onClick={() => send('island:open-main')}>↗</button>
          <button type="button" className="stop" onClick={() => call('rec:stop')} disabled={phase !== 'recording' && phase !== 'paused'}>■ {t('Parar')}</button>
        </form>
      </div>
    </div>
  );
}

// The collapsed island is as wide as what it shows, and changes size smoothly when that changes (CSS transition on width).
const MORPH_MS = 420;            // opening / closing the island
const PILL_H = 40;
// A clip that shows only a pill-sized piece of the opened island: centred at the top, as wide as the pill.
const pillClip = (el, w) => {
  const side = Math.max(0, (el.offsetWidth - w) / 2);
  return `inset(0 ${side}px ${Math.max(0, el.offsetHeight - PILL_H)}px ${side}px round ${PILL_H / 2}px)`;
};
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
function Pill({ as: Tag = 'div', outerRef, children, ...rest }) {
  const inner = useRef(null);
  const shown = useRef(null);            // the width the pill is heading to
  const [width, setWidth] = useState(null);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const next = el.offsetWidth + 2;      // + the 1px border on each side
      const prev = shown.current;
      if (next === prev) return;
      shown.current = next;
      setWidth(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [Tag]);

  return (
    <Tag ref={outerRef} className="island pill" {...rest} style={{ ...(rest.style || {}), width: width == null ? undefined : width }}>
      <span ref={inner} className="pill-in">{children}</span>
    </Tag>
  );
}

function Icon2({ src }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true };
  if (src === 'me') return <svg {...common} stroke={MIC}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
  if (src === 'them') return <svg {...common} stroke={SYS}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
  return null;
}

createRoot(document.getElementById('root')).render(<Island />);
