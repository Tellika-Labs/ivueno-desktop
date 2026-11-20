import React, { useEffect, useState } from 'react';
import { Banner, Button, Skeleton } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useApp } from '../lib/app-context.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

/** A teammate's meeting, read-only: summary, notes, tasks, transcript, and a question box. Nothing here can change the meeting. */
export default function SharedMeeting() {
  const t = useT();
  const { nav, route } = useApp();
  const id = route.id;
  const [m, setM] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setError('');
    call('shared:meeting', id).then((x) => alive && setM(x)).catch((e) => alive && setError(friendly(e)));
    call('shared:segments', id).then((p) => alive && setLines((p && p.items) || [])).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  async function ask(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true); setQuestion('');
    const history = chat.map((c) => ({ role: c.role, content: c.text }));
    setChat((c) => [...c, { role: 'user', text: q }]);
    try {
      const r = await call('shared:chat', { id, message: q, history });
      setChat((c) => [...c, { role: 'assistant', text: r.answer }]);
    } catch (err) { setError(friendly(err)); } finally { setBusy(false); }
  }

  return (
    <div className="page framed" style={{ '--max': 'clamp(880px, 68vw, 1240px)' }}>
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => nav('shared', { folderId: route.folderId })}><Icon name="back" size={16} />{t('Voltar')}</button>
      {error && <Banner tone="danger" role="alert">{error}</Banner>}
      {!m && !error && <Skeleton />}
      {m && (
        <>
          <h1 className="page-title">{m.title || t('Reunião sem título')}</h1>
          <Banner tone="info" icon="lock">{t('Só o dono pode editar esta reunião.')}</Banner>
          {m.summary && <section><h2>{t('Resumo')}</h2><p>{m.summary}</p></section>}
          {m.user_notes && <section><h2>{t('Notas')}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{m.user_notes}</p></section>}
          {m.ai_notes && <section><h2>{t('Notas da Ivueno')}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{m.ai_notes}</p></section>}
          {(m.action_items || []).length > 0 && <section><h2>{t('Tarefas')}</h2><ul>{m.action_items.filter((a) => !a.hidden).map((a) => <li key={a.id}>{a.done ? '☑' : '☐'} {a.text}</li>)}</ul></section>}
          {lines.length > 0 && <section><h2>{t('Transcrição')}</h2>{lines.map((l) => <p key={l.id}><strong>{(((m.speakers || []).find((sp) => sp.key === l.speaker_key)) || {}).name || l.speaker_key}</strong> {l.text}</p>)}</section>}
          <section>
            <h2>{t('Perguntar sobre esta reunião')}</h2>
            {chat.map((c, i) => <p key={i} className={c.role === 'user' ? 'muted' : ''}>{c.text}</p>)}
            <form className="row" style={{ gap: 8 }} onSubmit={ask}>
              <label className="sr-only" htmlFor="shared-q">{t('Pergunta')}</label>
              <input id="shared-q" className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('Pergunta')} />
              <Button type="submit" variant="primary" disabled={busy || !question.trim()}>{t('Perguntar')}</Button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
