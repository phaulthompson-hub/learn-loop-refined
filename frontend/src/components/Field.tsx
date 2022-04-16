import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cx } from '../lib/cx';

type FieldProps = {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
  /** Right-aligned text next to the label, e.g. a character counter. */
  aside?: ReactNode;
};

/** Label + control + hint/error, wiring `id`, `aria-invalid` and `aria-describedby` onto the child control. */
export function Field({ label, error, hint, children, className, aside }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error || hint ? messageId : undefined,
      })
    : children;
  return (
    <div className={cx('field', error && 'invalid', className)}>
      <label htmlFor={id}>
        <span>{label}</span>
        {aside && <small className="field-aside">{aside}</small>}
      </label>
      {control}
      {error ? (
        <small id={messageId} className="field-error">
          {error}
        </small>
      ) : (
        hint && (
          <small id={messageId} className="hint">
            {hint}
          </small>
        )
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <label className="switch-row">
      <span>
        <b>{label}</b>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
