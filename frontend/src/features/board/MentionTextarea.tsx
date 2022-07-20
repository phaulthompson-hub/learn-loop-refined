import { useId, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import type { Person } from '../../app/types';
import { cx } from '../../lib/cx';
import { insertMention, mentionQuery, mentionSuggestions } from './board';

type MentionTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  people: readonly Person[];
  onSubmit: () => void;
  placeholder?: string;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
};

/**
 * Textarea with an "@name" autocomplete (a combobox listbox). Arrow keys pick, Enter/Tab insert,
 * Escape dismisses the list without closing the surrounding drawer; Ctrl/Cmd+Enter submits.
 */
export function MentionTextarea({ value, onChange, people, onSubmit, placeholder, label, disabled, autoFocus, maxLength }: MentionTextareaProps) {
  const listId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const query = mentionQuery(value, caret);
  const suggestions = query && query.start !== dismissedAt ? mentionSuggestions(people, query.query) : [];
  const open = suggestions.length > 0;
  const highlighted = Math.min(active, suggestions.length - 1);

  const choose = (person: Person) => {
    if (!query) return;
    const next = insertMention(value, query.start, caret, person.name);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((highlighted + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(suggestions[highlighted]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setDismissedAt(query!.start);
    }
  };

  const syncCaret = (event: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(event.currentTarget.selectionStart ?? 0);

  return (
    <div className="task-mention-box">
      <textarea
        ref={area}
        className="input"
        rows={3}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={maxLength}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${suggestions[highlighted].id}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          syncCaret(event);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onBlur={() => setDismissedAt(query?.start ?? null)}
        onFocus={() => setDismissedAt(null)}
      />
      <ul id={listId} role="listbox" className={cx('task-mention-list', open && 'open')} aria-label="Mention a member">
        {suggestions.map((person, index) => (
          <li
            key={person.id}
            id={`${listId}-${person.id}`}
            role="option"
            aria-selected={index === highlighted}
            className={cx(index === highlighted && 'active')}
            onMouseDown={(event) => {
              event.preventDefault(); // keep focus in the textarea
              choose(person);
            }}
          >
            <Avatar name={person.name} color={person.avatar_color} size="xs" />
            <span>{person.name}</span>
            <small>{person.email}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
