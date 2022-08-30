import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Pin, Wand2 } from 'lucide-react';
import { relativeTime } from '../../../lib/format';
import { ProgressRing } from '../charts/ProgressRing';
import type { ContinueCourse } from '../types';

/** Enrolled courses (pinned, then recently opened) with a mastery ring and the recommended next concept. */
export function ContinueLearning({ courses, now }: { courses: ContinueCourse[]; now: Date }) {
  return (
    <section className="panel home-panel" aria-labelledby="continue-title">
      <header className="panel-head">
        <h2 id="continue-title">
          <BookOpen /> Continue learning
        </h2>
        <Link className="ghost small" to="/courses">
          All courses
        </Link>
      </header>
      {courses.length === 0 ? (
        <div className="section-empty">
          <p>
            <b>You are not enrolled in any course here yet.</b> Enrol in one to get a personal concept path and adaptive quizzes.
          </p>
          <Link className="secondary small" to="/courses">
            Browse courses
          </Link>
        </div>
      ) : (
        <ul className="course-cards">
          {courses.map((course) => (
            <li key={course.id} className="home-course-card" style={{ '--course': course.color } as CSSProperties}>
              <div className="course-card-top">
                <ProgressRing value={course.mastery} label={`${course.title} mastery`} color={course.color} size={58} stroke={6}>
                  <b>{Math.round(course.mastery)}%</b>
                </ProgressRing>
                <div className="course-card-title">
                  <span className="eyebrow">
                    {course.subject}
                    {course.pinned && (
                      <span title="Pinned">
                        <Pin aria-hidden="true" />
                        <span className="sr-only">Pinned</span>
                      </span>
                    )}
                  </span>
                  <Link to={`/courses/${course.id}`} className="course-card-link">
                    {course.title}
                  </Link>
                  <small className="muted">
                    {course.mastered_concepts} of {course.concepts} concepts mastered
                    {course.last_opened_at && ` · opened ${relativeTime(course.last_opened_at, now)}`}
                  </small>
                </div>
              </div>
              <div className="course-progress" aria-hidden="true">
                <i style={{ width: `${course.progress}%` }} />
              </div>
              {course.next.concept_id ? (
                <p className="course-next">
                  <Wand2 aria-hidden="true" />
                  <span>
                    Next up: <b>{course.next.concept}</b> <span className="muted">· {Math.round(course.next.mastery ?? 0)}%</span>
                  </span>
                </p>
              ) : (
                <p className="course-next muted">{course.next.reason}</p>
              )}
              <div className="course-card-actions">
                <Link className="primary small" to={`/courses/${course.id}/quiz`}>
                  Practice
                </Link>
                <Link className="ghost small" to={`/courses/${course.id}`}>
                  Open <ArrowRight />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
