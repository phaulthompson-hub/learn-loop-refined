import { useId, useState } from 'react';
import { Hash, X } from 'lucide-react';
import { addTags, MAX_TAGS } from './noteForm';

type Props = { tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; disabled?: boolean };

/** Tag chips: Enter or comma adds, Backspace on an empty input removes the last tag. */
export function TagInput({ tags, onChange, suggestions = [], disabled }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const hintId = useId();

  const commit = (raw: string) => {
    if (!raw.trim()) return;
    const result = addTags(tags, raw);
    setError(result.error);
    if (result.tags.length !== tags.length) onChange(result.tags);
    setText('');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && !text && tags.length) {
      event.preventDefault();
      onChange(tags.slice(0, -1));
      setError(null);
    }
  };

  const available = suggestions.filter((tag) => !tags.includes(tag));

  return (
    <div className="note-tag-input-wrap">
      <div className={error ? 'note-tag-input invalid' : 'note-tag-input'}>
        <Hash aria-hidden />
        {tags.map((tag) => (
          <span key={tag} className="tag note-tag-chip">
            {tag}
            {!disabled && (
              <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
                <X />
              </button>
            )}
          </span>
        ))}
        {!disabled && tags.length < MAX_TAGS && (
          <input
            value={text}
            list={available.length ? listId : undefined}
            aria-label="Add a tag"
            aria-describedby={hintId}
            aria-invalid={error ? true : undefined}
            placeholder={tags.length ? '' : 'Add tags…'}
            onChange={(event) => {
              const value = event.target.value;
              // Pasting "a, b, c" adds the complete tags right away.
              if (value.includes(',')) commit(value);
              else setText(value);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => commit(text)}
          />
        )}
        {available.length > 0 && (
          <datalist id={listId}>
            {available.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        )}
      </div>
      <small id={hintId} className={error ? 'field-error' : 'sr-only'} role={error ? 'alert' : undefined}>
        {error ?? `Press Enter or comma to add a tag, Backspace to remove the last one. Up to ${MAX_TAGS} tags.`}
      </small>
    </div>
  );
}
