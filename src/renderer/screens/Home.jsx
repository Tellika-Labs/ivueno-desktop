import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Skeleton, RecDot } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import VerifyEmail from './VerifyEmail.jsx';
import SyncPrompt from '../components/SyncPrompt.jsx';
import PayBanners from '../components/PayBanners.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import Carousel from '../components/Carousel.jsx';
import Dropdown from '../components/Dropdown.jsx';
import { useAutoTour } from '../components/Tour.jsx';
import { Avatar } from '../components/ui.jsx';
import { clockStr, durationStr, eventWhen, groupByDay, hm, initialsOf, monthName, statusOf, tasksLabel } from '../lib/format.mjs';


/** "Agora" while it is on, "Em 25 min" / "Em 3 h" when it starts within the next six hours, nothing otherwise. */
function soonLabel(e, nowMs, t) {
  if (nowMs >= e.start && nowMs <= e.end) return t('Agora');
  const mins = Math.round((e.start - nowMs) / 60000);
  if (mins <= 0 || mins > 360) return '';
  return mins < 60 ? t('Em {n} min', { n: mins }) : t('Em {n} h', { n: Math.round(mins / 60) });
}

export default function Home() {
  const t = useT();
  const { route, nav, rec, openStart, auth, settings, patchSettings } = useApp();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(8);
  const [verifying, setVerifying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dropped, setDropped] = useState(null);                 // an audio file dropped on the page
  const folderId = route.folderId || null;
  const folders = useQuery('folders:list', null, { kinds: ['folders'] });
  const list = useQuery('meetings:list', { folderId, q }, { kinds: ['meetings', 'folders'] });
  const usage = useQuery('usage:get', null, { kinds: ['meetings'] });
  const cal = useQuery('calendar:upcoming', null, { kinds: [] });

  useAutoTour('home', !!cal.data && !list.loading && !importing);
  useEffect(() => { if (route.openImport) setImporting(true); }, [route]);          // asked for by the Help hub

  const recording = rec && (rec.phase === 'recording' || rec.phase === 'paused');
  const meetings = (list.data || []).filter((m) => m.status !== 'recording' && m.status !== 'paused');
  const visible = meetings.slice(0, limit);
  const groups = groupByDay(visible);
  const folderName = folderId && folders.data ? (folders.data.find((f) => f.id === folderId) || {}).name : '';
  const u = usage.data;
  const now = new Date();
  const nextReset = t('1 de {month}', { month: monthName(new Date(now.getFullYear(), now.getMonth() + 1, 1)) });
  const loading = list.loading;
  const totalEver = (list.data || []).length;

  const showRecent = loading || meetings.length > 0;
  const recentEmpty = showRecent && !loading ? null : (
    <div className="col" style={{ gap: 14 }} aria-busy={loading || undefined}>
      {loading && <><Skeleton w="55%" /><Skeleton w="68%" /><Skeleton w="40%" /></>}
      {!loading && totalEver === 0 && !q && (
        <div className="empty">
          <h3>{t("Grava a tua primeira reunião.")}</h3>
          <p className="muted" style={{ maxWidth: 320 }}>{t("Funciona com Zoom, Meet, Teams, WhatsApp ou uma conversa na mesma sala. Nenhum bot entra na chamada.")}</p>
          <Button variant="primary" size="lg" onClick={() => openStart()}>{t("Começar a gravar")}</Button>
          <span className="muted" style={{ fontSize: 12 }}>{t("Guardada neste computador.")}</span>
        </div>
      )}
      {!loading && totalEver > 0 && meetings.length === 0 && <p className="muted">{t("Nenhuma reunião encontrada.")}</p>}
    </div>
  );
  const nextCount = (cal.data ? cal.data.events.length : 0) + (recording ? 1 : 0);
  const nextEmpty = nextCount > 0 ? null : (
    <div className="up-empty">
      {cal.data && !cal.data.connected && <><span>{t("Vê aqui as reuniões das próximas 48 horas.")}</span><Button size="sm" onClick={() => nav('settings', { section: 'cal' })}>{t("Liga o teu calendário")}</Button></>}
      {cal.data && cal.data.connected && cal.data.error && <span>{t("Não foi possível ler o calendário agora.")}</span>}
      {cal.data && cal.data.connected && !cal.data.error && <span>{t("Não tens reuniões marcadas nas próximas 48 horas.")}</span>}
      {!cal.data && <Skeleton w="40%" />}
    </div>
  );

  return (
    <div className="page framed" onDragOver={(e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|opus|flac|webm|mp4)$/i.test(f.name))) { e.preventDefault(); setDropped(f); setImporting(true); } }}>
      <div className="page-inner">
        <header className="page-head">
          <h1 className="display">{folderName || t('Início')}</h1>
          <div className="row wrap grow" style={{ justifyContent: 'flex-end', flex: '1 1 420px' }}>
            <div className="search-wrap grow" data-tour="search" style={{ maxWidth: 360, flex: '1 1 220px' }}>
              <label className="sr-only" htmlFor="h-search">{t("Pesquisar reuniões")}</label>
              <Icon name="search" size={18} />
              <input id="h-search" className="input search" placeholder={t("Pesquisar reuniões")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="sr-only" htmlFor="h-folder">{t("Filtrar por pasta")}</label>
            <Dropdown id="h-folder" label={t('Filtrar por pasta')} icon="folder" value={folderId || ''} onChange={value => nav('home', { folderId: value || null })}
              options={[{ id: '', label: t('Todas as pastas') }, ...(folders.data || []).map(f => ({ id: f.id, label: f.name }))]} />
            <Button icon="arrowDown" data-tour="import" onClick={() => { setDropped(null); setImporting(true); }}>{t("Importar áudio")}</Button>
            {!recording && <Button variant="primary" icon="plus" onClick={() => openStart()}>{t("Nova reunião")}</Button>}
          </div>
        </header>

        <div className="page-scroll">
        <SyncPrompt />
        {auth.user && auth.user.email_verified === false && (
          <Banner tone="info" action={<Button size="sm" onClick={() => setVerifying(true)}>{t('Introduzir código')}</Button>}>
            {t('Confirma o teu email para criares organizações, convidares pessoas ou comprares um plano.')}
          </Banner>
        )}

        <PayBanners />

        {settings && !settings.telemetryNoticeSeen && (
          <Banner tone="info" action={(
            <span className="row" style={{ gap: 8 }}>
              <Button size="sm" onClick={() => { patchSettings({ telemetryNoticeSeen: true }).catch(() => {}); nav('settings', { section: 'priv' }); }}>{t("Saber mais")}</Button>
              <Button size="sm" onClick={() => patchSettings({ telemetryNoticeSeen: true }).catch(() => {})}>{t("Percebi")}</Button>
            </span>
          )}>
            {t("A Ivueno regista como usas a app (ecrãs, funcionalidades, tempos e erros) para a melhorar. Nunca regista o conteúdo das tuas reuniões.")}
          </Banner>
        )}

        {u && u.limit != null && (
          <Banner tone={u.used >= u.limit ? 'warn' : 'info'} action={<a href="#" onClick={(e) => { e.preventDefault(); nav('plans'); }}>{t("Ver planos")}</a>}>
            {u.used >= u.limit
              ? t('Usaste {limit} de {limit} reuniões este mês. Podes continuar a ler, editar e exportar. Novas gravações voltam a {reset}.', { limit: u.limit, reset: nextReset })
              : t('Usaste {used} de {limit} reuniões este mês. O contador volta a zero a {reset}.', { used: u.used, limit: u.limit, reset: nextReset })}
          </Banner>
        )}

        <Carousel id="h-recent" tour="recents" title={t("Recentes")} empty={recentEmpty}>
          {groups.flatMap((g) => g.items.map((m) => {
            const st = statusOf(m);
            const tasks = tasksLabel(m);
            return (
              <button type="button" role="listitem" key={m.id} className="m-card" onClick={() => nav('detail', { id: m.id })} title={m.title}>
                <span className="m-card-top">
                  <span className="m-card-when">{g.heading.split(' · ')[0]}, {hm(m.startedAt || m.createdAt)}</span>
                  <span className={`m-card-state tone-${st.tone}`}><i aria-hidden="true" />{st.label}</span>
                </span>
                <strong className="m-card-title">{m.title || t('Reunião sem título')}</strong>
                <span className={`m-card-sum${m.summary ? '' : ' muted'}`}>{m.summary || (m.notesState === 'writing' ? t('A escrever as notas…') : t('Sem resumo ainda.'))}</span>
                <span className="m-card-foot">
                  {m.durationSeconds ? <span className="m-card-fact"><Icon name="clock" size={14} />{durationStr(m.durationSeconds)}</span> : null}
                  {tasks ? <span className={`m-card-fact${m.openTasks ? ' open' : ''}`}><Icon name="tasks" size={14} />{tasks}</span> : null}
                  {m.folderName ? <span className="m-card-folder"><Icon name="folder" size={14} />{m.folderName}</span> : null}
                </span>
              </button>
            );
          }))}
        </Carousel>
        {meetings.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 20)} style={{ alignSelf: 'flex-start' }}>{t("Mostrar reuniões anteriores")}</Button>}

        <Carousel id="h-next" tour="next" title={t("A seguir")} empty={nextEmpty}
          aside={<span className="muted" style={{ fontSize: 12 }}>{t('Próximas 48 horas')}{cal.data && cal.data.connected ? ` · ${t('O teu calendário')}` : ''}</span>}>
          {recording && (
            <div className="up-card live" role="listitem">
              <div className="col" style={{ gap: 4 }}>
                <span className="row tone-rec" style={{ fontSize: 12, gap: 6 }}><RecDot small />{rec.phase === 'paused' ? t('Em pausa') : t('A gravar')} · <span className="mono">{clockStr(rec.elapsedMs)}</span></span>
                <strong>{rec.title || t('Reunião sem título')}</strong>
              </div>
              <div><Button variant="primary" size="sm" onClick={() => nav('live')}>{t("Abrir notas")}</Button></div>
            </div>
          )}
          {cal.data && cal.data.events.map((e) => {
            const when = soonLabel(e, now.getTime(), t);
            return (
              <div className={`up-card${when === t('Agora') ? ' now' : ''}`} key={e.id} role="listitem">
                <div className="col" style={{ gap: 6 }}>
                  <span className="up-when"><span className="mono">{eventWhen(e.start, e.end)}</span>{when && <span className="up-soon">{when}</span>}</span>
                  <strong className="m-card-title">{e.title}</strong>
                </div>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    {e.attendees.length > 0 && (
                      <span className="row" aria-hidden="true">{e.attendees.slice(0, 3).map((a, i) => <Avatar key={i} color={i + 2} stack initials={initialsOf(a.name || a.email)} title={a.name || a.email} />)}</span>
                    )}
                    <span className="muted up-who">{e.attendees.length ? e.attendees.slice(0, 2).map((a) => a.name || a.email).join(', ') + (e.attendees.length > 2 ? ` +${e.attendees.length - 2}` : '') : ''}</span>
                  </span>
                  {!recording && <Button size="sm" onClick={() => openStart({ title: e.title, attendees: e.attendees, calendarEventId: e.id, subtitle: t('Do teu calendário · {from}–{to}', { from: hm(new Date(e.start).toISOString()), to: hm(new Date(e.end).toISOString()) }) })}>{t("Tomar notas")}</Button>}
                </div>
              </div>
            );
          })}
        </Carousel>
        </div>
      </div>
      {verifying && <VerifyEmail onClose={() => setVerifying(false)} />}
      {importing && <ImportDialog initialFile={dropped} onClose={() => { setImporting(false); setDropped(null); }} />}
    </div>
  );
}
