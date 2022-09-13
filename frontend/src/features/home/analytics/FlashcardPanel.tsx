import { Layers } from 'lucide-react';
import { formatShortDate, plural } from '../../../lib/format';
import { axisLabel } from '../analyticsLogic';
import { StackedBarChart } from '../charts/StackedBarChart';
import type { Analytics } from '../types';

const GRADES = [
  { key: 'again', label: 'Again', tone: 'bad' },
  { key: 'hard', label: 'Hard', tone: 'warn' },
  { key: 'good', label: 'Good', tone: 'ok' },
  { key: 'easy', label: 'Easy', tone: 'info' },
] as const;

/** Recall rate, grade distribution and the 14-day due forecast. */
export function FlashcardPanel({ cards }: { cards: Analytics['flashcards'] }) {
  const upcoming = cards.forecast.reduce((sum, day) => sum + day.count, 0);
  return (
    <section className="panel" aria-labelledby="flashcards-title">
      <header className="panel-head">
        <h2 id="flashcards-title">
          <Layers /> Flashcards
        </h2>
        <small className="muted">{plural(cards.due_now, 'card')} due today</small>
      </header>
      <div className="recall">
        <div>
          <b className="recall-value">{cards.retention === null ? '–' : `${Math.round(cards.retention)}%`}</b>
          <small className="muted">recall rate over {plural(cards.reviews, 'review')}</small>
        </div>
        {cards.reviews > 0 && (
          <div className="grade-bar" role="img" aria-label={GRADES.map((g) => `${g.label} ${cards.grades[g.key]}`).join(', ')}>
            {GRADES.map((grade) =>
              cards.grades[grade.key] ? (
                <i key={grade.key} className={`grade-${grade.tone}`} style={{ flexGrow: cards.grades[grade.key] }} title={`${grade.label}: ${cards.grades[grade.key]}`} />
              ) : null,
            )}
          </div>
        )}
        {cards.reviews > 0 && (
          <ul className="grade-legend" aria-hidden="true">
            {GRADES.map((grade) => (
              <li key={grade.key}>
                <i className={`grade-${grade.tone}`} />
                {grade.label} {cards.grades[grade.key]}
              </li>
            ))}
          </ul>
        )}
      </div>
      <h3 className="subhead">Due in the next 14 days</h3>
      {upcoming === 0 ? (
        <p className="muted">No reviews scheduled. Study a deck and its cards will be scheduled here.</p>
      ) : (
        <StackedBarChart
          title="Flashcards due per day"
          description={`${plural(upcoming, 'card')} due over the next 14 days, ${cards.forecast[0].count} of them today (including overdue cards).`}
          labels={cards.forecast.map((d, i) => (i === 0 ? 'Today' : axisLabel(d.date, 7)))}
          fullLabels={cards.forecast.map((d) => formatShortDate(d.date))}
          series={[{ key: 'due', label: 'Cards due', values: cards.forecast.map((d) => d.count), tone: 'violet' }]}
          highlight={0}
          height={170}
        />
      )}
    </section>
  );
}
