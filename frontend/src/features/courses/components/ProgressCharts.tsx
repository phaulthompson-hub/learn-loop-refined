import { LEVELS, levelSlug, type MasteryLevel } from '../../../lib/mastery';
import { formatShortDate, formatWeekday, plural } from '../../../lib/format';
import type { ActivityDay } from '../types';

/** Stacked bar of how many concepts sit at each mastery level, with a legend. */
export function LevelDistribution({ counts }: { counts: Record<MasteryLevel, number> }) {
  const total = LEVELS.reduce((sum, level) => sum + counts[level], 0);
  return (
    <div className="level-distribution">
      <div className="level-stack" role="img" aria-label={LEVELS.map((l) => `${counts[l]} ${l}`).join(', ')}>
        {LEVELS.map((level) =>
          counts[level] ? (
            <i key={level} className={`fill-${levelSlug(level)}`} style={{ flexGrow: counts[level] }} title={`${counts[level]} ${level}`} />
          ) : null,
        )}
        {total === 0 && <i className="fill-empty" style={{ flexGrow: 1 }} />}
      </div>
      <ul className="level-legend">
        {LEVELS.map((level) => (
          <li key={level}>
            <span className={`legend-dot fill-${levelSlug(level)}`} aria-hidden="true" />
            <span>{level}</span>
            <b>{counts[level]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHART_HEIGHT = 72;

/** Answers per day as bars, with the correct share filled in; today is the right-most bar. */
export function ActivityChart({ days }: { days: ActivityDay[] }) {
  const peak = Math.max(1, ...days.map((d) => d.answers));
  const barWidth = 100 / Math.max(1, days.length);
  return (
    <figure className="activity-chart">
      <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={describeActivity(days)}>
        {days.map((day, index) => {
          const total = (day.answers / peak) * (CHART_HEIGHT - 4);
          const correct = (day.correct / peak) * (CHART_HEIGHT - 4);
          const x = index * barWidth + barWidth * 0.18;
          const width = barWidth * 0.64;
          return (
            <g key={day.date}>
              <title>{`${formatWeekday(day.date)}: ${plural(day.answers, 'answer')}, ${day.correct} correct`}</title>
              <rect className="bar-bg" x={x} y={0} width={width} height={CHART_HEIGHT} rx={1} />
              {day.answers > 0 && <rect className="bar-total" x={x} y={CHART_HEIGHT - total} width={width} height={total} rx={1} />}
              {day.correct > 0 && <rect className="bar-correct" x={x} y={CHART_HEIGHT - correct} width={width} height={correct} rx={1} />}
            </g>
          );
        })}
      </svg>
      {days.length > 0 && (
        <figcaption className="activity-axis">
          <span>{formatShortDate(days[0].date)}</span>
          <span>Today</span>
        </figcaption>
      )}
    </figure>
  );
}

function describeActivity(days: ActivityDay[]): string {
  const active = days.filter((d) => d.answers > 0);
  if (!active.length) return `No answers in the last ${days.length} days`;
  const answers = active.reduce((sum, d) => sum + d.answers, 0);
  return `${plural(answers, 'answer')} on ${plural(active.length, 'day')} in the last ${days.length} days`;
}
