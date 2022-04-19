import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cx } from '../lib/cx';

export type TabItem<K extends string> = { key: K; label: ReactNode; icon?: ReactNode; count?: number };

/** Button tabs for switching local state (e.g. list/grid, month/week). */
export function Tabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (key: K) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={cx(item.key === value && 'active')}
          onClick={() => onChange(item.key)}
        >
          {item.icon}
          {item.label}
          {item.count !== undefined && <span className="count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Route-backed tabs (each tab is a URL), used for sub-pages such as a course's sections. */
export function RouteTabs({ items, label }: { items: { to: string; label: ReactNode; icon?: ReactNode; end?: boolean }[]; label: string }) {
  return (
    <nav className="route-tabs" aria-label={label}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
