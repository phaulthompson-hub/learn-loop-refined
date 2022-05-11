import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, X, LayoutGrid, List, Pin, Plus, Search } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, MasteryBar, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { relativeTime } from '../../lib/format';
import { courseApi } from './api';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  SORT_OPTIONS,
  STATUS_LABELS,
  clearNarrowingFilters,
  filtersToParams,
  hasNarrowingFilters,
  parseFilters,
  updateFilters,
  type CatalogFilters,
  type CatalogStatus,
  type CatalogView,
} from './catalog';
import { DifficultyBadge, StatusBadge } from './components/CourseBadges';
import { CourseCard } from './components/CourseCard';
import type { CourseSummary, Difficulty } from './types';

const PAGE_SIZE = 12;
const STATUS_TABS: CatalogStatus[] = ['active', 'draft', 'archived', 'all'];

function CardSkeletons() {
  return (
    <div className="course-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="course-card skeleton-card">
          <div className="skeleton" style={{ width: '40%' }} />
          <div className="skeleton" style={{ width: '80%', height: 20 }} />
          <div className="skeleton" style={{ width: '95%' }} />
          <div className="skeleton" style={{ width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

export function CatalogPage() {
  const workspace = useWorkspace();
  const canCreate = workspace.can('instructor');
  const now = useNow();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const apiKey = JSON.stringify({ ...filters, view: undefined });
  const { data, error, loading, reload, mutate } = useLoader(() => courseApi.list(workspace.id, filters, PAGE_SIZE), `catalog:${workspace.id}:${apiKey}`);
  const [search, setSearch] = useState(filters.q);
  const [pinning, setPinning] = useState<number | null>(null);

  const apply = (patch: Partial<CatalogFilters>) => setParams(filtersToParams(updateFilters(filters, patch)), { replace: true });

  // Debounce typing into the URL (and therefore the request).
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return;
    const timer = window.setTimeout(() => setParams(filtersToParams(updateFilters(filters, { q: search })), { replace: true }), 250);
    return () => window.clearTimeout(timer);
  });

  const togglePin = async (course: CourseSummary) => {
    setPinning(course.id);
    try {
      const updated = await courseApi.setPinned(course.id, !course.pinned);
      mutate((page) => ({ ...page, items: page.items.map((c) => (c.id === updated.id ? updated : c)) }));
      toast.success(updated.pinned ? `Pinned ${updated.title}` : `Unpinned ${updated.title}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the pin');
    } finally {
      setPinning(null);
    }
  };

  const statuses = data?.facets.statuses;
  const totalCourses = statuses ? statuses.active + statuses.draft + statuses.archived : 0;
  const narrowed = hasNarrowingFilters(filters);
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const columns: Column<CourseSummary>[] = [
    {
      key: 'title',
      header: 'Course',
      sortValue: (c) => c.title,
      render: (c) => (
        <span className="course-cell">
          <span className="color-dot" style={{ background: c.color }} />
          <span>
            <Link to={`/courses/${c.id}`} onClick={(e) => e.stopPropagation()}>
              {c.title}
            </Link>
            <small className="muted">{c.subject}</small>
          </span>
          {c.pinned && <Pin className="pinned-icon" aria-label="Pinned" />}
        </span>
      ),
    },
    {
      key: 'difficulty',
      header: 'Level',
      sortValue: (c) => DIFFICULTIES.indexOf(c.difficulty),
      render: (c) => (
        <span className="row">
          <DifficultyBadge difficulty={c.difficulty} />
          <StatusBadge status={c.status} />
        </span>
      ),
    },
    {
      key: 'mastery',
      header: 'My mastery',
      sortValue: (c) => c.mastery,
      width: '170px',
      render: (c) => (
        <span className="mastery-cell">
          <b>{Math.round(c.mastery)}%</b>
          <MasteryBar value={c.mastery} label={`${c.title} mastery`} />
        </span>
      ),
    },
    { key: 'concepts', header: 'Concepts', align: 'right', sortValue: (c) => c.concepts, render: (c) => `${c.mastered_concepts}/${c.concepts}` },
    { key: 'learners', header: 'Learners', align: 'right', sortValue: (c) => c.learners, render: (c) => c.learners },
    {
      key: 'opened',
      header: 'Last opened',
      sortValue: (c) => c.last_opened_at,
      render: (c) => (c.last_opened_at ? relativeTime(c.last_opened_at, now) : <span className="muted">—</span>),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Courses"
        subtitle="Adaptive learning paths built from your team's material."
        aside={
          canCreate && (
            <Link className="primary" to="/courses/new">
              <Plus /> New course
            </Link>
          )
        }
      />

      <div className="catalog-toolbar">
        <Tabs<CatalogStatus>
          label="Course status"
          value={filters.status}
          onChange={(status) => apply({ status })}
          items={STATUS_TABS.filter((s) => s !== 'draft' || canCreate || (statuses?.draft ?? 0) > 0).map((key) => ({
            key,
            label: STATUS_LABELS[key],
            count: statuses ? (key === 'all' ? totalCourses : statuses[key]) : undefined,
          }))}
        />
        <Tabs<CatalogView>
          label="Layout"
          value={filters.view}
          onChange={(view) => apply({ view })}
          items={[
            { key: 'grid', label: <span className="sr-only">Grid</span>, icon: <LayoutGrid /> },
            { key: 'list', label: <span className="sr-only">List</span>, icon: <List /> },
          ]}
        />
      </div>

      <div className="filter-bar catalog-filters">
        <label className="search-input catalog-search">
          <Search />
          <span className="sr-only">Search courses</span>
          <input className="input" type="search" placeholder="Search title, description, subject or tag" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          <span className="sr-only">Subject</span>
          <select className="input" value={filters.subject} onChange={(e) => apply({ subject: e.target.value })}>
            <option value="">All subjects</option>
            {(data?.facets.subjects ?? (filters.subject ? [filters.subject] : [])).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Difficulty</span>
          <select className="input" value={filters.difficulty} onChange={(e) => apply({ difficulty: e.target.value as Difficulty | '' })}>
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
                {data ? ` (${data.facets.difficulties[d]})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Tag</span>
          <select className="input" value={filters.tag} onChange={(e) => apply({ tag: e.target.value })}>
            <option value="">Any tag</option>
            {(data?.facets.tags ?? (filters.tag ? [filters.tag] : [])).map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort by</span>
          <select className="input" value={filters.sort} onChange={(e) => apply({ sort: e.target.value })}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox mine-toggle">
          <input type="checkbox" checked={filters.mine} onChange={(e) => apply({ mine: e.target.checked })} />
          My courses
        </label>
        {narrowed && (
          <button
            type="button"
            className="ghost small"
            onClick={() => {
              setSearch('');
              setParams(filtersToParams(clearNarrowingFilters(filters)), { replace: true });
            }}
          >
            <X /> Clear filters
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!data && loading && <CardSkeletons />}

      {data && data.items.length === 0 && totalCourses === 0 && !narrowed && (
        <EmptyState icon={<BookOpen />} title="No courses yet">
          <p>
            {canCreate
              ? 'Paste lecture notes or upload a PDF and LearnLoop turns it into a course with a knowledge map, adaptive quizzes and a grounded tutor.'
              : 'Instructors in this workspace have not published any courses yet. Check back soon.'}
          </p>
          {canCreate && (
            <Link className="primary" to="/courses/new">
              <Plus /> Create the first course
            </Link>
          )}
        </EmptyState>
      )}
      {data && data.items.length === 0 && (totalCourses > 0 || narrowed) && (
        <EmptyState icon={<Search />} title="No courses match">
          <p>
            Nothing in {STATUS_LABELS[filters.status].toLowerCase()} matches these filters
            {filters.q.trim() ? ` and “${filters.q.trim()}”` : ''}.
          </p>
          <div className="actions center">
            {narrowed && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSearch('');
                  setParams(filtersToParams(clearNarrowingFilters(filters)), { replace: true });
                }}
              >
                <X /> Clear filters
              </button>
            )}
            {filters.status !== 'all' && (
              <button type="button" className="secondary" onClick={() => apply({ status: 'all' })}>
                Search all statuses
              </button>
            )}
            {canCreate && (
              <Link className="primary" to="/courses/new">
                <Plus /> New course
              </Link>
            )}
          </div>
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <div className={loading ? 'is-refreshing' : undefined} aria-busy={loading}>
          {filters.view === 'grid' ? (
            <div className="course-grid">
              {data.items.map((course) => (
                <CourseCard key={course.id} course={course} onTogglePin={togglePin} pinBusy={pinning === course.id} />
              ))}
            </div>
          ) : (
            <section className="panel flat">
              <DataTable rows={data.items} columns={columns} rowKey={(c) => c.id} pageSize={PAGE_SIZE} onRowClick={(c) => navigate(`/courses/${c.id}`)} caption="Courses" />
            </section>
          )}
          {pageCount > 1 && (
            <Pagination
              page={data.page}
              pageCount={pageCount}
              onChange={(page) => apply({ page })}
              summary={`${(data.page - 1) * data.page_size + 1}–${(data.page - 1) * data.page_size + data.items.length} of ${data.total} courses`}
            />
          )}
        </div>
      )}
    </>
  );
}
