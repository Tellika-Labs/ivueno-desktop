import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Field } from './ui.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

const REWARD = { discount_30: '30% de desconto no próximo pagamento', free_months_2: '2 meses grátis' };
const STATUS = { available: 'Disponível', used: 'Usada' };

/** Settings › Plano e uso: the person's invite code and link, how many friends are paying, and the rewards earned. */
export default function ReferralCard() {
  const t = useT();
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const load = () => call('referral:me').then(setData).catch((e) => setError(friendly(e)));
  useEffect(() => { load(); }, []);
  // Someone who signed up without a code (or with Google) can still add one before their first payment.
  const useCode = async () => {
    try {
      const r = await call('referral:apply', { code: typed.trim() });
      toast(r && r.applied ? t('Código aplicado. O teu primeiro pagamento tem desconto.') : t('Este código não serve: não existe, é o teu, ou já fizeste um pagamento.'));
      if (r && r.applied) { setTyped(''); load(); }
    } catch (e) { toast(friendly(e)); }
  };

  if (error) return <section className="card" aria-labelledby="st-invite"><h2 id="st-invite">{t('Convida amigos')}</h2><Banner tone="error" role="alert">{error}</Banner></section>;
  if (!data) return null;

  const message = t('Usa o meu código {code} ao criar a tua conta Ivueno e ganhas {pct}% de desconto no primeiro pagamento: {link}', { code: data.code, pct: data.friend_discount_pct, link: data.link });
  const copy = async () => { try { await navigator.clipboard.writeText(data.code); toast(t('Copiado')); } catch { /* clipboard blocked */ } };
  const share = () => call('shell:openExternal', `https://wa.me/?text=${encodeURIComponent(message)}`).catch((e) => toast(friendly(e)));
  const target = data.next_milestone;
  return (
    <section id="convites" className="card" aria-labelledby="st-invite">
      <h2 id="st-invite">{t('Convida amigos')}</h2>
      <p className="muted">{t('Dá o teu código a um amigo. Ele tem {pct}% de desconto no primeiro pagamento e tu ganhas recompensas quando os amigos pagam.', { pct: data.friend_discount_pct })}</p>
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <code aria-label={t('O teu código')} style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.08em' }}>{data.code}</code>
        <Button size="sm" icon="copy" onClick={copy}>{t('Copiar código')}</Button>
        <Button size="sm" onClick={share}>{t('Enviar por WhatsApp')}</Button>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span style={{ fontWeight: 600 }}>
          {target ? t('{n} de {m} amigos a pagar', { n: data.qualified, m: target }) : t('Já ganhaste todas as recompensas.')}
        </span>
        {target && <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(data.qualified, target)}><div style={{ width: `${Math.min(100, (data.qualified / target) * 100)}%` }} /></div>}
        {target && data.next_reward && <span className="muted" style={{ fontSize: 13 }}>{t('Ao chegar lá: {reward}.', { reward: t(REWARD[data.next_reward] || '') })}</span>}
      </div>
      {data.rewards.length > 0 && (
        <ul className="col" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
          {data.rewards.map((r) => <li key={r.milestone}>{t(REWARD[r.kind] || r.kind)} · <span className="muted">{t(STATUS[r.status] || r.status)}</span></li>)}
        </ul>
      )}
      <p className="muted" style={{ fontSize: 13 }}>{t('Um amigo conta quando o primeiro pagamento dele tem uma semana e não foi devolvido.')}</p>
      {!data.invited && (
        <div className="row wrap form-row" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <Field label={t('Tens um código de convite?')} htmlFor="st-invite-code" hint={t('Dá {pct}% de desconto no teu primeiro pagamento.', { pct: data.friend_discount_pct })}>
            <input id="st-invite-code" className="input" style={{ maxWidth: 220 }} value={typed} maxLength={20} autoComplete="off" spellCheck={false} placeholder="ABCD2345" onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <Button disabled={!typed.trim()} onClick={useCode}>{t('Usar código')}</Button>
        </div>
      )}
    </section>
  );
}
