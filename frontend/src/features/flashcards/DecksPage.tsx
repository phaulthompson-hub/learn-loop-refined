import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Flame, Layers, Play, Plus, Search } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { EmptyState, ErrorBanner, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import { flashcardsApi } from './api';
import { DeckFormModal } from './components/DeckFormModal';
import { DeckTile } from './components/DeckTile';
import { ForecastBars } from './components/ForecastBars';
import { DECK_SORTS, filterDecks, groupDecksByCourse, sortDecks, type DeckSort } from './decks';
import './flashcards.css';

const isDeckSort = (value: string | null): value is DeckSort => DECK_SORTS.some((s) => s.value === value);

/** Every deck in the workspace, grouped by course, with today's workload and a two-week outlook. */
export function DecksPage() {
  const workspace = useWorkspace();
  const now = useNow();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const query = params.get('q') ?? '';
  const courseParam = Number(params.get('course'));
  const courseId = Number.isInteger(courseParam) && courseParam > 0 ? courseParam : null;
  const sortParam = params.get('sort');
  const sort: DeckSort = isDeckSort(sortParam) ? sortParam : 'course';

  const { data, error, loading, reload } = useLoader(async () => {
    const [page, stats] = await Promise.all([flashcardsApi.decks(workspace.id), flashcardsApi.stats(workspace.id)]);
    return { page, stats };
  }, `decks:${workspace.id}`);

  /** Filters live in the URL so a filtered view can be shared and survives a reload. */
  const setFilter = (key: 'q' | 'course' | 'sort', value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const visible = useMemo(() => (data ? sortDecks(filterDecks(data.page.items, { query, courseId }), sort) : []), [data, query, courseId, sort]);
  const groups = useMemo(() => (sort === 'course' ? groupDecksByCourse(visible) : null), [visible, sort]);

  if (loading && !data) return <Loading label="Loading decks…" />;
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return null;

  const { page, stats } = data;
  const editableCourses = page.courses.filter((c) => c.can_edit);
  const canCreate = workspace.can('instructor') || editableCourses.length > 0;
  const studyable = stats.due_today + Math.min(stats.new_available, stats.new_allowance);
  const tile = (deck: (typeof visible)[number]) => <DeckTile key={deck.id} deck={deck} now={now} newAllowance={stats.new_allowance} />;

  return (
    <div className="fc-page">
      <PageHeader
        eyebrow="FLASHCARDS"
        title="Decks"
        subtitle="Spaced repetition keeps what you learned in your courses. Review a little every day."
        aside={
          <div className="actions">
            {canCreate && editableCourses.length > 0 && (
              <button type="button" className="secondary" onClick={() => setCreating(true)}>
                <Plus /> New deck
              </button>
            )}
            <Link className={cx('primary', !studyable && 'is-disabled')} to="/review" aria-disabled={!studyable}>
              <Play /> {studyable ? `Study all · ${studyable}` : 'All caught up'}
            </Link>
          </div>
        }
      />

      <section className="fc-overview">
        <div className="stats">
          <StatCard label="Due today" value={stats.due_today} hint={stats.due_today ? 'Reviews waiting across all decks' : 'Nothing waiting'} />
          <StatCard label="New cards" value={Math.min(stats.new_available, stats.new_allowance)} hint={`${stats.new_available} unseen · ${stats.new_allowance} left today`} />
          <StatCard label="Reviewed today" value={stats.reviewed_today} hint={stats.again_today ? `${stats.again_today} forgotten` : undefined} />
          <StatCard label="30-day recall" value={stats.retention_30d === null ? '—' : `${Math.round(stats.retention_30d)}%`} hint={plural(stats.reviews_30d, 'review')} />
          <StatCard
            label="Streak"
            value={
              <span className="fc-streak">
                <Flame /> {stats.streak}
              </span>
            }
            hint={stats.streak === 1 ? 'day' : 'days in a row'}
          />
        </div>
        {stats.total_cards > 0 && (
          <div className="panel flat fc-overview-forecast">
            <div className="panel-head">
              <h2>Next two weeks</h2>
              <span className="muted">{plural(stats.mature, 'mature card')}</span>
            </div>
            <ForecastBars days={stats.forecast} now={now} />
          </div>
        )}
      </section>

      {page.items.length === 0 ? (
        <EmptyState icon={<Layers />} title="No decks yet">
          <p>
            {canCreate
              ? 'Create a deck for one of your courses, then add cards by hand, import a list or generate them from the course concepts.'
              : 'Your instructors have not published any decks in this workspace yet.'}
          </p>
          {canCreate && editableCourses.length > 0 && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              <Plus /> Create the first deck
            </button>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="filter-bar fc-filters">
            <label className="search-input">
              <Search />
              <span className="sr-only">Search decks</span>
              <input className="input" type="search" placeholder="Search decks" value={query} onChange={(e) => setFilter('q', e.target.value || null)} />
            </label>
            <div className="fc-chips" role="group" aria-label="Filter by course">
              <button type="button" className={cx('fc-chip', courseId === null && 'active')} aria-pressed={courseId === null} onClick={() => setFilter('course', null)}>
                All courses
              </button>
              {page.courses
                .filter((c) => c.decks > 0)
                .map((course) => (
                  <button
                    key={course.id}
                    type="button"
                    className={cx('fc-chip', courseId === course.id && 'active')}
                    aria-pressed={courseId === course.id}
                    onClick={() => setFilter('course', courseId === course.id ? null : String(course.id))}
                  >
                    <span className="color-dot" style={{ background: course.color }} />
                    {course.title}
                    <span className="count">{course.decks}</span>
                  </button>
                ))}
            </div>
            <label className="fc-sort">
              <span className="muted">Sort</span>
              <select className="input" value={sort} onChange={(e) => setFilter('sort', e.target.value === 'course' ? null : e.target.value)}>
                {DECK_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={<Search />} title="No matching decks">
              <p>Try another search or show every course.</p>
              <button type="button" className="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </button>
            </EmptyState>
          ) : groups ? (
            groups.map((group) => (
              <section key={group.courseId} className="fc-group" aria-labelledby={`fc-group-${group.courseId}`}>
                <h2 id={`fc-group-${group.courseId}`}>
                  <span className="color-dot" style={{ background: group.color }} />
                  {group.title}
                  <small className="muted">
                    {plural(group.decks.length, 'deck')}
                    {group.due > 0 && ` · ${group.due} due`}
                  </small>
                </h2>
                <div className="fc-deck-grid">{group.decks.map(tile)}</div>
              </section>
            ))
          ) : (
            <div className="fc-deck-grid">{visible.map(tile)}</div>
          )}
        </>
      )}

      {creating && (
        <DeckFormModal
          workspaceId={workspace.id}
          courses={editableCourses}
          decks={page.items}
          initialCourseId={courseId}
          onClose={() => setCreating(false)}
          onSaved={(deck) => navigate(`/decks/${deck.id}`)}
        />
      )}
    </div>
  );
}
