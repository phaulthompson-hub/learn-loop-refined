import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Flame, Layers } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { formatLongDate, plural } from '../../../lib/format';
import { daySummary, greetingTitle, streakCopy, weekdayInitial } from '../homeLogic';
import type { Home } from '../types';

/** Greeting, today's date, streak flame with the last 7 days, and the review call to action. */
export function HomeHero({ home, now }: { home: Home; now: Date }) {
  const { greeting, streak, flashcards, week } = home;
  const hasCards = flashcards.total > 0;
  return (
    <section className="home-hero" aria-labelledby="home-greeting">
      <div className="hero-copy">
        <p className="hero-date">{formatLongDate(now)}</p>
        <h1 id="home-greeting">{greetingTitle(greeting.part_of_day, greeting.first_name)}</h1>
        <p className="hero-summary">{daySummary(home)}</p>
        <div className="hero-actions">
          {hasCards ? (
            <Link className="hero-cta" to="/review">
              <Layers />
              {flashcards.due ? `Review ${plural(flashcards.due, 'card')}` : 'Study new cards'}
              <ArrowRight />
            </Link>
          ) : (
            <Link className="hero-cta" to="/decks">
              <Layers />
              Create your first deck
              <ArrowRight />
            </Link>
          )}
          <Link className="hero-link" to="/planner">
            <CalendarDays />
            Open planner
          </Link>
        </div>
        {hasCards && (
          <p className="hero-cards">
            <b>{flashcards.due}</b> due · <b>{flashcards.new}</b> new · {plural(flashcards.total, 'card')} in this workspace
          </p>
        )}
      </div>
      <div className={cx('hero-streak', streak.active_today && 'lit')}>
        <div className="streak-flame" aria-hidden="true">
          <Flame />
        </div>
        <p className="streak-count">
          <b>{streak.current}</b>
          <span>day streak</span>
        </p>
        <p className="streak-copy">{streakCopy(streak)}</p>
        <ol className="streak-week" aria-label="Activity over the last 7 days">
          {week.days.map((day) => {
            const active = day.answers + day.reviews + day.minutes > 0;
            return (
              <li key={day.date} className={cx(active && 'active')} title={`${formatLongDate(day.date)}: ${active ? 'studied' : 'no study'}`}>
                <span aria-hidden="true">{weekdayInitial(day.date)}</span>
                <span className="sr-only">{`${formatLongDate(day.date)}: ${active ? 'studied' : 'no study'}`}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
