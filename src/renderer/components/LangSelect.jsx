import React from 'react';
import LanguageDropdown from './LanguageDropdown.jsx';
import { useApp } from '../lib/app-context.js';
import { LANGUAGES, useT } from '../lib/i18n.js';

/** Language picker (Português is the default). Changing it applies at once and is remembered. */
export default function LangSelect({ id = 'lang-select', compact = false }) {
  const { settings, patchSettings } = useApp();
  const t = useT();
  return (
    <div className="row lang-select" style={{ gap: 8 }}>
      <LanguageDropdown id={id} label={t('lang.label')} value={settings.appLanguage || 'pt'} options={LANGUAGES}
        compact={compact} onChange={appLanguage => patchSettings({ appLanguage })} />
    </div>
  );
}
