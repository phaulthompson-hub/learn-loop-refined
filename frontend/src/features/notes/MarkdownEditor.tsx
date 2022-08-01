import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Code2, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough, BoxSelect } from 'lucide-react';
import { cx } from '../../lib/cx';
import { continueList, insertCode, insertLink, insertWikilink, toggleLineStyle, toggleWrap, type TextState } from './editor';
import { completeWikilink, suggestTitles, wikilinkQueryAt, type WikilinkQuery } from './links';
import { toggleTask } from './markdown';
import { MarkdownView, type ResolvedLink } from './MarkdownView';
import type { NoteTitle } from './types';

export type EditorMode = 'write' | 'split' | 'preview';

type Props = {
  value: string;
  onChange: (value: string) => void;
  mode: EditorMode;
  titles: NoteTitle[];
  noteId: number | null;
  resolveLink: (target: string, heading: string | null) => ResolvedLink;
  onMissingLink: (target: string) => void;
  onSaveNow: () => void;
  invalid?: boolean;
  describedBy?: string;
};

type Tool = { label: string; shortcut?: string; icon: ReactNode; run: (state: TextState) => TextState };

const TOOLS: (Tool | 'gap')[] = [
  { label: 'Bold', shortcut: 'Ctrl+B', icon: <Bold />, run: (s) => toggleWrap(s, '**', '**', 'bold text') },
  { label: 'Italic', shortcut: 'Ctrl+I', icon: <Italic />, run: (s) => toggleWrap(s, '*', '*', 'italic text') },
  { label: 'Strikethrough', icon: <Strikethrough />, run: (s) => toggleWrap(s, '~~', '~~', 'struck text') },
  'gap',
  { label: 'Heading', icon: <Heading2 />, run: (s) => toggleLineStyle(s, 'h2') },
  { label: 'Bulleted list', icon: <List />, run: (s) => toggleLineStyle(s, 'bullet') },
  { label: 'Numbered list', icon: <ListOrdered />, run: (s) => toggleLineStyle(s, 'ordered') },
  { label: 'Checklist', icon: <ListChecks />, run: (s) => toggleLineStyle(s, 'task') },
  { label: 'Quote', icon: <Quote />, run: (s) => toggleLineStyle(s, 'quote') },
  'gap',
  { label: 'Code', shortcut: 'Ctrl+E', icon: <Code2 />, run: insertCode },
  { label: 'Link', icon: <Link2 />, run: insertLink },
  { label: 'Link to a note', shortcut: '[[', icon: <BoxSelect />, run: insertWikilink },
];

const SHORTCUTS: Record<string, (s: TextState) => TextState> = {
  b: (s) => toggleWrap(s, '**', '**', 'bold text'),
  i: (s) => toggleWrap(s, '*', '*', 'italic text'),
  e: insertCode,
};

/** Markdown textarea with a formatting toolbar, shortcuts, list continuation and `[[` note autocomplete. */
export function MarkdownEditor({ value, onChange, mode, titles, noteId, resolveLink, onMissingLink, onSaveNow, invalid, describedBy }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const menuId = useId();
  const [link, setLink] = useState<WikilinkQuery | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const suggestions = link ? suggestTitles(titles, link.query, noteId) : [];

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection || !area.current) return;
    pendingSelection.current = null;
    area.current.focus();
    area.current.setSelectionRange(selection[0], selection[1]);
  }, [value]);

  const current = (): TextState => {
    const el = area.current!;
    return { text: el.value, start: el.selectionStart, end: el.selectionEnd };
  };

  const detectLink = (text: string, caret: number) => {
    const next = wikilinkQueryAt(text, caret);
    setLink(next);
    if (next?.query !== link?.query) setActiveSuggestion(0);
  };

  const apply = (next: TextState) => {
    pendingSelection.current = [next.start, next.end];
    onChange(next.text);
    detectLink(next.text, next.end);
  };

  const pick = (title: string) => {
    if (!link) return;
    const caret = area.current?.selectionStart ?? value.length;
    const done = completeWikilink(value, link.start, caret, title);
    setLink(null);
    apply({ text: done.text, start: done.caret, end: done.caret });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (link && suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActiveSuggestion((index) => (index + delta + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pick(suggestions[Math.min(activeSuggestion, suggestions.length - 1)].title);
        return;
      }
    }
    if (link && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setLink(null);
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        onSaveNow();
        return;
      }
      if (SHORTCUTS[key]) {
        event.preventDefault();
        apply(SHORTCUTS[key](current()));
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !mod) {
      const next = continueList(current());
      if (next) {
        event.preventDefault();
        apply(next);
      }
    }
  };

  const showEditor = mode !== 'preview';
  const showPreview = mode !== 'write';

  return (
    <div className={cx('md-editor', `mode-${mode}`)}>
      {showEditor && (
        <div className="md-toolbar" role="toolbar" aria-label="Formatting">
          {TOOLS.map((tool, index) =>
            tool === 'gap' ? (
              <span key={index} className="md-toolbar-gap" aria-hidden />
            ) : (
              <button
                key={tool.label}
                type="button"
                className="icon-only"
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                aria-label={tool.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(tool.run(current()))}
              >
                {tool.icon}
              </button>
            ),
          )}
        </div>
      )}
      <div className="md-panes">
        {showEditor && (
          <div className="md-write">
            <textarea
              ref={area}
              value={value}
              spellCheck
              aria-label="Note body (markdown)"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              aria-autocomplete="list"
              aria-controls={link ? menuId : undefined}
              aria-expanded={link ? suggestions.length > 0 : undefined}
              placeholder={'Write in markdown…\n\n# Heading, **bold**, - [ ] tasks, ```code```, and [[Another note]] to link notes.'}
              onChange={(event) => {
                onChange(event.target.value);
                detectLink(event.target.value, event.target.selectionStart);
              }}
              onSelect={(event) => detectLink(event.currentTarget.value, event.currentTarget.selectionStart)}
              onBlur={() => setLink(null)}
              onKeyDown={onKeyDown}
            />
            {link && (
              <div className="wikilink-menu" id={menuId} role="listbox" aria-label="Link to a note">
                <p className="wikilink-menu-title">{link.query ? `Notes matching “${link.query}”` : 'Link to a note'}</p>
                {suggestions.length ? (
                  suggestions.map((entry, index) => (
                    <div
                      key={entry.id}
                      role="option"
                      aria-selected={index === activeSuggestion}
                      className={cx('wikilink-option', index === activeSuggestion && 'active')}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pick(entry.title);
                      }}
                    >
                      <span>{entry.title}</span>
                      {!entry.mine && <small>shared</small>}
                    </div>
                  ))
                ) : (
                  <p className="wikilink-menu-empty">No note with that title yet. Finish with ]] to link it anyway, then create it from the preview.</p>
                )}
              </div>
            )}
          </div>
        )}
        {showPreview && (
          <div className="md-preview" aria-label="Preview">
            <MarkdownView source={value} resolveLink={resolveLink} onMissingLink={onMissingLink} onToggleTask={(line) => onChange(toggleTask(value, line))} />
          </div>
        )}
      </div>
    </div>
  );
}
