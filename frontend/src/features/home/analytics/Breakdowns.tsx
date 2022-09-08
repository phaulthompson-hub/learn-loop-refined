import { Link } from 'react-router-dom';
import { BookOpen, Crosshair, Wand2, Trophy } from 'lucide-react';
import { Avatar } from '../../../components/Avatar';
import { LevelBadge, MasteryBar } from '../../../components/ui';
import { cx } from '../../../lib/cx';
import { formatDuration, formatNumber } from '../../../lib/format';
import type { Analytics } from '../types';

/** Mastery, change over the period, and workload for each course in scope. */
export function CourseBreakdown({ courses, onSelect }: { courses: Analytics['courses']; onSelect: (courseId: number) => void }) {
  return (
    <section className="panel" aria-labelledby="courses-breakdown-title">
      <header className="panel-head">
        <h2 id="courses-breakdown-title">
          <BookOpen /> By course
        </h2>
      </header>
      {courses.length === 0 ? (
        <p className="muted">Enrol in a course to see it here.</p>
      ) : (
        <ul className="breakdown-list">
          {courses.map((course) => (
            <li key={course.id}>
              <button type="button" className="breakdown-row" onClick={() => onSelect(course.id)} aria-label={`Show analytics for ${course.title}`}>
                <span className="breakdown-title">
                  <span className="color-dot" style={{ background: course.color }} />
                  <b>{course.title}</b>
                </span>
                <span className="breakdown-mastery">
                  <MasteryBar value={course.mastery} label={`${course.title} mastery`} />
                  <b>{Math.round(course.mastery)}%</b>
                  <small className={cx(course.mastery_change > 0 && 'ok', course.mastery_change < 0 && 'bad')}>
                    {course.mastery_change > 0 ? '+' : course.mastery_change < 0 ? '−' : '±'}
                    {Math.abs(course.mastery_change).toFixed(1)}
                  </small>
                </span>
                <small className="muted breakdown-meta">
                  {course.mastered_concepts}/{course.concepts} mastered · {formatNumber(course.attempts)} answers
                  {course.attempts > 0 && ` at ${Math.round(course.accuracy)}%`} · {formatNumber(course.reviews)} reviews · {formatDuration(course.minutes)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The weakest open concepts with a direct link into a practice quiz. */
export function WeakestConcepts({ rows }: { rows: Analytics['weakest'] }) {
  return (
    <section className="panel" aria-labelledby="weakest-title">
      <header className="panel-head">
        <h2 id="weakest-title">
          <Crosshair /> Needs practice
        </h2>
      </header>
      {rows.length === 0 ? (
        <p className="muted">Every unlocked concept is mastered. Take a quiz now and then to keep it that way.</p>
      ) : (
        <ol className="weakest-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="weakest-name">
                <b>{row.name}</b>
                <small className="muted">
                  <span className="color-dot" style={{ background: row.course.color }} /> {row.course.title}
                </small>
              </span>
              <span className="weakest-score">
                <b>{Math.round(row.mastery)}%</b>
                <LevelBadge value={row.mastery} />
              </span>
              <Link className="secondary small" to={`/courses/${row.course.id}/quiz`} aria-label={`Practice ${row.name}`}>
                <Wand2 /> Practice
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Answers and accuracy per member this period; the viewer's row is highlighted. */
export function Leaderboard({ rows, days }: { rows: Analytics['leaderboard']; days: number }) {
  const top = rows[0]?.answers ?? 0;
  return (
    <section className="panel" aria-labelledby="leaderboard-title">
      <header className="panel-head">
        <h2 id="leaderboard-title">
          <Trophy /> Leaderboard
        </h2>
        <small className="muted">Answers, last {days} days</small>
      </header>
      <ol className="leaderboard">
        {rows.map((row) => (
          <li key={row.user_id} className={cx(row.is_me && 'me')} aria-current={row.is_me ? 'true' : undefined}>
            <span className={cx('rank', row.rank <= 3 && row.answers > 0 && `rank-${row.rank}`)}>{row.rank}</span>
            <Avatar name={row.name} color={row.avatar_color} size="sm" />
            <span className="leader-name">
              <b>
                {row.name}
                {row.is_me && <span className="badge ok">You</span>}
              </b>
              <span className="leader-bar" aria-hidden="true">
                <i style={{ width: `${top ? (row.answers / top) * 100 : 0}%` }} />
              </span>
            </span>
            <span className="leader-stats">
              <b>{formatNumber(row.answers)}</b>
              <small className="muted">{row.answers ? `${Math.round(row.accuracy)}% correct` : 'no answers'}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
