import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { TAGS_MAX, validateTag } from '../../../lib/validation';

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  id?: string;
  'aria-describedby'?: string;
};

/** Chips input: Enter or comma adds a tag, Backspace in an empty box removes the last one. */
export function TagInput({ value, onChange, suggestions = [], id, 'aria-describedby': describedBy }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const errorId = useId();

  const add = (raw: string) => {
    const problem = validateTag(raw, value);
    if (problem) {
      if (raw.trim()) setError(problem);
      return;
    }
    onChange([...value, raw.trim().toLowerCase()]);
    setDraft('');
    setError(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
      setError(null);
    }
  };

  const remaining = suggestions.filter((s) => !value.includes(s));
  return (
    <div className="tag-input-wrap">
      <div className="tag-input" data-invalid={error ? true : undefined}>
        {value.map((tag) => (
          <span key={tag} className="tag-chip">
            #{tag}
            <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
              <X />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          list={remaining.length ? listId : undefined}
          placeholder={value.length >= TAGS_MAX ? 'Tag limit reached' : value.length ? 'Add another…' : 'Type a tag and press Enter'}
          disabled={value.length >= TAGS_MAX}
          aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined}
          onChange={(event) => {
            setDraft(event.target.value.replace(',', ''));
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
        />
        {remaining.length > 0 && (
          <datalist id={listId}>
            {remaining.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        )}
      </div>
      {error && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
