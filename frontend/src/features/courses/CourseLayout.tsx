import { useEffect, useState, type CSSProperties } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenCheck,
  Copy,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { useAuth, useUser } from '../../app/auth';
import { roleAtLeast } from '../../app/roles';
import { useToast } from '../../app/toast';
import { Menu, type MenuItem } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { RouteTabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, Loading } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { plural } from '../../lib/format';
import { courseApi } from './api';
import { DifficultyBadge, StatusBadge } from './components/CourseBadges';
import { DuplicateDialog } from './components/DuplicateDialog';
import { MasteryRing } from './components/MasteryRing';
import type { CourseContext } from './courseContext';
import { canDeleteCourse, canEditCourse, roleIn } from './settings';
import type { Course } from './types';

type Dialog = 'reset' | 'duplicate' | 'leave' | null;

export function CourseLayout() {
  const courseId = Number(useParams().courseId);
  const { me } = useAuth();
  const user = useUser();
  const toast = useToast();
  const { data: course, error, loading, reload, mutate } = useLoader(() => courseApi.get(courseId), `course:${courseId}`);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Number.isFinite(courseId)) courseApi.markOpened(courseId).catch(() => undefined);
  }, [courseId]);

  if (!Number.isFinite(courseId) || (error && !course && /not found/i.test(error))) {
    return (
      <EmptyState icon={<Search />} title="Course not found">
        <p>It may have been deleted, or it belongs to a workspace you are not a member of.</p>
        <Link className="primary" to="/courses">
          <ArrowLeft /> Back to courses
        </Link>
      </EmptyState>
    );
  }
  if (error && !course) return <ErrorBanner message={error} onRetry={reload} />;
  if (loading && !course) return <Loading label="Opening course…" />;
  if (!course) return null;

  const role = roleIn(me, course.workspace_id);
  const canEdit = canEditCourse(course, user.id, role);
  const canDelete = canDeleteCourse(course, user.id, role);
  const replace = (next: Course) => mutate(() => next);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const setPinned = (pinned: boolean) =>
    run(async () => {
      const summary = await courseApi.setPinned(course.id, pinned);
      mutate((current) => ({ ...current, enrolled: summary.enrolled, pinned: summary.pinned, learners: summary.learners }));
      toast.success(pinned ? 'Pinned to the top of your courses' : course.enrolled ? 'Unpinned' : 'Added to My courses');
    });

  const leave = () =>
    run(async () => {
      await courseApi.leave(course.id);
      mutate((current) => ({ ...current, enrolled: false, pinned: false, learners: Math.max(0, current.learners - 1) }));
      setDialog(null);
      toast.info('Removed from My courses. Your progress is kept.');
    });

  const reset = () =>
    run(async () => {
      const result = await courseApi.resetProgress(course.id);
      replace(result.course);
      setDialog(null);
      toast.success(`Progress reset: ${plural(result.attempts_cleared, 'answer')} cleared`);
    });

  const menuItems: MenuItem[] = [
    { label: 'Reset my progress', icon: <RotateCcw />, onSelect: () => setDialog('reset'), disabled: course.attempts === 0 && course.mastery === 35 },
  ];
  if (roleAtLeast(role, 'instructor')) menuItems.push({ label: 'Duplicate as draft', icon: <Copy />, onSelect: () => setDialog('duplicate') });
  if (course.enrolled) menuItems.push('separator', { label: 'Leave course', icon: <LogOut />, danger: true, onSelect: () => setDialog('leave') });

  const base = `/courses/${course.id}`;
  const tabs = [
    { to: base, label: 'Overview', icon: <LayoutDashboard />, end: true },
    { to: `${base}/quiz`, label: 'Quiz', icon: <BookOpenCheck /> },
    { to: `${base}/tutor`, label: 'Tutor', icon: <MessageCircle /> },
    { to: `${base}/sources`, label: `Sources (${course.source_count})`, icon: <FileText /> },
    ...(canEdit ? [{ to: `${base}/learners`, label: 'Learners', icon: <Users /> }] : []),
    ...(canEdit ? [{ to: `${base}/settings`, label: 'Settings', icon: <Settings /> }] : []),
  ];
  const context: CourseContext = { course, reload, replace, role, canEdit, canDelete };

  return (
    <div className="course-page" style={{ '--course-color': course.color } as CSSProperties}>
      <header className="course-hero">
        <div className="course-hero-main">
          <Link to="/courses" className="back-link">
            <ArrowLeft /> All courses
          </Link>
          <p className="eyebrow">{course.subject}</p>
          <h1>{course.title}</h1>
          {course.description && <p className="course-hero-description">{course.description}</p>}
          <div className="course-hero-badges">
            <DifficultyBadge difficulty={course.difficulty} />
            <StatusBadge status={course.status} />
            {course.tags.map((tag) => (
              <span key={tag} className="tag">
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="course-hero-side">
          <MasteryRing value={course.mastery} size={88} caption="mastery" label="Your mastery" />
          <div className="course-hero-stats">
            <span>
              <b>
                {course.mastered_concepts}/{course.concept_count}
              </b>{' '}
              mastered
            </span>
            <span>
              <b>{course.attempts}</b> answers
            </span>
            <span>
              <b>{course.learners}</b> {course.learners === 1 ? 'learner' : 'learners'}
            </span>
          </div>
          <div className="actions">
            {course.enrolled ? (
              <button type="button" className="secondary small" aria-pressed={course.pinned} disabled={busy} onClick={() => setPinned(!course.pinned)}>
                {course.pinned ? <PinOff /> : <Pin />} {course.pinned ? 'Unpin' : 'Pin'}
              </button>
            ) : (
              <button type="button" className="primary small" disabled={busy} onClick={() => setPinned(false)}>
                <Plus /> Follow course
              </button>
            )}
            <Menu
              items={menuItems}
              trigger={({ toggle, ref, open }) => (
                <button type="button" ref={ref} className="secondary small" aria-label="More course actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                  <MoreHorizontal />
                </button>
              )}
            />
          </div>
        </div>
      </header>
      {course.status === 'archived' && (
        <p className="course-notice" role="note">
          This course is archived. You can still review and practise it, but it no longer appears in the active catalogue.
        </p>
      )}
      {course.status === 'draft' && (
        <p className="course-notice draft" role="note">
          This course is a draft: only instructors and its owner can see it until it is published.
        </p>
      )}
      <RouteTabs items={tabs} label="Course sections" />
      <Outlet context={context} />

      {dialog === 'reset' && (
        <ConfirmDialog
          title="Reset your progress?"
          message={
            <>
              This clears your {plural(course.attempts, 'answer')} and puts every concept in <b>{course.title}</b> back to 35%.
              Other learners are not affected.
            </>
          }
          confirmLabel="Reset progress"
          busy={busy}
          onConfirm={reset}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'leave' && (
        <ConfirmDialog
          title="Leave this course?"
          message="It disappears from My courses and loses its pin. Your mastery is kept if you come back."
          confirmLabel="Leave course"
          busy={busy}
          onConfirm={leave}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'duplicate' && <DuplicateDialog course={course} onClose={() => setDialog(null)} />}
    </div>
  );
}
