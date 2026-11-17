import React, { useEffect, useState } from 'react';
import { call } from '../lib/bridge.js';
import { useT } from '../lib/i18n.js';
import { friendly } from '../lib/errors.mjs';
import { Banner, Button } from './ui.jsx';

export default function HostedCheckout({ url, onError }) {
  const t = useT();
  const [page, setPage] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setPage(null); setLoaded(false); setSlow(false); setError('');
    call('billing:checkoutPage', { url }).then(result => {
      if (alive) setPage(result.url);
    }).catch(e => { if (alive) setError(friendly(e)); });
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    if (!page || loaded) return undefined;
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [page, loaded]);

  return (
    <div className="co-embedded">
      {error ? <Banner tone="warn" role="alert">{error}</Banner> : (
        <>
          {!loaded && <div className="co-status" role="status"><i className="co-pulse" />{t('A carregar o pagamento seguro…')}</div>}
          {slow && !loaded && <Banner tone="warn">{t('A página está a demorar. Podes continuar o mesmo pagamento no navegador.')}</Banner>}
          {page && <iframe className="co-checkout-frame" src={page} title={t('Pagamento seguro WiPay')}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-top-navigation-to-custom-protocols"
            onLoad={() => { setLoaded(true); setSlow(false); }} onError={() => { setLoaded(false); setSlow(true); }} />}
        </>
      )}
      <div className="row wrap">
        <Button variant="ghost" onClick={() => call('billing:openCheckout', { url }).catch(e => onError(friendly(e)))}>{t('Abrir no navegador')}</Button>
      </div>
    </div>
  );
}
