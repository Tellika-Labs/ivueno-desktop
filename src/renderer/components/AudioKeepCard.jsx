import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog, Field } from './ui.jsx';
import { call, on } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';
import Dropdown from './Dropdown.jsx';

const KEEP = [['off', 'Não guardar'], ['final', 'Até terminar o tratamento depois da reunião'], ['7d', '7 dias'], ['30d', '30 dias']];
const AFTER = [['voices', 'Separar as vozes das pessoas (recomendado)'], ['text', 'Separar as vozes e transcrever outra vez'], ['off', 'Não fazer nada']];
const size = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** The person's own terms and names, sent to the speech service as a short hint. Empty = no hint (there is no built-in list). */
export function GlossaryField() {
  const t = useT();
  const { settings, patchSettings } = useApp();
  const [value, setValue] = useState(settings.glossary || '');
  return (
    <Field label={t('Termos e nomes frequentes')} htmlFor="st-glossary" hint={t('Opcional. Palavras que a transcrição costuma errar: nomes de pessoas, da tua empresa ou dos teus clientes, separados por vírgulas. Poucas funcionam melhor do que muitas.')}>
      <input id="st-glossary" className="input" placeholder={t('por exemplo: kwanzas, Multicaixa Express, Sonangol')} maxLength={300} value={value}
        onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (settings.glossary || '') && patchSettings({ glossary: value })} />
    </Field>
  );
}

/** Settings › Gravação: whether the audio of a meeting stays on this computer, for how long, and what is done with it after the meeting. */
export default function AudioKeepCard() {
  const t = useT();
  const { settings, patchSettings, toast } = useApp();
  const [usage, setUsage] = useState(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const load = () => call('audio:usage').then(setUsage).catch(() => {});
  useEffect(() => { load(); return on('data:changed', () => load()); }, []);

  async function wipe() {
    setAsking(false); setError('');
    try { await call('audio:deleteAll'); toast(t('Áudio apagado.')); load(); } catch (e) { setError(friendly(e)); }
  }

  const off = settings.audioKeep === 'off';
  const mode = settings.refineMode || 'voices';
  return (
    <section id="audio" className="card" aria-labelledby="st-audio">
      <h2 id="st-audio">{t('Áudio guardado neste computador')}</h2>
      <Field label={t('Guardar o áudio das reuniões')} htmlFor="st-keep" hint={t('Fica só neste computador. Serve para separar as vozes das pessoas depois da reunião e, se quiseres, para transcrever outra vez.')}>
        <Dropdown id="st-keep" label={t('Guardar o áudio das reuniões')} icon="clock" style={{ maxWidth: 360 }} value={settings.audioKeep}
          options={KEEP.map(([id, label]) => ({ id, label: t(label) }))} onChange={audioKeep => patchSettings({ audioKeep })} />
      </Field>
      <Field label={t('Depois de cada reunião')} htmlFor="st-after"
        hint={mode === 'text' ? t('Envia o áudio guardado outra vez, em blocos longos. Em reuniões que misturam português e inglês, pode traduzir o inglês para português.')
          : t('A transcrição fica como foi ouvida. O áudio só serve para saber quem falou: não envia nada e não gasta minutos.')}>
        <Dropdown id="st-after" label={t('Depois de cada reunião')} style={{ maxWidth: 360 }} disabled={off} value={off ? 'off' : mode}
          options={AFTER.map(([id, label]) => ({ id, label: t(label) }))} onChange={refineMode => patchSettings({ refineMode })} />
      </Field>
      <p className="muted" style={{ fontSize: 13 }}>
        {!off && mode === 'text' ? t('A transcrição ao vivo é só uma pré-visualização e não gasta os teus minutos: conta a nova transcrição.')
          : t('A transcrição ao vivo é a final e conta para os teus minutos.')}
      </p>
      {error && <Banner tone="error" role="alert">{error}</Banner>}
      <div className="row wrap" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <span className="muted" style={{ fontSize: 13 }}>{usage ? (usage.meetings ? t(usage.meetings === 1 ? '1 reunião com áudio guardado, {size}.' : '{n} reuniões com áudio guardado, {size}.', { n: usage.meetings, size: size(usage.bytes) }) : t('Nenhum áudio guardado.')) : ''}</span>
        <Button variant="danger" disabled={!usage || !usage.meetings} onClick={() => setAsking(true)}>{t('Apagar todo o áudio')}</Button>
      </div>
      {asking && (
        <Dialog title={t('Apagar todo o áudio?')} onClose={() => setAsking(false)}>
          <div className="dialog-body">
            <p>{t('Apaga o áudio guardado de todas as reuniões. As transcrições e as notas ficam. Já não será possível melhorar a transcrição dessas reuniões.')}</p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setAsking(false)}>{t('Cancelar')}</Button>
              <Button variant="danger" onClick={wipe}>{t('Apagar o áudio')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
