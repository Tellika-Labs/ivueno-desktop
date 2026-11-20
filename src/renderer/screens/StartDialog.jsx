import { track } from '../lib/telemetry.js';
import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Dialog, Field } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { call } from '../lib/bridge.js';
import { listMics } from '../lib/audio.js';
import { friendly } from '../lib/errors.mjs';
import { useAutoTour } from '../components/Tour.jsx';

/** "Nova reunião": a title and the one consent reminder. Everything else (place, language, notes style, privacy…) comes from the settings. */
export default function StartDialog({ prefill, onClose, onStarted }) {
  useAutoTour('start');
  const t = useT();
  const { settings, nav } = useApp();
  const [title, setTitle] = useState(prefill.title || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [micLabel, setMicLabel] = useState('Microfone predefinido');
  const place = 'both';       // microphone and computer sound: no need to ask where the people are

  useEffect(() => {
    listMics().then((mics) => { const m = mics.find((x) => x.id === settings.micId); if (m) setMicLabel(m.label); });
  }, [settings.micId]);

  async function begin(consent) {
    setBusy(true); setError(null);
    try {
      await call('rec:start', {
        consent,
        input: { place, title: title.trim(), folderId: prefill.folderId || null, template: settings.template, language: settings.language === 'auto' ? null : settings.language, translateTo: settings.translateTo || null, keepTranscript: settings.keepTranscript, redact: settings.redact, attendees: prefill.attendees || [], calendarEventId: prefill.calendarEventId || null },
      });
      track('feature', { name: 'meeting_start', place, consent, template: settings.template, ok: true });
      onStarted();
    } catch (err) { track('feature', { name: 'meeting_start', place, consent, template: settings.template, ok: false, code: err && err.code }); setError(err); setBusy(false); }
  }

  const blocked = error && (error.code === 'limit_reached' || error.code === 'plan_required');

  return (
    <Dialog title={t("Nova reunião")} onClose={onClose}>
      <div className="dialog-body">
        <div data-tour="start-title"><Field label={t("Título")} optional htmlFor="sd-name" hint={prefill.subtitle}>
          <input id="sd-name" className="input" style={{ height: 40, fontSize: 15 }} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field></div>

        <span className="muted" style={{ fontSize: 13 }}>
          {t('Idioma, estilo das notas e privacidade vêm das definições.')}{' '}
          <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); onClose(); nav('settings', { section: 'grav' }); }}>{t('Mudar')}</a>
        </span>
      </div>

      <div className="dialog-foot">
        {error && (
          <Banner tone="error" role="alert" action={blocked ? <a href="#" onClick={(e) => { e.preventDefault(); onClose(); nav('plans'); }}>{t("Ver planos")}</a> : null}>
            <span className="body">{friendly(error)}</span>
          </Banner>
        )}
        <div className="row" data-tour="start-notice" style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="shieldCheck" size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <strong style={{ fontSize: 14 }}>{t("Avisa os participantes que estão a ser gravados.")}</strong>
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
          <span className="muted" style={{ fontSize: 12, flex: '1 1 220px' }}>{t("Os dois botões começam a gravar. “Só eu” é para notas pessoais, sem mais ninguém. A tua resposta fica no registo de consentimento.")}</span>
          <span className="row" data-tour="start-go" style={{ gap: 8 }}>
            <Button disabled={busy} onClick={() => begin('solo')}>{t("Só eu")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => begin('confirmed')}>{t("Já avisei")}</Button>
          </span>
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <span className="row" style={{ gap: 6 }}><Icon name="laptop" size={14} stroke={1.8} />{t("Guardada neste computador.")}</span>
          <span className="row" style={{ gap: 8 }}>{micLabel}{settings.captureSystem ? ' · Som do computador' : ''}
            <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); onClose(); nav('settings', { section: 'grav' }); }}>{t("Mudar")}</a></span>
        </div>
      </div>
    </Dialog>
  );
}
