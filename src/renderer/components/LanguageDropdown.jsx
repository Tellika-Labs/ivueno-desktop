import React from 'react';
import Dropdown from './Dropdown.jsx';

export default function LanguageDropdown({ options, ...props }) {
  return <Dropdown {...props} icon="language" options={options.map(option => ({
    ...option, code: ['pt', 'en', 'fr', 'es'].includes(option.id) ? option.id.toUpperCase() : '—',
  }))} />;
}
