import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Search } from 'lucide-react';
import { useNow } from '../../../app/clock';
import { DataTable, type Column } from '../../../components/DataTable';
import { LevelBadge, MasteryBar } from '../../../components/ui';
import { relativeTime } from '../../../lib/format';
import { filterConcepts, type LevelFilter } from '../analyticsLogic';
import type { ConceptRow } from '../types';

const LEVELS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'needs review', label: 'Needs review' },
  { value: 'learning', label: 'Learning' },
  { value: 'proficient', label: 'Proficient' },
  { value: 'mastered', label: 'Mastered' },
];

/** Every concept in scope with period attempts, accuracy and current mastery; sortable and filterable. */
export function ConceptTable({ rows, days }: { rows: ConceptRow[]; days: number }) {
  const now = useNow();
  const [text, setText] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const visible = filterConcepts(rows, text, level);

  const columns: Column<ConceptRow>[] = [
    {
      key: 'name',
      header: 'Concept',
      sortValue: (row) => row.name,
      render: (row) => (
        <span className="concept-cell">
          <span className="color-dot" style={{ background: row.course.color }} />
          <span>
            <Link to={`/courses/${row.course.id}`}>{row.name}</Link>
            <small className="muted">{row.course.title}</small>
          </span>
          {!row.unlocked && (
            <span title="Locked until its prerequisite reaches 60%">
              <Lock className="lock-icon" aria-hidden="true" />
              <span className="sr-only">Locked</span>
            </span>
          )}
        </span>
      ),
    },
    { key: 'attempts', header: `Answers (${days} d)`, align: 'right', sortValue: (row) => row.attempts, render: (row) => row.attempts },
    {
      key: 'accuracy',
      header: 'Accuracy',
      align: 'right',
      sortValue: (row) => (row.attempts ? row.accuracy : null),
      render: (row) => (row.attempts ? `${Math.round(row.accuracy)}%` : <span className="muted">–</span>),
    },
    {
      key: 'mastery',
      header: 'Mastery',
      sortValue: (row) => row.mastery,
      width: '22%',
      render: (row) => (
        <span className="heat-mastery-cell">
          <MasteryBar value={row.mastery} label={`${row.name} mastery`} />
          <b>{Math.round(row.mastery)}%</b>
        </span>
      ),
    },
    { key: 'level', header: 'Level', sortValue: (row) => row.mastery, render: (row) => <LevelBadge value={row.mastery} /> },
    {
      key: 'last',
      header: 'Last practised',
      sortValue: (row) => row.last_practiced,
      render: (row) => (row.last_practiced ? relativeTime(row.last_practiced, now) : <span className="muted">Never</span>),
    },
  ];

  return (
    <section className="panel" aria-labelledby="concepts-title">
      <header className="panel-head">
        <h2 id="concepts-title">Concepts</h2>
        <div className="table-tools">
          <div className="search-input">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Filter concepts" aria-label="Filter concepts" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <select className="input" aria-label="Mastery level" value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)}>
            {LEVELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      <DataTable
        key={`${text}|${level}`}
        rows={visible}
        columns={columns}
        rowKey={(row) => row.id}
        initialSort={{ key: 'mastery', direction: 'asc' }}
        pageSize={10}
        caption="Concepts in scope with accuracy and mastery"
        empty={rows.length ? 'No concepts match these filters.' : 'No concepts in scope yet.'}
      />
    </section>
  );
}
