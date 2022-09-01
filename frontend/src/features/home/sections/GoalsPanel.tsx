import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { ProgressRing } from '../charts/ProgressRing';
import { goalProgressText, goalStatus } from '../homeLogic';
import type { GoalItem } from '../types';

const RING_COLORS: Record<string, string> = {
  ok: 'var(--ok)',
  brand: 'var(--brand)',
  info: 'var(--brand)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  muted: 'var(--muted)',
};

/** Active goals as progress rings, coloured by pace. */
export function GoalsPanel({ goals }: { goals: GoalItem[] }) {
  return (
    <section className="panel home-panel" aria-labelledby="goals-title">
      <header className="panel-head">
        <h2 id="goals-title">
          <Target /> Goals
        </h2>
        <Link className="ghost small" to="/goals">
          Manage
        </Link>
      </header>
      {goals.length === 0 ? (
        <div className="section-empty">
          <p>
            <b>No goals yet.</b> A small weekly target, like 40 flashcard reviews, keeps momentum visible.
          </p>
          <Link className="secondary small" to="/goals">
            Set a goal
          </Link>
        </div>
      ) : (
        <ul className="goal-grid">
          {goals.map((goal) => {
            const status = goalStatus(goal.status);
            return (
              <li key={goal.id}>
                <ProgressRing value={goal.percent} label={goal.title} color={RING_COLORS[status.tone] ?? 'var(--brand)'} size={68}>
                  <b>{Math.round(goal.percent)}%</b>
                </ProgressRing>
                <div className="goal-text">
                  <b className="goal-title">{goal.title}</b>
                  <small className="muted">{goalProgressText(goal)}</small>
                  <span className="goal-meta">
                    <span className={cx('badge', status.tone)}>{status.label}</span>
                    <small className="muted">{goal.period_label}</small>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
