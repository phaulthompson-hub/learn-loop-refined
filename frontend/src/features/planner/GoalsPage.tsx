import { useState } from 'react';
import { Plus, Target } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { ConfirmDialog } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatDateTime, formatDuration, plural } from '../../lib/format';
import { ActivityHeatmap } from './ActivityHeatmap';
import { goalsApi } from './api';
import { useCourses } from './EventBits';
import { GoalCard } from './GoalCard';
import { GoalModal } from './GoalModal';
import { STATUS_META } from './goalForm';
import { StreakHero } from './StreakHero';
import { StudyLogModal } from './StudyLogModal';
import { StudyTimePanel } from './StudyTimePanel';
import type { Goal, GoalStatus, StudyLog } from './types';
import './planner.css';
import './goals.css';

type GoalTab = 'active' | 'archived';
type Pending = { kind: 'goal'; goal: Goal } | { kind: 'log'; log: StudyLog };

const STATUS_ORDER: GoalStatus[] = ['overdue', 'at_risk', 'on_track', 'done'];

/** Streak, activity heatmap, goals with live progress, and logged study time. */
export function GoalsPage() {
  const workspace = useWorkspace();
  const now = useNow();
  const toast = useToast();
  const courses = useCourses(workspace.id);
  const [tab, setTab] = useState<GoalTab>('active');
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [logging, setLogging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const streak = useLoader(() => goalsApi.streak(workspace.id), `streak:${workspace.id}`);
  const goals = useLoader(() => goalsApi.list(workspace.id, tab), `goals:${workspace.id}:${tab}`);
  const summary = useLoader(() => goalsApi.summary(workspace.id, 4), `study-summary:${workspace.id}`);
  const logs = useLoader(() => goalsApi.logs(workspace.id), `study-logs:${workspace.id}`);
  // Any change can move goal progress, the streak and the charts, so every panel re-fetches together
  // (keeping its current data on screen meanwhile).
  const refresh = () => [streak, goals, summary, logs].forEach((loader) => loader.reload());

  const minutesByDay = new Map((summary.data?.weeks ?? []).flatMap((week) => week.days.map((d) => [d.date, d.minutes] as const)));
  const ordered = [...(goals.data?.items ?? [])].sort(
    (a, b) => STATUS_ORDER.indexOf(a.progress.status) - STATUS_ORDER.indexOf(b.progress.status),
  );

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!pending) return;
    setBusy(true);
    if (pending.kind === 'goal') await run(() => goalsApi.remove(pending.goal.id), `Deleted “${pending.goal.title}”`);
    else await run(() => goalsApi.removeLog(pending.log.id), `Removed ${formatDuration(pending.log.minutes)} of study time`);
    setBusy(false);
    setPending(null);
  };

  const counts = goals.data?.counts;
  return (
    <div className="goals-page">
      <PageHeader
        eyebrow="Insights"
        title="Goals & streaks"
        subtitle="Set targets for answers, reviews, study time and mastery. Progress updates from what you actually do."
        aside={
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> New goal
          </button>
        }
      />

      {streak.error && <ErrorBanner message={streak.error} onRetry={streak.reload} />}
      {streak.data ? (
        <div className="goals-top">
          <StreakHero streak={streak.data} />
          <ActivityHeatmap streak={streak.data} />
        </div>
      ) : (
        streak.loading && <Loading label="Loading your streak…" />
      )}

      <section className="goals-section" aria-labelledby="goals-heading">
        <div className="goals-section-head">
          <h2 id="goals-heading">
            <Target aria-hidden /> Goals
          </h2>
          {tab === 'active' && counts && (
            <p className="goal-counts">
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <span key={s} className={`badge ${STATUS_META[s].tone}`}>
                  {counts[s]} {STATUS_META[s].label.toLowerCase()}
                </span>
              ))}
            </p>
          )}
          <Tabs
            label="Goal list"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'active', label: 'Active' },
              { key: 'archived', label: 'Archived' },
            ]}
          />
        </div>
        {goals.error && <ErrorBanner message={goals.error} onRetry={goals.reload} />}
        {!goals.data && goals.loading && <Loading label="Loading goals…" />}
        {goals.data && ordered.length === 0 && (
          <EmptyState icon={<Target />} title={tab === 'active' ? 'No active goals yet' : 'No archived goals'}>
            <p>
              {tab === 'active'
                ? 'A small daily target, like eight quiz answers, is the easiest way to build a streak.'
                : 'Goals you archive keep their history here and can be restored.'}
            </p>
            {tab === 'active' && (
              <button type="button" className="primary" onClick={() => setEditing('new')}>
                <Plus aria-hidden /> Create your first goal
              </button>
            )}
          </EmptyState>
        )}
        {ordered.length > 0 && (
          <div className="goals-grid">
            {ordered.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={setEditing}
                onArchive={(g) => run(() => goalsApi.archive(g.id), `Archived “${g.title}”`)}
                onRestore={(g) => run(() => goalsApi.restore(g.id), `Restored “${g.title}”`)}
                onDelete={(g) => setPending({ kind: 'goal', goal: g })}
              />
            ))}
          </div>
        )}
      </section>

      {summary.error && <ErrorBanner message={summary.error} onRetry={summary.reload} />}
      {summary.data && (
        <StudyTimePanel
          summary={summary.data}
          logs={logs.data?.items ?? []}
          now={now}
          onLog={() => setLogging(true)}
          onDelete={(log) => setPending({ kind: 'log', log })}
        />
      )}

      {editing && (
        <GoalModal
          workspaceId={workspace.id}
          goal={editing === 'new' ? null : editing}
          courses={courses}
          onClose={() => setEditing(null)}
          onSaved={(goal) => {
            toast.success(editing === 'new' ? `Goal “${goal.title}” created` : `Saved “${goal.title}”`);
            setEditing(null);
            refresh();
          }}
        />
      )}
      {logging && (
        <StudyLogModal
          workspaceId={workspace.id}
          courses={courses}
          now={now}
          minutesByDay={minutesByDay}
          onClose={() => setLogging(false)}
          onSaved={(log) => {
            toast.success(`Logged ${formatDuration(log.minutes)}${log.course ? ` for ${log.course.title}` : ''}`);
            setLogging(false);
            refresh();
          }}
        />
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'goal' ? 'Delete this goal?' : 'Remove this study log?'}
          message={
            pending.kind === 'goal'
              ? `“${pending.goal.title}” will be deleted. Archive it instead if you might want it back.`
              : `${formatDuration(pending.log.minutes)} logged ${formatDateTime(pending.log.logged_at)} will no longer count towards goals or your ${plural(streak.data?.current ?? 0, 'day')} streak.`
          }
          confirmLabel={pending.kind === 'goal' ? 'Delete goal' : 'Remove log'}
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
