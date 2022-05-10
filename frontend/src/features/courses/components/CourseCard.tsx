import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Pin, PinOff, Users } from 'lucide-react';
import { useNow } from '../../../app/clock';
import { MasteryBar } from '../../../components/ui';
import { cx } from '../../../lib/cx';
import { plural, relativeTime } from '../../../lib/format';
import type { CourseSummary } from '../types';
import { DifficultyBadge, StatusBadge } from './CourseBadges';

type Props = { course: CourseSummary; onTogglePin: (course: CourseSummary) => void; pinBusy?: boolean };

export function CourseCard({ course, onTogglePin, pinBusy }: Props) {
  const now = useNow();
  return (
    <article className={cx('course-card', course.pinned && 'is-pinned')} style={{ '--course-color': course.color } as CSSProperties}>
      <div className="course-card-band" aria-hidden="true" />
      <button
        type="button"
        className="icon-only pin-toggle"
        aria-pressed={course.pinned}
        aria-label={course.pinned ? `Unpin ${course.title}` : `Pin ${course.title}`}
        title={course.pinned ? 'Unpin' : 'Pin to the top'}
        disabled={pinBusy}
        onClick={() => onTogglePin(course)}
      >
        {course.pinned ? <PinOff /> : <Pin />}
      </button>
      <div className="course-card-body">
        <p className="eyebrow">{course.subject}</p>
        <h3>
          <Link to={`/courses/${course.id}`} className="stretched-link">
            {course.title}
          </Link>
        </h3>
        <p className="course-card-description">{course.description}</p>
        <div className="course-card-badges">
          <DifficultyBadge difficulty={course.difficulty} />
          <StatusBadge status={course.status} />
          {course.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag">
              #{tag}
            </span>
          ))}
        </div>
      </div>
      <div className="course-card-progress">
        <div className="row">
          <span className="muted">
            {course.mastered_concepts}/{course.concepts} mastered
          </span>
          <span className="spacer" />
          <b>{Math.round(course.mastery)}%</b>
        </div>
        <MasteryBar value={course.mastery} label={`${course.title} mastery`} />
      </div>
      <footer className="course-card-foot">
        <span title="Learners following this course">
          <Users aria-hidden="true" /> {plural(course.learners, 'learner')}
        </span>
        <span>
          <BookOpen aria-hidden="true" /> {plural(course.concepts, 'concept')}
        </span>
        <span className="spacer" />
        <small className="muted">{course.last_opened_at ? `Opened ${relativeTime(course.last_opened_at, now)}` : course.enrolled ? 'Not opened yet' : 'Not following'}</small>
      </footer>
    </article>
  );
}
