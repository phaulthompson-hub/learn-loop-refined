import { useRef } from 'react';
import { Archive, FilePlus2, FileEdit, Pin, Search, Share2, Users } from 'lucide-react';
import { useNow } from '../../app/clock';
import { Avatar } from '../../components/Avatar';
import { Tabs } from '../../components/Tabs';
import { ErrorBanner } from '../../components/ui';
import { cx } from '../../lib/cx';
import { plural, relativeTime } from '../../lib/format';
import { Highlight } from '../search/HighlightedText';
import type { CourseOption, NoteCounts, NoteFilters, NoteSort, NoteSummary, NoteTab, TagCount } from './types';

const TAB_EMPTY: Record<NoteTab, { title: string; text: string }> = {
  mine: { title: 'No notes yet', text: 'Capture what you learn: summaries, cheat sheets, checklists. Link notes with [[double brackets]].' },
  shared: { title: 'Nothing shared yet', text: 'When teammates share a note with the workspace it shows up here.' },
  archived: { title: 'No archived notes', text: 'Archive notes you no longer need day to day; they stay searchable here.' },
};

const MAX_TAG_CHIPS = 12;

type Props = {
  filters: NoteFilters;
  searchText: string;
  onSearchText: (text: string) => void;
  onFilters: (patch: Partial<NoteFilters>) => void;
  items: NoteSummary[];
  total: number;
  counts: NoteCounts | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  tags: TagCount[];
  courses: CourseOption[];
  activeId: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
};

function NoteRow({ note, active, showAuthor, now, onOpen }: { note: NoteSummary; active: boolean; showAuthor: boolean; now: Date; onOpen: (id: number) => void }) {
  return (
    <li>
      <a
        href={`/notes/${note.id}`}
        className={cx('note-row', active && 'active')}
        aria-current={active ? 'page' : undefined}
        data-note-row
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onOpen(note.id);
        }}
      >
        <span className="note-row-head">
          <b>{note.title}</b>
          {note.pinned && <Pin className="note-row-pin" aria-label="Pinned" />}
        </span>
        {note.excerpt.text && (
          <span className="note-row-excerpt">
            <Highlight text={note.excerpt.text} ranges={note.excerpt.highlights} />
          </span>
        )}
        <span className="note-row-meta">
          {showAuthor && <Avatar name={note.author.name} color={note.author.avatar_color} size="xs" />}
          {note.course && (
            <span className="note-row-course" title={note.course.title}>
              <i className="color-dot" style={{ background: note.course.color }} />
              {note.course.title}
            </span>
          )}
          {note.mine && note.shared && <Share2 className="note-row-shared" aria-label="Shared with the workspace" />}
          <span className="note-row-time">{relativeTime(note.updated_at, now)}</span>
        </span>
      </a>
    </li>
  );
}

/** Left pane: search, tabs, filters and the note list (pinned notes first). */
export function NoteList(props: Props) {
  const { filters, items, counts, activeId, onOpen, onFilters } = props;
  const now = useNow();
  const listRef = useRef<HTMLDivElement>(null);
  const searching = filters.q.trim() !== '';
  const pinned = !searching && filters.tab === 'mine' ? items.filter((n) => n.pinned) : [];
  const rest = pinned.length ? items.filter((n) => !n.pinned) : items;
  const filtered = searching || filters.tag !== null || filters.courseId !== null;

  // Arrow keys move between notes in the list.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('[data-note-row]') ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLAnchorElement);
    const next = rows[event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const tabs = [
    { key: 'mine' as NoteTab, label: 'Mine', icon: <FileEdit />, count: counts?.mine },
    { key: 'shared' as NoteTab, label: 'Shared', icon: <Users />, count: counts?.shared },
    { key: 'archived' as NoteTab, label: 'Archived', icon: <Archive />, count: counts?.archived },
  ];

  const renderRows = (notes: NoteSummary[]) => (
    <ul className="note-rows">
      {notes.map((note) => (
        <NoteRow key={note.id} note={note} active={note.id === activeId} showAuthor={!note.mine} now={now} onOpen={onOpen} />
      ))}
    </ul>
  );

  return (
    <div className="notes-list" onKeyDown={onKeyDown}>
      <div className="notes-list-head">
        <div>
          <p className="eyebrow">Knowledge base</p>
          <h1>Notes</h1>
        </div>
        <button type="button" className="primary small" onClick={props.onNew}>
          <FilePlus2 /> New note
        </button>
      </div>
      <label className="search-input notes-search">
        <Search aria-hidden />
        <input
          className="input"
          type="search"
          value={props.searchText}
          placeholder="Search titles, text and tags"
          aria-label="Search notes"
          onChange={(event) => props.onSearchText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              listRef.current?.querySelector<HTMLAnchorElement>('[data-note-row]')?.focus();
            }
          }}
        />
      </label>
      <div className="notes-tabs">
        <Tabs label="Which notes" items={tabs} value={filters.tab} onChange={(tab) => onFilters({ tab })} />
      </div>
      <div className="notes-filters">
        <select
          className="input"
          aria-label="Filter by course"
          value={filters.courseId ?? ''}
          onChange={(event) => onFilters({ courseId: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">All courses</option>
          {props.courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Sort notes" value={filters.sort} onChange={(event) => onFilters({ sort: event.target.value as NoteSort })}>
          <option value="updated_at">{searching ? 'Best match' : 'Recently edited'}</option>
          <option value="created_at">Newest first</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>
      {props.tags.length > 0 && (
        <div className="notes-tag-chips" role="group" aria-label="Filter by tag">
          {props.tags.slice(0, MAX_TAG_CHIPS).map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={cx('tag-filter', filters.tag === tag && 'active')}
              aria-pressed={filters.tag === tag}
              onClick={() => onFilters({ tag: filters.tag === tag ? null : tag })}
            >
              #{tag}
              <span>{count}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={listRef} className={cx('notes-list-body', props.loading && 'is-refreshing')} aria-busy={props.loading}>
        {props.error && <ErrorBanner message={props.error} onRetry={props.onRetry} />}
        {props.loading && !items.length && !props.error ? (
          <div className="note-skeletons" aria-label="Loading notes">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton note-skeleton" />
            ))}
          </div>
        ) : !items.length && !props.error ? (
          <div className="notes-empty">
            <b>{filtered ? 'No notes match these filters' : TAB_EMPTY[filters.tab].title}</b>
            <p className="muted">{filtered ? 'Try other words, or clear the tag and course filters.' : TAB_EMPTY[filters.tab].text}</p>
            {filtered ? (
              <button type="button" className="secondary small" onClick={() => { props.onSearchText(''); onFilters({ q: '', tag: null, courseId: null }); }}>
                Clear filters
              </button>
            ) : (
              filters.tab === 'mine' && (
                <button type="button" className="primary small" onClick={props.onNew}>
                  <FilePlus2 /> Write your first note
                </button>
              )
            )}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <section aria-label="Pinned notes">
                <p className="notes-section-title">
                  <Pin /> Pinned
                </p>
                {renderRows(pinned)}
              </section>
            )}
            {rest.length > 0 && (
              <section aria-label={searching ? 'Search results' : 'Notes'}>
                {pinned.length > 0 && <p className="notes-section-title">All notes</p>}
                {renderRows(rest)}
              </section>
            )}
            <p className="notes-list-foot muted">
              {items.length < props.total ? `${items.length} of ${plural(props.total, 'note')}` : plural(props.total, 'note')}
            </p>
            {items.length < props.total && (
              <button type="button" className="secondary small wide" disabled={props.loadingMore} onClick={props.onLoadMore}>
                {props.loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
