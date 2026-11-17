import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useT } from '../lib/i18n.js';

/** A titled row of cards that scrolls sideways: arrows for mouse users, a fade where more is waiting, snapping when it stops. */
export default function Carousel({ id, title, tour, aside = null, empty = null, children }) {
  const t = useT();
  const track = useRef(null);
  const [edge, setEdge] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (el) setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [measure, children]);

  const go = (dir) => track.current && track.current.scrollBy({ left: dir * Math.max(280, track.current.clientWidth * 0.8), behavior: 'smooth' });
  const overflows = !(edge.start && edge.end);

  return (
    <section aria-labelledby={id} data-tour={tour} className="col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
        <h2 id={id} className="section">{title}</h2>
        <div className="row" style={{ gap: 8 }}>
          {aside}
          {overflows && (
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="icon-btn sm bordered" aria-label={t('Anterior')} disabled={edge.start} onClick={() => go(-1)}><Icon name="back" size={16} stroke={2} /></button>
              <button type="button" className="icon-btn sm bordered" aria-label={t('Seguinte')} disabled={edge.end} onClick={() => go(1)}><Icon name="back" size={16} stroke={2} style={{ transform: 'rotate(180deg)' }} /></button>
            </div>
          )}
        </div>
      </div>
      {empty || (
        <div className={`up-grid${edge.end ? '' : ' more'}`} ref={track} onScroll={measure} role="list">{children}</div>
      )}
    </section>
  );
}
