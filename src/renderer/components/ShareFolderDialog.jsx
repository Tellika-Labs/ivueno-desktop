import React, { useEffect, useState } from 'react';
import { Banner, Button, Dialog, Field } from './ui.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

/**
 * Share a folder with an organisation, or stop sharing it. Sharing uploads a readable COPY of every finished meeting in the folder
 * (the encrypted sync copy cannot be read by teammates), so the person is told so before they confirm. Stopping deletes those copies.
 */
export default function ShareFolderDialog({ folder, onClose }) {
  const t = useT();
  const shared = !!folder.share;
  const [orgs, setOrgs] = useState(null);
  const [orgId, setOrgId] = useState('');
  const [withTranscript, setWithTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (shared) return;
    call('org:list').then((list) => { setOrgs(list || []); if (list && list[0]) setOrgId(list[0].id); }).catch(() => setOrgs([]));
  }, [shared]);

  const fail = (err) => setError(friendly(err && err.code === 'plan_required' ? { ...err, code: 'plan_required_org' } : err));

  async function share() {
    const org = (orgs || []).find((o) => o.id === orgId);
    if (!org) return;
    setBusy(true); setError('');
    try { await call('sharing:share', { folderId: folder.id, orgId, orgName: org.name, includeTranscript: withTranscript }); onClose(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true); setError('');
    try { await call('sharing:unshare', { folderId: folder.id }); onClose(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  }

  if (shared) {
    return (
      <Dialog title={t('Deixar de partilhar esta pasta?')} onClose={onClose}>
        <p>{t('Partilhada com {org}.', { org: folder.share.orgName || '' })} {t('Os teus colegas deixam de a ver e as cópias são apagadas do servidor.')}</p>
        {error && <Banner tone="danger" role="alert">{error}</Banner>}
        <div className="dialog-foot">
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={stop} disabled={busy}>{busy ? t('A processar…') : t('Deixar de partilhar')}</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('Partilhar pasta com a organização')} onClose={onClose}>
      {orgs && orgs.length === 0 ? <Banner tone="info">{t('Ainda não pertences a nenhuma organização.')}</Banner> : (
        <>
          <Banner tone="info" icon="shield">{t('Os encontros desta pasta serão carregados como cópias legíveis para a tua organização. Deixar de partilhar apaga essas cópias.')}</Banner>
          {orgs && orgs.length > 1 && (
            <Field label={t('Organização')} htmlFor="share-org">
              <select id="share-org" className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </Field>
          )}
          <label className="row" style={{ gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
            {t('Incluir a transcrição')}
          </label>
        </>
      )}
      {error && <Banner tone="danger" role="alert">{error}</Banner>}
      <div className="dialog-foot">
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button variant="primary" onClick={share} disabled={busy || !orgs || orgs.length === 0}>{busy ? t('A partilhar…') : t('Partilhar pasta')}</Button>
      </div>
    </Dialog>
  );
}
