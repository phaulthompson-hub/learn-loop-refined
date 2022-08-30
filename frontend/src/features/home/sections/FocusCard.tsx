import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Crosshair, MessageCircle, Wand2 } from 'lucide-react';
import { LevelBadge, MasteryBar } from '../../../components/ui';
import type { Focus } from '../types';

/** The single weakest open concept across enrolled courses, with one-click ways to work on it. */
export function FocusCard({ focus }: { focus: Focus | null }) {
  if (!focus) {
    return (
      <section className="focus-card calm" aria-labelledby="focus-title">
        <p className="eyebrow">
          <Crosshair /> Today&rsquo;s focus
        </p>
        <h2 id="focus-title">Nothing urgent to fix</h2>
        <p>Enrol in a course, or keep quizzing what you know. A new focus appears as soon as a concept needs attention.</p>
      </section>
    );
  }
  const { course } = focus;
  return (
    <section className="focus-card" aria-labelledby="focus-title" style={{ '--course': course.color } as CSSProperties}>
      <p className="eyebrow">
        <Crosshair /> Today&rsquo;s focus
      </p>
      <h2 id="focus-title">{focus.concept}</h2>
      <p className="focus-course">
        <span className="color-dot" style={{ background: course.color }} />
        {course.title}
      </p>
      <div className="focus-mastery">
        <MasteryBar value={focus.mastery} label={`${focus.concept} mastery`} />
        <span>
          <b>{Math.round(focus.mastery)}%</b> <LevelBadge value={focus.mastery} />
        </span>
      </div>
      <p className="focus-reason">{focus.reason}</p>
      <div className="focus-actions">
        <Link className="primary small" to={`/courses/${course.id}/quiz`}>
          <Wand2 /> Practice quiz
        </Link>
        <Link className="secondary small" to={`/courses/${course.id}/tutor`}>
          <MessageCircle /> Ask the tutor
        </Link>
        <Link className="ghost small" to={`/courses/${course.id}`}>
          <BookOpen /> Course
        </Link>
      </div>
    </section>
  );
}
