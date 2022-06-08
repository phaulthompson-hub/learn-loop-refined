import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Play, Wand2 } from 'lucide-react';
import { MasteryBar } from '../../../components/ui';
import { cx } from '../../../lib/cx';
import { formatDateTime, plural, relativeTime, truncate } from '../../../lib/format';
import { studyAction } from '../decks';
import type { DeckSummary } from '../types';

type DeckTileProps = { deck: DeckSummary; now: Date; newAllowance: number };

/** One deck in the grid: what is waiting today, how settled the deck is, and a one-click study button. */
export function DeckTile({ deck, now, newAllowance }: DeckTileProps) {
  const action = studyAction(deck, newAllowance);
  const footnote = deck.next_due_at && !deck.due ? `Next review ${relativeTime(deck.next_due_at, now)}` : deck.last_reviewed_at ? `Studied ${relativeTime(deck.last_reviewed_at, now)}` : 'Not studied yet';
  return (
    <article className="fc-deck" style={{ ['--deck-color' as string]: deck.course_color }}>
      <header>
        <h3>
          <Link to={`/decks/${deck.id}`}>{deck.name}</Link>
        </h3>
        <div className="fc-deck-badges">
          {deck.due > 0 && (
            <span className="badge warn" title={`${plural(deck.due, 'card')} due today`}>
              <Clock /> {deck.due} due
            </span>
          )}
          {deck.new > 0 && (
            <span className="badge info" title={`${plural(deck.new, 'card')} never reviewed`}>
              <Wand2 /> {deck.new} new
            </span>
          )}
        </div>
      </header>
      <p className="fc-deck-description">{deck.description ? truncate(deck.description, 120) : <span className="muted">No description</span>}</p>
      <div className="fc-deck-mastery">
        <MasteryBar value={deck.mastery} label={`${deck.name} mastery`} />
        <small>
          <b>{Math.round(deck.mastery)}%</b> settled · {plural(deck.card_count, 'card')}
          {deck.retention !== null && ` · ${Math.round(deck.retention)}% recall`}
        </small>
      </div>
      <footer>
        <small className="muted" title={deck.next_due_at ? formatDateTime(deck.next_due_at) : undefined}>
          {footnote}
        </small>
        {action.kind === 'done' ? (
          <span className="fc-deck-done">
            <CheckCircle2 /> Caught up
          </span>
        ) : (
          <Link className={cx('small', action.kind === 'due' ? 'primary' : 'secondary')} to={`/review/${deck.id}`}>
            <Play /> {action.label}
          </Link>
        )}
      </footer>
    </article>
  );
}
