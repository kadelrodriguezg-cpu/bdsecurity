import { useId, useRef, useState, type KeyboardEvent } from 'react';

/** Tabs con activación manual: flechas mueven foco; Enter/Espacio activan el
 * botón nativo. La selección nunca cambia por enfocar, evitando nuevas consultas. */
export function useManualTabs<T extends string | number>(items: readonly T[], selected: T, onSelect: (id: T) => void) {
  const prefix = useId();
  const [focused, setFocused] = useState(selected);
  const botones = useRef(new Map<T, HTMLButtonElement>());
  const foco = items.includes(focused) ? focused : selected;
  const tabId = (id: T) => `${prefix}-tab-${id}`;
  const panelId = (id: T) => `${prefix}-panel-${id}`;

  return {
    tabProps: (id: T) => ({
      id: tabId(id),
      type: 'button' as const,
      role: 'tab' as const,
      'aria-selected': selected === id,
      'aria-controls': panelId(id),
      tabIndex: foco === id ? 0 : -1,
      ref: (node: HTMLButtonElement | null) => { if (node) botones.current.set(id, node); else botones.current.delete(id); },
      onFocus: () => setFocused(id),
      onBlur: (event: React.FocusEvent<HTMLButtonElement>) => {
        if (!event.currentTarget.closest('[role="tablist"]')?.contains(event.relatedTarget as Node | null)) setFocused(selected);
      },
      onClick: () => { setFocused(id); onSelect(id); },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const actual = items.indexOf(id);
        const indice = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowRight' ? (actual + 1) % items.length
          : event.key === 'ArrowLeft' ? (actual - 1 + items.length) % items.length : null;
        if (indice === null) return;
        event.preventDefault();
        botones.current.get(items[indice])?.focus();
      },
    }),
    panelProps: (id: T) => ({ id: panelId(id), role: 'tabpanel' as const, 'aria-labelledby': tabId(id), tabIndex: 0 }),
  };
}
