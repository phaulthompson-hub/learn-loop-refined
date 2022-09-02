import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { formatDuration, formatNumber, plural } from '../../../lib/format';
import { axisLabel } from '../analyticsLogic';
import type { Tone } from '../charts/ChartFrame';
import { HeatStrip } from '../charts/HeatStrip';
import { Sparkline } from '../charts/Sparkline';
import { Delta } from '../components/Delta';
import type { Comparison, Home, WeekDay } from '../types';

type Tile = { key: string; label: string; comparison: Comparison; value: string; unit?: string; series?: number[]; tone: Tone };

function tiles(week: Home['week']): Tile[] {
  const pick = (field: keyof Omit<WeekDay, 'date'>) => week.days.map((d) => d[field]);
  return [
    { key: 'answers', label: 'Questions', comparison: week.answers, value: formatNumber(week.answers.value), series: pick('answers'), tone: 'brand' },
    { key: 'accuracy', label: 'Accuracy', comparison: week.accuracy, value: `${Math.round(week.accuracy.value)}%`, unit: 'pts', tone: 'info' },
    { key: 'reviews', label: 'Cards reviewed', comparison: week.reviews, value: formatNumber(week.reviews.value), series: pick('reviews'), tone: 'violet' },
    { key: 'minutes', label: 'Study time', comparison: week.minutes, value: formatDuration(week.minutes.value), unit: 'min', series: pick('minutes'), tone: 'warn' },
  ];
}

/** Last 7 days against the 7 before: four tiles with deltas and daily sparklines. */
export function WeekPanel({ week }: { week: Home['week'] }) {
  return (
    <section className="panel home-panel" aria-labelledby="week-title">
      <header className="panel-head">
        <h2 id="week-title">
          <BarChart3 /> Last 7 days
        </h2>
        <Link className="ghost small" to="/analytics?days=7">
          Analytics
        </Link>
      </header>
      <ul className="week-tiles">
        {tiles(week).map((tile) => (
          <li key={tile.key}>
            <span className="week-label">{tile.label}</span>
            <b className="week-value">{tile.value}</b>
            <Delta comparison={tile.comparison} unit={tile.unit} period="the week before" />
            {tile.series && <Sparkline values={tile.series} tone={tile.tone} />}
          </li>
        ))}
      </ul>
      <HeatStrip
        label="Practice per day, last 7 days"
        cells={week.days.map((day) => ({
          key: day.date,
          label: axisLabel(day.date, 7),
          // Ten minutes of logged study weigh about as much as one answer or review.
          value: day.answers + day.reviews + day.minutes / 10,
          detail: `${plural(day.answers, 'answer')}, ${plural(day.reviews, 'review')}, ${formatDuration(day.minutes)}`,
        }))}
      />
    </section>
  );
}
