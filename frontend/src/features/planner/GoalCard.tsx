import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Menu, type MenuItem } from '../../components/Menu';
import { cx } from '../../lib/cx';
import { ringGeometry } from './charts';
import { GOAL_KIND_META, STATUS_META, goalAmount as amount, paceHint } from './goalForm';
import type { Goal } from './types';

const RADIUS = 34;

export function ProgressRing({ percent, tone, label }: { percent: number; tone: string; label: string }) {
  const { circumference, offset } = ringGeometry(percent, RADIUS);
  return (
    <svg className={cx('goal-ring', `tone-${tone}`)} viewBox="0 0 84 84" role="img" aria-label={label}>
      <circle className="goal-ring-track" cx="42" cy="42" r={RADIUS} />
      <circle
        className="goal-ring-value"
        cx="42"
        cy="42"
        r={RADIUS}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 42 42)"
      />
      <text x="42" y="47" textAnchor="middle">
        {percent}%
      </text>
    </svg>
  );
}

type GoalCardProps = {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onArchive: (goal: Goal) => void;
  onRestore: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
};

export function GoalCard({ goal, onEdit, onArchive, onRestore, onDelete }: GoalCardProps) {
  const { progress } = goal;
  const status = STATUS_META[progress.status];
  const items: MenuItem[] = goal.archived
    ? [
        { label: 'Restore', icon: <ArchiveRestore />, onSelect: () => onRestore(goal) },
        'separator',
        { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => onDelete(goal) },
      ]
    : [
        { label: 'Edit', icon: <Pencil />, onSelect: () => onEdit(goal) },
        { label: 'Archive', icon: <Archive />, onSelect: () => onArchive(goal) },
        'separator',
        { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => onDelete(goal) },
      ];
  const showPace = !goal.archived && progress.status !== 'done' && progress.expected > 0 && progress.period_end !== null;

  return (
    <article className={cx('goal-card', `status-${progress.status}`, goal.archived && 'archived')}>
      <header>
        <span className={cx('badge', status.tone)}>{status.label}</span>
        <Menu
          items={items}
          trigger={({ toggle, ref, open }) => (
            <button type="button" ref={ref} className="icon-only" aria-label={`Actions for ${goal.title}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
              <MoreHorizontal />
            </button>
          )}
        />
      </header>
      <div className="goal-body">
        <ProgressRing percent={progress.percent} tone={status.tone} label={`${progress.percent}% of ${goal.title}`} />
        <div className="goal-text">
          <h3>{goal.title}</h3>
          <p className="goal-amount">
            <b>{amount(goal, progress.current)}</b> / {amount(goal, progress.target)} {goal.kind === 'course_mastery' ? 'mastery' : progress.unit}
          </p>
          <p className="muted goal-card-meta">
            {GOAL_KIND_META[goal.kind].label} · {progress.period_label}
          </p>
        </div>
      </div>
      <footer>
        {goal.course && (
          <span className="course-pill">
            <span className="color-dot" style={{ background: goal.course.color }} />
            {goal.course.title}
          </span>
        )}
        <span className="goal-hint">{paceHint(goal)}</span>
        {showPace && (
          <span className="muted goal-expected">
            Pace: {amount(goal, progress.expected)} by now
          </span>
        )}
      </footer>
    </article>
  );
}
