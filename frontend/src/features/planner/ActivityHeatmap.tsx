import { CalendarCheck } from 'lucide-react';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import { weekdayLabels } from './calendar';
import { heatmapColumns, heatmapTitle, monthLabels } from './charts';
import type { Streak } from './types';

const LEVELS = [0, 1, 2, 3, 4];

/** GitHub-style grid: one column per week, one row per weekday, darker for busier days. */
export function ActivityHeatmap({ streak }: { streak: Streak }) {
  const columns = heatmapColumns(streak.heatmap.days);
  const months = monthLabels(columns);
  const labels = weekdayLabels(streak.week_starts_on);
  return (
    <section className="panel heatmap-panel">
      <div className="panel-head">
        <h2>
          <CalendarCheck aria-hidden /> Activity
        </h2>
        <span className="muted">{plural(streak.heatmap.active_days, 'active day')} in the last {streak.heatmap.weeks} weeks</span>
      </div>
      <div className="heatmap-scroll">
        <div className="heatmap" style={{ gridTemplateColumns: `auto repeat(${columns.length}, var(--cell))` }}>
          <span />
          {columns.map((_, index) => (
            <span key={index} className="heatmap-month" aria-hidden>
              {months.find((m) => m.column === index)?.label ?? ''}
            </span>
          ))}
          {labels.map((label, row) => (
            <div key={label} className="heatmap-row" style={{ display: 'contents' }}>
              <span className="heatmap-weekday" aria-hidden>
                {row % 2 === 0 ? label : ''}
              </span>
              {columns.map((column) => {
                const day = column[row];
                return day ? (
                  <span
                    key={day.date}
                    className={cx('heatmap-cell', `level-${day.level}`, day.future && 'future')}
                    title={heatmapTitle(day)}
                    role="img"
                    aria-label={heatmapTitle(day)}
                  />
                ) : null;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend" aria-hidden>
        <span>Less</span>
        {LEVELS.map((level) => (
          <span key={level} className={cx('heatmap-cell', `level-${level}`)} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
