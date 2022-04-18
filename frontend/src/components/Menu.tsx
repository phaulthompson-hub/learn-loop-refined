import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export type MenuItem =
  | { label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode }
  | 'separator';

type MenuProps = {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement> }) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  header?: ReactNode;
  className?: string;
};

/** Dropdown menu with keyboard support (arrows, Home/End, Escape) that closes on outside clicks. */
export function Menu({ trigger, items, align = 'right', header, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const entries = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => entries[(next + entries.length) % entries.length]?.focus();
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <div className={cx('menu-root', className)} ref={root}>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: button })}
      {open && (
        <div className={cx('menu', `menu-${align}`)} role="menu" ref={list} onKeyDown={onKeyDown}>
          {header && <div className="menu-header">{header}</div>}
          {items.map((item, index) =>
            item === 'separator' ? (
              <hr key={`sep-${index}`} />
            ) : (
              <button
                key={index}
                type="button"
                role="menuitem"
                className={cx(item.danger && 'danger-item')}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
