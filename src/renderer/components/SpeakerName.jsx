import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Banner, Button, Dialog, Field } from './ui.jsx';
import Icon from './Icon.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

/** A name belongs to the speaker in the meeting, rather than to one transcript line. */
export default function SpeakerName({ meetingId, speaker, chip = false }) {
  const t = useT();
  const inputId = useId();
  const opener = useRef(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const display = speaker.name || (speaker.isMe ? t('Tu') : t('Orador {n}', { n: String(speaker.key).replace('spk_', '') }));

  function close() {
    if (saving) return;
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    try {
      await call('speakers:rename', { id: meetingId, key: speaker.key, name: name.trim() });
      setOpen(false);
      requestAnimationFrame(() => opener.current?.focus());
    } catch (err) {
      setError(friendly(err));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button ref={opener} type="button" className={chip ? 'spk-chip' : 'speaker-name'}
      title={t('Mudar o nome de {name}', { name: display })} aria-label={t('Mudar o nome de {name}', { name: display })}
      onClick={() => { setName(speaker.name || ''); setError(''); setOpen(true); }}>
      {chip && <Avatar color={speaker.color} size="sm" initials={speaker.initials} />}
      <span>{display}{chip && speaker.isMe ? ` ${t('(tu)')}` : ''}</span>
      <Icon name="edit" size={13} />
    </button>
    {open && createPortal(
      <Dialog title={t('Nome do orador')} onClose={close}>
        <form onSubmit={save} className="dialog-body col" style={{ gap: 16 }}>
          <p className="muted">{t('Este nome será usado em todas as falas deste orador nesta reunião.')}</p>
          <Field label={t('Nome')} htmlFor={inputId} hint={t('Deixa vazio para voltar ao nome automático.')}>
            <input id={inputId} className="input" autoFocus maxLength={80} value={name} placeholder={display}
              disabled={saving} onChange={(event) => setName(event.target.value)} />
          </Field>
          {error && <Banner tone="error" role="alert">{error}</Banner>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={close} disabled={saving}>{t('Cancelar')}</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? t('A guardar…') : t('Guardar')}</Button>
          </div>
        </form>
      </Dialog>, document.body)}
  </>;
}
