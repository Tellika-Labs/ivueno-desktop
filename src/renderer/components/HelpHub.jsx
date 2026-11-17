import { track } from '../lib/telemetry.js';
import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Button, Dialog, Switch } from './ui.jsx';
import { useTour } from './Tour.jsx';
import { useApp } from '../lib/app-context.js';
import { call } from '../lib/bridge.js';
import { useT } from '../lib/i18n.js';

/** "Ajuda e tutoriais": every tutorial by use case, with what is new, what was seen, and a way to replay any of them. */
export default function HelpHub({ onClose }) {
  const t = useT();
  const { nav, rec, openStart, settings, patchSettings } = useApp();
  const tour = useTour();
  useEffect(() => { track('feature', { name: 'help_hub', stage: 'open' }); }, []);
  const [latest, setLatest] = useState(undefined);              // the most recent finished meeting, for the "after the meeting" tour
  useEffect(() => {
    call('meetings:list', {}).then((list) => setLatest((list || []).find((m) => m.status !== 'recording' && m.status !== 'paused') || null)).catch(() => setLatest(null));
  }, []);

  const recording = !!rec && (rec.phase === 'recording' || rec.phase === 'paused');
  const ready = (id) => (id === 'live' ? recording : id === 'detail' ? !!latest : id === 'checkout' ? false : true);

  function run(id) {
    tour.start(id);                                             // the screen starts it as soon as it appears
    onClose();
    if (id === 'home') nav('home');
    else if (id === 'start') openStart();
    else if (id === 'live') nav('live');
    else if (id === 'detail') nav('detail', { id: latest.id });
    else if (id === 'tasks') nav('tasks');
    else if (id === 'plans') nav('plans');
    else if (id === 'import') nav('home', { openImport: true });
    else if (id === 'calendar') nav('settings', { section: 'cal' });
  }

  const news = tour.tours.filter((x) => !tour.seen.includes(x.id)).length;
  return (
    <Dialog title={t("Ajuda e tutoriais")} onClose={onClose} wide>
      <div className="dialog-body">
        <p className="muted">{news ? t("Cada tutorial mostra, no próprio ecrã, o que cada coisa faz. Escolhe o que queres fazer.") : t("Já viste tudo. Podes rever qualquer tutorial quando quiseres.")}</p>
        <ul className="hub-list">
          {tour.tours.map((x) => {
            const seen = tour.seen.includes(x.id);
            const ok = ready(x.id);
            return (
              <li key={x.id} className="hub-item">
                <span className="hub-ic" aria-hidden="true"><Icon name={x.icon} size={22} stroke={1.7} /></span>
                <span className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <strong className="row" style={{ gap: 8 }}>{x.title}{!seen && <span className="tag accent" style={{ height: 22, fontSize: 12 }}>{t("Novo")}</span>}</strong>
                  <span className="muted" style={{ fontSize: 14 }}>{ok || !x.where ? x.blurb : x.where}</span>
                </span>
                <Button size="sm" variant={seen ? '' : 'primary'} disabled={!ok} onClick={() => run(x.id)}>{seen ? t("Rever") : t("Ver")}</Button>
              </li>
            );
          })}
        </ul>
        <Switch checked={!settings || settings.autoTours !== false} onChange={(v) => patchSettings({ autoTours: v })}
          label={t("Mostrar dicas automáticas")} hint={t("Cada tutorial aparece sozinho na primeira vez que abres o ecrã.")} />
      </div>
      <div className="dialog-foot" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 13 }}>{t("Podes sair de um tutorial com Esc.")}</span>
        <Button size="sm" onClick={() => tour.reset()} disabled={!tour.seen.length}>{t("Marcar todos como novos")}</Button>
      </div>
    </Dialog>
  );
}
