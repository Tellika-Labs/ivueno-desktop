import { aiLimitRows, AI_ACTION_LABELS } from '../lib/ai-usage.mjs';
import { useAutoTour } from '../components/Tour.jsx';
import React, { useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Seg } from '../components/ui.jsx';
import { PLAN_NAMES, useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { friendly } from '../lib/errors.mjs';
import { PITCH, kz } from '../lib/pay.js';

const FEATURE_TEXT = {
  local_engine: 'Gravação de reuniões e notas', unlimited_meetings: 'Reuniões sem limite', cloud_transcription: 'Transcrição de áudio na nuvem',
  cloud_notes: 'Notas, resumos e emails escritos por IA', sync: 'Sincronização entre computadores, encriptada: só tu a podes abrir', team: 'Organização, lugares e pastas partilhadas',
  admin_console: 'Consola de administração', sso: 'Início de sessão da empresa (SSO)', audit_log: 'Registo de auditoria', retention_policy: 'Regras de retenção',
};

/** Plans. Choosing a paid plan opens the checkout page. */
export default function Plans() {
  const t = useT();
  const { auth, nav, toast } = useApp();
  const { data, error } = useQuery('plans:list', null, {});
  const { data: waiting } = useQuery('billing:waiting', null, {});
  useAutoTour('plans', !!data);
  const [kind, setKind] = useState('personal');
  const current = auth.licence.plan;
  const plans = (data || []).filter((p) => p.audience === kind);

  function choose(plan) {
    if (!plan.price_aoa_month) { toast(friendly({ code: 'not_sold_online' })); return; }
    nav('checkout', { plan: plan.id });
  }

  return (
    <div className="page framed">
      <div className="page-inner" style={{ gap: 24 }}>
        <header className="col" style={{ gap: 12, alignItems: 'flex-start' }}>
          <h1 className="display">{t("Planos")}</h1>
          <p className="muted" style={{ maxWidth: 520 }}>{t("As reuniões ficam sempre guardadas no teu computador. O áudio e o texto só são enviados para transcrever e escrever as notas, e nada fica guardado no servidor.")}</p>
          <div data-tour="plans-kind"><Seg label={t("Tipo de plano")} value={kind} onChange={setKind} options={[{ id: 'personal', label: 'Pessoal' }, { id: 'enterprise', label: 'Empresa' }]} /></div>
        </header>
        <div className="page-scroll">
        {error && <Banner tone="error" role="alert">{friendly(error)}</Banner>}
        {waiting && (
          <Banner tone="info" action={<Button size="sm" onClick={() => nav('checkout', { resume: true })}>{t("Continuar")}</Button>}>
            {t('Tens um pagamento por concluir: {name}, {amount}.', { name: PLAN_NAMES[waiting.plan] || waiting.plan, amount: kz(waiting.amount) })}
          </Banner>
        )}
        <div className="plan-grid" data-tour="plans-grid">
          {plans.map((p) => (
            <div key={p.id} className={`plan ${p.id === current ? 'current' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 18 }}>{p.name === 'Free' ? t('Gratuito') : p.name}</strong>
                {p.id === current && <span className="tag accent">{t("O teu plano")}</span>}
              </div>
              <div><span className="price">{p.price_aoa_month ? kz(p.price_aoa_month) : p.price_usd_month === 0 ? kz(0) : t('Sob consulta')}</span>
                <span className="muted">{p.price_aoa_month ? (p.per_seat ? t(' /lugar/mês') : t(' /mês')) : ''}</span></div>
              <span className="muted" style={{ minHeight: 40 }}>{t(PITCH[p.id] || p.description)}</span>
              <Button variant={p.id === current || p.id === 'free' ? '' : 'primary'} data-tour={p.id !== current && p.id !== 'free' && p.price_aoa_month ? 'plans-upgrade' : undefined} disabled={p.id === current || p.id === 'free'} onClick={() => choose(p)}>
                {p.id === current ? t('O teu plano') : p.id === 'free' ? t('Plano gratuito') : !p.price_aoa_month ? t('Falar connosco') : t('Passar para {name}', { name: p.name })}
              </Button>
              <ul>
                <li><Icon name="check" size={16} stroke={2.2} />{p.meetings_per_month == null ? t('Reuniões sem limite') : t('{n} reuniões por mês', { n: p.meetings_per_month })}</li>
                {p.features.filter((f) => f !== 'unlimited_meetings').map((f) => <li key={f}><Icon name="check" size={16} stroke={2.2} />{t(FEATURE_TEXT[f] || f)}</li>)}
                {p.cloud_minutes ? <li><Icon name="check" size={16} stroke={2.2} />{t('{n} minutos de transcrição por mês', { n: p.cloud_minutes })}{p.per_seat ? t(' por lugar') : ''}</li> : null}
                {aiLimitRows(p.ai_limits).filter((r) => r.key === 'ask_total').map((r) => <li key="ask"><Icon name="check" size={16} stroke={2.2} />{t('{n} perguntas, receitas, resumos e emails por mês', { n: r.limit })}{p.per_seat && p.id === 'team' ? t(' por lugar') : ''}</li>)}
              </ul>
              {aiLimitRows(p.ai_limits).length > 0 && (
                <details className="muted" style={{ fontSize: 12 }}>
                  <summary>{t('Limites por ação')}</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                    {aiLimitRows(p.ai_limits).map((r) => <li key={r.key}>{t(AI_ACTION_LABELS[r.key])}: {r.limit == null ? t('Sem limite') : r.limit}</li>)}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
        <span className="muted" data-tour="plans-note" style={{ textAlign: 'center', fontSize: 12 }}>{t("Preços em Kwanza, por mês, IVA incluído. Sem renovação automática: avisamos-te antes de acabar.")}</span>
        </div>
      </div>
    </div>
  );
}
