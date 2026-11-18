import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import './styles/tokens.css';
import './styles/app.css';
import isotipo from './assets/isotipo.svg';
import { on, send } from './lib/bridge.js';

/**
 * "Meeting detected" banner, top-right. One compact row: what was detected, and a split button "Take notes" with a menu (Not now / Don't ask
 * again for an hour). "Take notes" opens the row downwards to ask whether the participants know; the answer starts the meeting.
 * A thin line along the bottom counts the time left (hovering pauses it). Nothing records until the consent question is answered: closing,
 * running out of time or "Back" starts nothing. The words come already translated from main/index.js, so this page has no catalogue.
 */
function MeetingPrompt() {
  const [m, setM] = useState(null);            // { key, label, texts }
  const [panel, setPanel] = useState(null);    // null | 'more' | 'consent'
  const [leaving, setLeaving] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => on('meetprompt:show', (p) => { setM(p); setPanel(null); setLeaving(false); }), []);
  // Only the banner catches the mouse; the rest of the window lets clicks through to what is underneath (main: meetprompt:hover).
  useEffect(() => {
    let inside = false;
    const set = (v) => { if (v !== inside) { inside = v; setOver(v); send('meetprompt:hover', v); } };
    const move = (e) => set(!!(e.target && e.target.closest && e.target.closest('.mp-card')));
    const leave = () => set(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', leave);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseleave', leave); };
  }, []);
  if (!m) return null;
  const x = m.texts;
  // The banner slides out first, then the main process closes the window.
  const choose = (value) => {
    if (leaving) return;
    setLeaving(true);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => send('meetprompt:choose', { value, key: m.key }), still ? 0 : 200);
  };
  const ended = m.mode === 'ended';
  const ms = panel === 'consent' ? x.consentMs : x.askMs;
  return (
    <div className="mp-root">
      <div className={`mp-card${leaving ? ' leaving' : ''}${over ? ' over' : ''}`} role="dialog" aria-live="polite" aria-label={x.title}>
        <div className="mp-row">
          <div className="mp-text">
            <div className="mp-title">{panel === 'consent' ? x.consentTitle : x.title}</div>
            <div className="mp-sub">{panel === 'consent' ? x.consentBody : (ended ? x.sub : m.label)}</div>
          </div>
          {ended && (
            <div className="mp-ends">
              <button className="mp-end" onClick={() => choose('continue')}>{x.keep}</button>
              <button className="mp-end stop" onClick={() => choose('stop')}>{x.stop}</button>
            </div>
          )}
          {!ended && panel !== 'consent' && (
            <div className="mp-split">
              <button className="mp-main" onClick={() => setPanel('consent')}>
                <img src={isotipo} width="22" height="22" alt="" aria-hidden="true" draggable="false" />{x.start}
              </button>
              <button className="mp-more-btn" aria-label={x.more} aria-expanded={panel === 'more'} onClick={() => setPanel(panel === 'more' ? null : 'more')}>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          )}
        </div>
        <div className={`mp-reveal${panel && !ended ? ' open' : ''}`}>
          <div className="mp-reveal-in">
            {panel === 'consent' ? (
              <div className="mp-choices">
                <button className="mp-choice primary" onClick={() => choose('confirmed')}>{x.told}</button>
                <button className="mp-choice" onClick={() => choose('solo')}>{x.solo}</button>
                <button className="mp-choice quiet" onClick={() => setPanel(null)}>{x.back}</button>
              </div>
            ) : (
              <div className="mp-choices row">
                <button className="mp-choice" onClick={() => choose('dismiss')}>{x.notNow}</button>
                <button className="mp-choice" onClick={() => choose('snooze')}>{x.never}</button>
              </div>
            )}
          </div>
        </div>
        <div className="mp-time" aria-hidden="true"><i key={`${m.key}${panel === 'consent' ? 'c' : 'a'}`} style={{ animationDuration: `${ms}ms` }} onAnimationEnd={() => choose(ended ? 'timeout' : 'dismiss')} /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<MeetingPrompt />);
