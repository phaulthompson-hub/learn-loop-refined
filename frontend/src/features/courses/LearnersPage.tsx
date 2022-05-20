import { useState } from 'react';
import { Search, ShieldAlert, Users } from 'lucide-react';
import { useNow } from '../../app/clock';
import { ROLE_LABELS } from '../../app/roles';
import { Avatar } from '../../components/Avatar';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorBanner, Loading, MasteryBar, StatCard } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { relativeTime } from '../../lib/format';
import { levelSlug, masteryLevel } from '../../lib/mastery';
import { matchesQuery } from '../../lib/table';
import { courseApi } from './api';
import { useCourse } from './courseContext';
import type { CourseLearners, LearnerProgress } from './types';

function ConceptStrip({ learner, concepts }: { learner: LearnerProgress; concepts: CourseLearners['concepts'] }) {
  const names = new Map(concepts.map((c) => [c.id, c.name]));
  return (
    <span className="concept-strip" role="img" aria-label={learner.concepts.map((c) => `${names.get(c.concept_id)}: ${Math.round(c.mastery)}%`).join(', ')}>
      {learner.concepts.map((c) => (
        <i key={c.concept_id} className={`fill-${levelSlug(masteryLevel(c.mastery))}`} title={`${names.get(c.concept_id)}: ${Math.round(c.mastery)}%`} />
      ))}
    </span>
  );
}

export function LearnersPage() {
  const { course, canEdit } = useCourse();
  const now = useNow();
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useLoader(() => courseApi.learners(course.id), `learners:${course.id}`);

  if (!canEdit) {
    return (
      <EmptyState icon={<ShieldAlert />} title="Instructors only">
        <p>Only the course owner and instructors can see other learners' progress.</p>
      </EmptyState>
    );
  }
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading learners…" />;
  if (!data) return null;

  const rows = data.items.filter((l) => matchesQuery(search, l.name, l.email, l.role));
  const columns: Column<LearnerProgress>[] = [
    {
      key: 'name',
      header: 'Learner',
      sortValue: (l) => l.name,
      render: (l) => (
        <span className="person-cell">
          <Avatar name={l.name} color={l.avatar_color} size="sm" />
          <span>
            <b>{l.name}</b>
            <small className="muted">{l.email}</small>
          </span>
        </span>
      ),
    },
    { key: 'role', header: 'Role', sortValue: (l) => l.role, render: (l) => <span className="badge">{ROLE_LABELS[l.role] ?? l.role}</span> },
    {
      key: 'mastery',
      header: 'Mastery',
      sortValue: (l) => l.mastery,
      width: '160px',
      render: (l) => (
        <span className="mastery-cell">
          <b>{Math.round(l.mastery)}%</b>
          <MasteryBar value={l.mastery} label={`${l.name} mastery`} />
        </span>
      ),
    },
    {
      key: 'concepts',
      header: 'Concepts',
      sortValue: (l) => l.mastered_concepts,
      render: (l) => (
        <span className="concepts-cell">
          <ConceptStrip learner={l} concepts={data.concepts} />
          <small className="muted">
            {l.mastered_concepts}/{data.concepts.length} mastered
          </small>
        </span>
      ),
    },
    { key: 'attempts', header: 'Answers', align: 'right', sortValue: (l) => l.attempts, render: (l) => l.attempts },
    {
      key: 'accuracy',
      header: 'Accuracy',
      align: 'right',
      sortValue: (l) => (l.attempts ? l.accuracy : null),
      render: (l) => (l.attempts ? `${Math.round(l.accuracy)}%` : <span className="muted">—</span>),
    },
    {
      key: 'last',
      header: 'Last active',
      sortValue: (l) => l.last_active_at,
      render: (l) => (l.last_active_at ? relativeTime(l.last_active_at, now) : <span className="muted">Never</span>),
    },
  ];

  return (
    <div className="stack">
      <section className="stats">
        <StatCard label="Learners" value={data.total} hint="Following or answered questions" />
        <StatCard label="Average mastery" value={`${Math.round(data.average_mastery)}%`} hint={`Across ${data.concepts.length} concepts`} />
        <StatCard label="Active this week" value={data.active_last_7_days} hint="Answered or opened in 7 days" />
        <StatCard
          label="Fully mastered"
          value={data.items.filter((l) => data.concepts.length > 0 && l.mastered_concepts === data.concepts.length).length}
          hint="Every concept at 85% or more"
        />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>
            <Users /> Learner progress
          </h2>
          <label className="search-input">
            <Search />
            <span className="sr-only">Search learners</span>
            <input className="input" type="search" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {data.total === 0 ? (
          <EmptyState icon={<Users />} title="No learners yet">
            <p>Learners appear here once they follow the course or answer a question.</p>
          </EmptyState>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(l) => l.user_id}
            initialSort={{ key: 'mastery', direction: 'desc' }}
            caption="Learner progress"
            empty={`No learners match “${search}”.`}
          />
        )}
      </section>
    </div>
  );
}
