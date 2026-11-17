import { track } from '../lib/telemetry.js';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { Button } from './ui.jsx';
import { useApp } from '../lib/app-context.js';
import { useT } from '../lib/i18n.js';
import { buildTours } from './tours.jsx';

/**
 * Guided tours: the page dims, one real element is lit, and a small card explains it. Each tour belongs to a use case and
 * runs by itself the first time its screen appears (unless the person turned the tips off); the Help hub replays any of them.
 * "Seen" is remembered in the settings (toursSeen) so a tour never nags twice.
 */
const TourContext = createContext(null);
export const useTour = () => useContext(TourContext) || { start() {}, maybeStart() {}, active: null, seen: [], tours: [], reset() {} };

/** Call from a screen: starts the tour once the screen is ready (a short pause lets the page settle first). */
export function useAutoTour(id, ready = true) {
  const { maybeStart } = useTour();
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => maybeStart(id), 800);
    return () => clearTimeout(timer);
  }, [id, ready, maybeStart]);
}

export function TourProvider({ children }) {
  const { settings, patchSettings } = useApp();
  const t = useT();
  const tours = useMemo(() => buildTours(t), [t]);
  const [active, setActive] = useState(null);                 // { id, index }
  const queued = useRef(null);                                // a tour the Help hub asked for: runs even if already seen
  const [tick, setTick] = useState(0);                      // changes when one is asked for, so a screen that is already open starts it
  const seen = (settings && settings.toursSeen) || [];
  const auto = !settings || settings.autoTours !== false;

  const begin = useCallback((id) => { if (tours.some((x) => x.id === id)) { setActive({ id, index: 0 }); track('feature', { name: 'tour', stage: 'start', tour: id }); } }, [tours]);
  const start = useCallback((id) => { queued.current = id; setTick((n) => n + 1); }, []);          // the screen calls maybeStart when it appears
  const maybeStart = useCallback((id) => {
    if (active) return;
    if (queued.current === id) { queued.current = null; begin(id); return; }
    if (auto && !seen.includes(id)) begin(id);
  }, [active, auto, seen, begin, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = useCallback(() => {
    if (active) track('feature', { name: 'tour', stage: active.index >= (tours.find((x) => x.id === active.id) || { steps: [] }).steps.length - 1 ? 'done' : 'skip', tour: active.id, step: active.index });
    if (active && !seen.includes(active.id)) patchSettings({ toursSeen: [...seen, active.id] });      // skipped or finished: either way it was seen
    setActive(null);
  }, [active, seen, patchSettings, tours]);
  const reset = useCallback(() => patchSettings({ toursSeen: [] }), [patchSettings]);

  const value = useMemo(() => ({ start, maybeStart, active, seen, tours, reset, auto }), [start, maybeStart, active, seen, tours, reset, auto]);
  const tour = active && tours.find((x) => x.id === active.id);
  return (
    <TourContext.Provider value={value}>
      {children}
      {tour && <TourLayer key={tour.id} tour={tour} index={active.index} setIndex={(i) => setActive({ id: tour.id, index: i })} onClose={close} />}
    </TourContext.Provider>
  );
}

const PAD = 8, GAP = 14, CARD_W = 392, MARGIN = 16;

function useTargetRect(selector, stepKey) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    let raf = 0; let last = ''; let scrolled = false;
    const tick = () => {
      const el = selector ? document.querySelector(selector) : null;
      let next = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          if (!scrolled) { scrolled = true; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
          next = { x: r.left, y: r.top, w: r.width, h: r.height, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12 };
        }
      }
      const key = next ? [next.x, next.y, next.w, next.h].map(Math.round).join() : '';
      if (key !== last) { last = key; setRect(next); }
      raf = requestAnimationFrame(tick);                        // follows layout changes and animations; setState only when it moved
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selector, stepKey]);
  return rect;
}

function placeCard(rect, placement, height) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!rect) return { left: Math.max(MARGIN, (vw - CARD_W) / 2), top: Math.max(MARGIN, (vh - height) / 2) };
  const room = { bottom: vh - (rect.y + rect.h) - PAD - GAP, top: rect.y - PAD - GAP, right: vw - (rect.x + rect.w) - PAD - GAP, left: rect.x - PAD - GAP };
  let side = placement || 'bottom';
  const fits = (s) => (s === 'bottom' || s === 'top' ? room[s] >= height : room[s] >= CARD_W);
  if (!fits(side)) side = ['bottom', 'top', 'right', 'left'].find(fits) || 'bottom';
  let left; let top;
  if (side === 'bottom' || side === 'top') {
    left = rect.x + rect.w / 2 - CARD_W / 2;
    top = side === 'bottom' ? rect.y + rect.h + PAD + GAP : rect.y - PAD - GAP - height;
  } else {
    top = rect.y + rect.h / 2 - height / 2;
    left = side === 'right' ? rect.x + rect.w + PAD + GAP : rect.x - PAD - GAP - CARD_W;
  }
  return { left: Math.min(Math.max(MARGIN, left), vw - CARD_W - MARGIN), top: Math.min(Math.max(MARGIN, top), vh - height - MARGIN) };
}

function TourLayer({ tour, index, setIndex, onClose }) {
  const t = useT();
  const step = tour.steps[index];
  const last = index === tour.steps.length - 1;
  const rect = useTargetRect(step.target, `${tour.id}:${index}`);
  const card = useRef(null);
  const [height, setHeight] = useState(220);

  useLayoutEffect(() => { if (card.current) setHeight(card.current.offsetHeight); }, [index, rect]);
  useEffect(() => {
    const previous = document.activeElement;
    return () => { if (previous && previous.focus) previous.focus(); };
  }, []);
  useEffect(() => { const b = card.current && card.current.querySelector('.btn.primary'); if (b) b.focus({ preventScroll: true }); }, [index]);

  const next = useCallback(() => (last ? onClose() : setIndex(index + 1)), [last, index, onClose, setIndex]);
  const back = useCallback(() => { if (index > 0) setIndex(index - 1); }, [index, setIndex]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [next, back, onClose]);

  const pos = placeCard(rect, step.placement, height);
  return createPortal(
    <div className="tour" data-tour-layer>
      <div className="tour-block" onMouseDown={(e) => e.preventDefault()} />
      {rect
        ? <div className="tour-spot" style={{ left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2, borderRadius: rect.radius + PAD / 2 }} />
        : <div className="tour-dim" />}
      <div className="tour-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" style={{ left: pos.left, top: pos.top, width: CARD_W }}>
        <div className="tour-top">
          <span className="tour-count">{t('{n} de {total}', { n: index + 1, total: tour.steps.length })}</span>
          <span className="tour-name">{tour.title}</span>
          <button type="button" className="icon-btn sm" aria-label={t('Saltar tutorial')} title={t('Saltar tutorial')} onClick={onClose}><Icon name="close" size={16} stroke={2} /></button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-foot">
          <span className="tour-dots" aria-hidden="true">{tour.steps.map((_, i) => <i key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />)}</span>
          <span className="row" style={{ gap: 8 }}>
            {index > 0 && <Button size="sm" onClick={back}>{t('Anterior')}</Button>}
            <Button size="sm" variant="primary" onClick={next}>{last ? t('Percebi') : t('Seguinte')}</Button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
