import { useMemo } from 'react';
import { Circle, Link2, List, Network } from 'lucide-react';
import { useLoader } from '../../hooks/useLoader';
import { useNow } from '../../app/clock';
import { relativeTime } from '../../lib/format';
import { Highlight } from '../search/HighlightedText';
import { notesApi } from './api';
import { outline, parseMarkdown } from './markdown';
import type { Note } from './types';

type Props = {
  note: Note | null;
  body: string;
  showOutline: boolean;
  onOpen: (to: string) => void;
  onCreateLinked: ((title: string) => void) | null;
};

function Backlinks({ note, onOpen }: { note: Note; onOpen: (to: string) => void }) {
  const now = useNow();
  // Keyed by title too: renaming the note changes which links point at it.
  const { data, error, loading } = useLoader(() => notesApi.backlinks(note.id), `backlinks:${note.id}:${note.title}`);
  if (loading && !data) return <p className="muted note-side-empty">Looking for notes that link here…</p>;
  if (error) return <p className="bad note-side-empty">{error}</p>;
  if (!data?.length) {
    return (
      <p className="muted note-side-empty">
        No notes link here yet. Type <code>[[{note.title}]]</code> in another note to connect them.
      </p>
    );
  }
  return (
    <ul className="note-side-list">
      {data.map((link) => (
        <li key={link.id}>
          <a
            href={`/notes/${link.id}`}
            onClick={(event) => {
              event.preventDefault();
              onOpen(`/notes/${link.id}`);
            }}
          >
            {link.title}
          </a>
          <small className="muted">
            {link.mine ? '' : `${link.author.name} · `}
            {relativeTime(link.updated_at, now)}
          </small>
          <span className="note-side-context">
            <Highlight text={link.context.text} ranges={link.context.highlights} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Outline, outgoing links (with missing ones flagged) and backlinks for the open note. */
export function NoteSidebar({ note, body, showOutline, onOpen, onCreateLinked }: Props) {
  const headings = useMemo(() => (showOutline ? outline(parseMarkdown(body)).filter((h) => h.level <= 3) : []), [body, showOutline]);
  const links = note?.links ?? [];
  return (
    <aside className="note-side" aria-label="Note details">
      {headings.length > 1 && (
        <section>
          <h3>
            <List /> Outline
          </h3>
          <ul className="note-outline">
            {headings.map((heading) => (
              <li key={heading.id} style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}>
                <a
                  href={`#${heading.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>
          <Link2 /> Links from this note
          {links.length > 0 && <span className="count">{links.length}</span>}
        </h3>
        {links.length ? (
          <ul className="note-side-list compact">
            {links.map((link) =>
              link.note_id ? (
                <li key={link.target}>
                  <a
                    href={`/notes/${link.note_id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpen(`/notes/${link.note_id}`);
                    }}
                  >
                    {link.target}
                  </a>
                </li>
              ) : (
                <li key={link.target} className="missing-link">
                  <Circle aria-hidden />
                  <span>{link.target}</span>
                  {onCreateLinked && (
                    <button type="button" className="ghost small" onClick={() => onCreateLinked(link.target)}>
                      Create
                    </button>
                  )}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="muted note-side-empty">{note ? 'No [[links]] to other notes yet.' : 'Links appear here once the note is saved.'}</p>
        )}
      </section>
      {note && (
        <section>
          <h3>
            <Network /> Linked from
            {note.backlinks > 0 && <span className="count">{note.backlinks}</span>}
          </h3>
          <Backlinks note={note} onOpen={onOpen} />
        </section>
      )}
    </aside>
  );
}
