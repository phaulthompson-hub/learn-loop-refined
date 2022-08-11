import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock3, CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { cx } from '../../lib/cx';
import { COMMANDS, filterCommands, type Command } from './commands';
import { Highlight } from './HighlightedText';
import { COMMAND_ICONS, TYPE_ICONS } from './icons';
import { loadRecent, pushRecent, removeRecent, saveRecent } from './recent';
import type { Range, SearchHit } from './types';
import { useSearch } from './useSearch';
import './search.css';

type Option =
  | { id: string; kind: 'command'; command: Command; ranges: Range[] }
  | { id: string; kind: 'recent'; query: string }
  | { id: string; kind: 'hit'; hit: SearchHit }
  | { id: string; kind: 'all'; query: string };

type Section = { title: ReactNode; options: Option[] };

const RESULTS_PER_GROUP = 4;

/** Ctrl/Cmd+K quick search: commands, recent searches and live results from every feature. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(() => loadRecent(workspace.id));
  const [activeId, setActiveId] = useState<string | null>(null);
  const { result, loading, error } = useSearch(workspace.id, query, { limit: RESULTS_PER_GROUP });
  const trimmed = query.trim();

  const sections = useMemo<Section[]>(() => {
    const commands = filterCommands(COMMANDS, trimmed, trimmed ? 4 : 5).map(
      (match): Option => ({ id: `command-${match.command.id}`, kind: 'command', command: match.command, ranges: match.ranges }),
    );
    if (!trimmed) {
      const recents = recent.map((q): Option => ({ id: `recent-${q}`, kind: 'recent', query: q }));
      return [...(recents.length ? [{ title: 'Recent searches', options: recents }] : []), { title: 'Quick actions', options: commands }];
    }
    const groups = (result?.groups ?? []).map((group) => ({
      title: (
        <>
          {group.label}
          <span className="palette-count">{group.count}</span>
        </>
      ),
      options: group.items.map((hit): Option => ({ id: `hit-${hit.type}-${hit.id}`, kind: 'hit', hit })),
    }));
    return [
      ...(commands.length ? [{ title: 'Actions', options: commands }] : []),
      ...groups,
      { title: 'Everything', options: [{ id: 'all', kind: 'all', query: trimmed }] },
    ];
  }, [recent, result, trimmed]);

  const options = sections.flatMap((section) => section.options);
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === activeId));
  const active = options[activeIndex];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (active) document.getElementById(`${listId}-${active.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const updateRecent = (next: string[]) => {
    setRecent(next);
    saveRecent(workspace.id, next);
  };

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const run = (option: Option | undefined) => {
    if (!option) return;
    if (option.kind === 'command') go(option.command.to);
    else if (option.kind === 'recent') {
      setQuery(option.query);
      setActiveId(null);
    } else if (option.kind === 'hit') {
      updateRecent(pushRecent(recent, trimmed));
      go(option.hit.link);
    } else {
      updateRecent(pushRecent(recent, option.query));
      go(`/search?q=${encodeURIComponent(option.query)}`);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const move = (delta: number) => {
      if (options.length) setActiveId(options[(activeIndex + delta + options.length) % options.length].id);
    };
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if (event.key === 'PageDown') move(5);
    else if (event.key === 'PageUp') move(-5);
    else if (event.key === 'Enter') run(active);
    else if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    } else if (event.key !== 'Tab') return; // Tab keeps focus in the search box (the dialog has no other stops).
    event.preventDefault();
  };

  const renderOption = (option: Option) => {
    switch (option.kind) {
      case 'command': {
        const Icon = COMMAND_ICONS[option.command.icon];
        return (
          <>
            <span className="palette-icon">
              <Icon />
            </span>
            <span className="palette-main">
              <b>
                <Highlight text={option.command.label} ranges={option.ranges} />
              </b>
            </span>
            <small className="palette-hint">{option.command.hint}</small>
          </>
        );
      }
      case 'recent':
        return (
          <>
            <span className="palette-icon">
              <Clock3 />
            </span>
            <span className="palette-main">
              <b>{option.query}</b>
            </span>
            <button
              type="button"
              className="icon-only palette-forget"
              tabIndex={-1}
              aria-label={`Remove “${option.query}” from recent searches`}
              onClick={(event) => {
                event.stopPropagation();
                updateRecent(removeRecent(recent, option.query));
                input.current?.focus();
              }}
            >
              <X />
            </button>
          </>
        );
      case 'hit': {
        const { hit } = option;
        const Icon = TYPE_ICONS[hit.type];
        return (
          <>
            <span className={`palette-icon type-${hit.type}`}>
              <Icon />
            </span>
            <span className="palette-main">
              <b>
                <Highlight text={hit.title} ranges={hit.title_highlights} />
              </b>
              <small>{hit.snippet ? <Highlight text={hit.snippet.text} ranges={hit.snippet.highlights} /> : hit.subtitle}</small>
            </span>
            {hit.snippet && <small className="palette-hint">{hit.subtitle}</small>}
          </>
        );
      }
      case 'all':
        return (
          <>
            <span className="palette-icon">
              <Search />
            </span>
            <span className="palette-main">
              <b>See all results for “{option.query}”</b>
            </span>
            <ArrowRight className="palette-hint" />
          </>
        );
    }
  };

  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="palette-input">
          {loading ? <Loader2 className="spin" aria-hidden /> : <Search aria-hidden />}
          <input
            ref={input}
            value={query}
            placeholder="Search notes, courses, tasks… or type a command"
            role="combobox"
            aria-label="Search or type a command"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId(null);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id={listId} role="listbox" aria-label="Results">
          {sections.map((section, index) => (
            <div key={index} role="group" className="palette-section">
              <p className="palette-section-title">{section.title}</p>
              {section.options.map((option) => (
                <div
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={option.id === active?.id}
                  className={cx('palette-option', option.id === active?.id && 'active')}
                  onMouseMove={() => option.id !== active?.id && setActiveId(option.id)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(option)}
                >
                  {renderOption(option)}
                </div>
              ))}
            </div>
          ))}
          {trimmed && !loading && result?.total === 0 && <p className="palette-empty">No notes, courses, tasks, cards or events match “{trimmed}”.</p>}
          {error && (
            <p className="palette-empty bad" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>
              <CornerDownLeft />
            </kbd>{' '}
            open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
