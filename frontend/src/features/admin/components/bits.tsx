import type { ReactNode } from 'react';
import { Check, Crown, GraduationCap, Monitor, ShieldCheck } from 'lucide-react';
import { ROLE_LABELS } from '../../../app/roles';
import type { Role } from '../../../app/types';
import { cx } from '../../../lib/cx';
import { passwordStrength, STRENGTH_LABELS } from '../../auth/validation';

export const ROLE_ICONS: Record<Role, typeof Crown> = {
  learner: GraduationCap,
  instructor: Monitor,
  admin: ShieldCheck,
  owner: Crown,
};

export function RoleBadge({ role }: { role: Role }) {
  const Icon = ROLE_ICONS[role];
  return (
    <span className={`badge role-badge role-${role}`}>
      <Icon />
      {ROLE_LABELS[role]}
    </span>
  );
}

/** A radio group of colour swatches (keyboard: arrows move between swatches, as with native radios). */
export function ColorSwatches({ value, onChange, colors, label }: { value: string; onChange: (color: string) => void; colors: string[]; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((color) => (
        <label key={color} className={cx('swatch', color === value.toLowerCase() && 'selected')} style={{ background: color }} title={color}>
          <input type="radio" name={label} value={color} checked={color === value.toLowerCase()} onChange={() => onChange(color)} className="sr-only" />
          {color === value.toLowerCase() && <Check aria-hidden="true" />}
          <span className="sr-only">{color}</span>
        </label>
      ))}
    </div>
  );
}

/** Four-segment password strength meter, sharing its scoring with the sign-up form. */
export function PasswordMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = passwordStrength(password);
  return (
    <div className={`strength strength-${strength} admin-strength`} aria-live="polite">
      <span>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < strength ? 'on' : ''} />
        ))}
      </span>
      <small>{STRENGTH_LABELS[strength]}</small>
    </div>
  );
}

/** Footer for settings forms: shows unsaved changes and enables Save only when there is something valid to save. */
export function SaveBar({ dirty, valid, busy, onDiscard, label = 'Save changes' }: { dirty: boolean; valid: boolean; busy: boolean; onDiscard: () => void; label?: string }) {
  return (
    <div className={cx('save-bar', dirty && 'dirty')}>
      <span className="save-state" aria-live="polite">
        {dirty ? (
          <>
            <i className="dot" aria-hidden="true" /> Unsaved changes
          </>
        ) : (
          'All changes saved'
        )}
      </span>
      <div className="actions">
        {dirty && (
          <button type="button" className="ghost small" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
        )}
        <button type="submit" className="primary small" disabled={!dirty || !valid || busy}>
          {busy ? 'Saving…' : label}
        </button>
      </div>
    </div>
  );
}

export function SettingsSection({ title, description, children, tone }: { title: string; description?: ReactNode; children: ReactNode; tone?: 'danger' }) {
  return (
    <section className={cx('panel settings-section', tone === 'danger' && 'danger-zone')}>
      <header>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}
