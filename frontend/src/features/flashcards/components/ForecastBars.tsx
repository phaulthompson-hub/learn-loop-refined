import { cx } from '../../../lib/cx';
import { daysBetween, parseDate } from '../../../lib/dates';
import { formatWeekday, plural } from '../../../lib/format';
import type { ForecastDay } from '../types';

type ForecastBarsProps = { days: ForecastDay[]; now: Date; label?: string };

/** Column chart of reviews falling due on each upcoming day; today (including overdue cards) is highlighted. */
export function ForecastBars({ days, now, label = 'Reviews due over the next two weeks' }: ForecastBarsProps) {
  const peak = Math.max(1, ...days.map((d) => d.due));
  const total = days.reduce((sum, d) => sum + d.due, 0);
  return (
    <figure className="fc-forecast">
      <figcaption className="sr-only">
        {label}: {plural(total, 'review')} in total
      </figcaption>
      <ol className="fc-forecast-bars">
        {days.map((day) => {
          const offset = daysBetween(now, parseDate(day.date));
          const name = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatWeekday(day.date);
          return (
            <li key={day.date} className={cx(offset === 0 && 'is-today', !day.due && 'is-empty')} title={`${name}: ${plural(day.due, 'review')}`}>
              <span className="fc-forecast-count">{day.due || ''}</span>
              <span className="fc-forecast-bar" style={{ height: `${Math.max(4, (day.due / peak) * 100)}%` }} />
              <span className="fc-forecast-day" aria-hidden="true">
                {offset === 0 ? 'Now' : formatWeekday(day.date).slice(0, 2)}
              </span>
              <span className="sr-only">
                {name}: {plural(day.due, 'review')}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
