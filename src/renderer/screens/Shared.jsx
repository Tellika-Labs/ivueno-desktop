import React, { useEffect, useState } from 'react';
import { Banner, Skeleton } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useApp } from '../lib/app-context.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

/** What teammates shared with me: their folders and, inside, their meetings. Read-only. */
export default function Shared() {
  const t = useT();
  const { nav, route } = useApp();
  const [folders, setFolders] = useState(null);
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState('');
  const folderId = route.folderId || null;

  useEffect(() => {
    let alive = true;
    setError('');
    call('shared:folders').then((f) => alive && setFolders(f || [])).catch((e) => alive && setError(friendly(e)));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!folderId) { setMeetings(null); return undefined; }
    let alive = true;
    call('shared:meetings', { folderId }).then((p) => alive && setMeetings((p && p.items) || [])).catch((e) => alive && setError(friendly(e)));
    return () => { alive = false; };
  }, [folderId]);

  const folder = (folders || []).find((f) => f.id === folderId);

  return (
    <div className="page framed" style={{ '--max': 'clamp(880px, 68vw, 1240px)' }}>
      <h1 className="page-title">{folder ? folder.name : t('Partilhadas comigo')}</h1>
      {folder && <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => nav('shared')}><Icon name="back" size={16} />{t('Voltar')}</button>}
      {error && <Banner tone="danger" role="alert">{error}</Banner>}
      {!folders && !error && <Skeleton />}
      {folders && !folderId && folders.length === 0 && <p className="muted">{t('Ninguém partilhou pastas contigo ainda.')}</p>}
      {folders && !folderId && folders.map((f) => (
        <button key={f.id} type="button" className="card row" style={{ gap: 12, textAlign: 'left', padding: 14 }} onClick={() => nav('shared', { folderId: f.id })}>
          <Icon name="folder" size={20} />
          <span className="col grow"><strong>{f.name}</strong><span className="muted" style={{ fontSize: 12 }}>{t('Partilhada por {name}', { name: f.owner_name || '' })} · {f.org_name}</span></span>
          <span className="count">{f.meeting_count}</span>
        </button>
      ))}
      {folderId && !meetings && !error && <Skeleton />}
      {folderId && meetings && meetings.length === 0 && <p className="muted">{t('Esta pasta ainda não tem reuniões.')}</p>}
      {folderId && meetings && meetings.map((m) => (
        <button key={m.id} type="button" className="card row" style={{ gap: 12, textAlign: 'left', padding: 14 }} onClick={() => nav('sharedMeeting', { id: m.id, folderId })}>
          <Icon name="chat" size={18} />
          <span className="col grow"><strong>{m.title || t('Reunião sem título')}</strong><span className="muted" style={{ fontSize: 12 }}>{m.started_at ? new Date(m.started_at).toLocaleString() : ''}</span></span>
        </button>
      ))}
    </div>
  );
}
