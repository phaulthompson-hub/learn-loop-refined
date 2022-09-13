import { useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useNow } from '../../../app/clock';
import { ROLE_LABELS } from '../../../app/roles';
import type { Role } from '../../../app/types';
import { Avatar } from '../../../components/Avatar';
import { EmptyState, ErrorBanner } from '../../../components/ui';
import { useLoader } from '../../../hooks/useLoader';
import { cx } from '../../../lib/cx';
import { formatNumber, relativeTime } from '../../../lib/format';
import { matchesQuery } from '../../../lib/table';
import { homeApi } from '../api';
import { courseAverage, masteryHeatClass, sortLearners, type LearnerSort } from '../analyticsLogic';
import type { RangeDays } from '../types';

const SORTS: { value: LearnerSort; label: string }[] = [
  { value: 'mastery', label: 'Highest mastery' },
  { value: 'answers', label: 'Most active' },
  { value: 'name', label: 'Name' },
];

/** Instructor view: a learner × course mastery heat table with recent activity per learner. */
export function LearnersTab({ workspaceId, days }: { workspaceId: number; days: RangeDays }) {
  const now = useNow();
  const { data, error, reload } = useLoader(() => homeApi.learners(workspaceId, days), `learners:${workspaceId}:${days}`);
  const [text, setText] = useState('');
  const [sort, setSort] = useState<LearnerSort>('mastery');

  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div className="panel skeleton-panel" role="status" aria-label="Loading learners" style={{ height: 320 }} />;
  if (!data.courses.length) {
    return (
      <EmptyState icon={<Users />} title="No courses to compare yet">
        <p>Once this workspace has courses, each learner&rsquo;s mastery per course appears here.</p>
      </EmptyState>
    );
  }

  const rows = sortLearners(
    data.learners.filter((row) => matchesQuery(text, row.name)),
    sort,
  );

  return (
    <section className="panel" aria-labelledby="learners-title">
      <header className="panel-head">
        <h2 id="learners-title">
          <Users /> Learner mastery
        </h2>
        <div className="table-tools">
          <div className="search-input">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Find a learner" aria-label="Find a learner" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <select className="input" aria-label="Sort learners" value={sort} onChange={(e) => setSort(e.target.value as LearnerSort)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="heat-legend" aria-hidden="true">
        <span>
          <i className="mh-none" /> Not started
        </span>
        <span>
          <i className="mh-needs-review" /> Needs review
        </span>
        <span>
          <i className="mh-learning" /> Learning
        </span>
        <span>
          <i className="mh-proficient" /> Proficient
        </span>
        <span>
          <i className="mh-mastered" /> Mastered
        </span>
      </div>
      <div className="table-wrap heat-table-wrap">
        <table className="heat-table">
          <caption className="sr-only">Average mastery per learner and course. Empty cells mean the learner has not started the course.</caption>
          <thead>
            <tr>
              <th scope="col">Learner</th>
              {data.courses.map((course) => (
                <th key={course.id} scope="col" className="course-col">
                  <span className="color-dot" style={{ background: course.color }} />
                  <span>{course.title}</span>
                </th>
              ))}
              <th scope="col" className="num">
                Answers ({days} d)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user_id}>
                <th scope="row">
                  <span className="learner-cell">
                    <Avatar name={row.name} color={row.avatar_color} size="sm" />
                    <span>
                      <b>{row.name}</b>
                      <small className="muted">
                        {ROLE_LABELS[row.role as Role] ?? row.role}
                        {row.last_active ? ` · active ${relativeTime(row.last_active, now)}` : ' · no answers yet'}
                      </small>
                    </span>
                  </span>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.course_id} className={cx('heat', masteryHeatClass(cell.mastery))}>
                    {cell.mastery === null ? <span className="sr-only">Not started</span> : `${Math.round(cell.mastery)}%`}
                  </td>
                ))}
                <td className="num">
                  <b>{formatNumber(row.answers)}</b>
                  {row.answers > 0 && <small className="muted"> · {Math.round(row.accuracy)}%</small>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={data.courses.length + 2} className="table-empty">
                  No learner matches &ldquo;{text}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Course average</th>
              {data.courses.map((course) => {
                const average = courseAverage(data.learners, course.id);
                return (
                  <td key={course.id} className={cx('heat', masteryHeatClass(average))}>
                    {average === null ? '–' : `${Math.round(average)}%`}
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
