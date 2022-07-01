import { CheckCircle2, Flame, Trophy } from 'lucide-react';
import { cx } from '../../lib/cx';
import { formatDuration, formatNumber, plural } from '../../lib/format';
import type { Streak } from './types';

function todayMessage(streak: Streak): string {
  if (streak.active_today) return 'You have studied today. The streak is safe.';
  if (streak.current > 0) return `Study today to keep your ${plural(streak.current, 'day')} streak going.`;
  return 'Answer a question, review a card or log study time to start a streak.';
}

/** Current and best streak with today's status, plus the 12-week totals behind the heatmap. */
export function StreakHero({ streak }: { streak: Streak }) {
  const { totals } = streak.heatmap;
  const best = streak.longest > 0 && streak.current >= streak.longest;
  return (
    <section className={cx('streak-hero', streak.active_today ? 'is-active' : 'is-pending')} aria-label="Study streak">
      <div className="goals-streak-flame" aria-hidden>
        <Flame />
      </div>
      <div className="streak-main">
        <p className="eyebrow">Current streak</p>
        <p className="goals-streak-count">
          <b>{streak.current}</b> {streak.current === 1 ? 'day' : 'days'}
          {best && (
            <span className="badge ok">
              <Trophy aria-hidden /> Personal best
            </span>
          )}
        </p>
        <p className="streak-today">
          {streak.active_today && <CheckCircle2 aria-hidden />}
          {todayMessage(streak)}
        </p>
      </div>
      <dl className="streak-facts">
        <div>
          <dt>Longest</dt>
          <dd>{plural(streak.longest, 'day')}</dd>
        </div>
        <div>
          <dt>Active, last 30 days</dt>
          <dd>{streak.active_days_last_30} / 30</dd>
        </div>
        <div>
          <dt>12 weeks</dt>
          <dd>
            {formatNumber(totals.answers)} answers · {formatNumber(totals.reviews)} reviews · {formatDuration(totals.minutes)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
