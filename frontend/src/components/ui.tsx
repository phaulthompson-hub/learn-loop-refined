import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { masteryLevel } from '../lib/mastery';

export function MasteryBar({ value, label }: { value: number; label?: string }) {
  const rounded = Math.round(value);
  return (
    <div
      className="bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
      aria-label={label ?? 'Mastery'}
    >
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function LevelBadge({ value }: { value: number }) {
  const level = masteryLevel(value);
  return <span className={`badge level-${level.replace(' ', '-')}`}>{level}</span>;
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <AlertTriangle />
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <section className="empty-state">
      <div className="hero-icon">{icon}</div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, subtitle, aside }: { eyebrow: string; title: string; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {aside}
    </header>
  );
}
