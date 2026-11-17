import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

/** Shared picker, with a portal so menus remain visible inside scroll areas and dialogs. */
export default function Dropdown({ id, label, value, options, onChange, compact = false, disabled = false, icon, style, className = '' }) {
  const generated = useId();
  const triggerId = id || `picker-${generated}`;
  const listId = `${triggerId}-options`;
  const trigger = useRef(null);
  const panel = useRef(null);
  const items = useRef([]);
  const search = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(null);
  const selected = Math.max(0, options.findIndex(option => option.id === value));
  const current = options[selected];

  function close(restoreFocus = false) {
    search.current = { text: '', at: 0 };
    setOpen(false); setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }
  function show(index = selected) {
    if (disabled || !options.length) return;
    setActive(index); setOpen(true);
  }
  function choose(option) {
    close(true);
    if (option.id !== value) onChange(option.id);
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 216), window.innerWidth - 24);
      const height = options.length * 46 + 12;
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upward = below < height && above > below;
      const maxHeight = Math.max(44, upward ? above : below);
      setPosition({ width, maxHeight,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: upward ? undefined : rect.bottom + 8,
        bottom: upward ? window.innerHeight - rect.top + 8 : undefined,
      });
    };
    place();
    const scroll = event => { if (!panel.current?.contains(event.target)) place(); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open, options.length]);

  useLayoutEffect(() => { if (open && position) items.current[active]?.focus(); }, [open, active, !!position]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);

  function keyDown(event) {
    const { key } = event;
    if (key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (key === 'Tab' && open) { close(true); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : !open ? selected :
        (active + (key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      show(next); return;
    }
    if (open && (key === 'Enter' || key === ' ')) { event.preventDefault(); choose(options[active]); return; }
    if (key.length === 1 && key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      search.current = { text: (now - search.current.at < 600 ? search.current.text : '') + key, at: now };
      const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const found = options.findIndex(option => fold(option.label).startsWith(fold(search.current.text)));
      if (found >= 0) show(found);
    }
  }

  return <>
    <button ref={trigger} id={triggerId} type="button" className={`picker-trigger${compact ? ' compact' : ''} ${className}`} style={style}
      aria-label={`${label}: ${current?.label || ''}`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} disabled={disabled} onKeyDown={keyDown}
      onClick={() => open ? close(true) : show()}>
      {icon && <Icon name={icon} size={18} stroke={1.7} className="picker-icon" />}
      <span className="picker-value">{current?.label}</span>
      <Icon name="chevronDown" size={14} stroke={1.8} className="picker-chevron" />
    </button>
    {open && createPortal(
      <div ref={panel} id={listId} role="listbox" aria-label={label} className={`picker-panel${options.some(option => option.code) ? ' with-codes' : ''}`}
        style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onKeyDown={keyDown}>
        {options.map((option, index) => <button key={option.id} ref={element => { items.current[index] = element; }}
          type="button" role="option" aria-selected={option.id === value} data-picker-value={option.id}
          tabIndex={active === index ? 0 : -1} onFocus={() => setActive(index)} onClick={() => choose(option)}>
          {option.code && <span className="picker-code" aria-hidden="true">{option.code}</span>}
          <span>{option.label}</span>
          {option.id === value && <Icon name="check" size={16} stroke={2} />}
        </button>)}
      </div>, document.body)}
  </>;
}
