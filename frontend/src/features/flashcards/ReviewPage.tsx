import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, PartyPopper, Search } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { EmptyState, ErrorBanner, Loading } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatDateTime, plural, relativeTime } from '../../lib/format';
import { flashcardsApi } from './api';
import { ForecastBars } from './components/ForecastBars';
import { ReviewSession } from './components/ReviewSession';
import type { DeckDetail, ReviewQueue, ReviewStats } from './types';
import './flashcards.css';

type ReviewData = { queue: ReviewQueue; stats: ReviewStats; deck: DeckDetail | null };

function CaughtUp({ data, exitTo }: { data: ReviewData; exitTo: string }) {
  const now = useNow();
  const { queue, stats, deck } = data;
  const allowanceUsed = queue.new > 0 && queue.new_allowance === 0;
  return (
    <div className="fc-study">
      <EmptyState icon={<PartyPopper />} title="All caught up">
        <p>
          {queue.next_due_at ? (
            <>
              Nothing is due {deck ? `in ${deck.name}` : 'right now'}. Your next review is{' '}
              <b title={formatDateTime(queue.next_due_at)}>{relativeTime(queue.next_due_at, now)}</b>.
            </>
          ) : (
            'No reviews are scheduled yet. Add or import cards to start a deck.'
          )}
          {allowanceUsed && ` You've also introduced today's ${queue.new_limit} new cards; ${plural(queue.new, 'more is', 'more are')} waiting for tomorrow.`}
        </p>
        {stats.total_cards > 0 && (
          <div className="fc-caught-up-forecast">
            <p className="eyebrow">
              <CalendarClock /> Coming up
            </p>
            <ForecastBars days={stats.forecast} now={now} />
          </div>
        )}
        <div className="actions center">
          <Link className="primary" to={exitTo}>
            {deck ? 'Back to the deck' : 'Browse decks'}
          </Link>
          {stats.reviewed_today > 0 && <span className="muted">{plural(stats.reviewed_today, 'review')} done today</span>}
        </div>
      </EmptyState>
    </div>
  );
}

/** `/review` studies every deck in the workspace; `/review/:deckId` studies one deck. */
export function ReviewPage() {
  const params = useParams();
  const workspace = useWorkspace();
  const deckId = params.deckId === undefined ? null : Number(params.deckId);
  const validDeck = deckId === null || (Number.isInteger(deckId) && deckId > 0);
  // Bumped by "Check for more" to fetch a fresh queue and start a new session.
  const [round, setRound] = useState(0);
  const { data, error, loading, reload } = useLoader<ReviewData>(async () => {
    if (!validDeck) throw new Error('Deck not found');
    const [queue, stats, deck] = await Promise.all([
      flashcardsApi.queue(workspace.id, { deck_id: deckId }),
      flashcardsApi.stats(workspace.id, { deck_id: deckId }),
      deckId === null ? Promise.resolve(null) : flashcardsApi.deck(deckId),
    ]);
    return { queue, stats, deck };
  }, `review:${workspace.id}:${deckId ?? 'all'}:${round}`);

  const exitTo = deckId === null ? '/decks' : `/decks/${deckId}`;
  if (error === 'Deck not found') {
    return (
      <EmptyState icon={<Search />} title="Deck not found">
        <p>This deck does not exist in {workspace.name}, or it belongs to a course you cannot see.</p>
        <Link className="primary" to="/decks">
          Browse decks
        </Link>
      </EmptyState>
    );
  }
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;
  if (loading || !data) return <Loading label="Shuffling your cards…" />;
  if (!data.queue.cards.length) return <CaughtUp data={data} exitTo={exitTo} />;
  return (
    <ReviewSession
      key={round}
      cards={data.queue.cards}
      title={data.deck?.name ?? `All decks in ${workspace.name}`}
      workspaceId={workspace.id}
      deckId={deckId}
      exitTo={exitTo}
      onStudyMore={() => setRound((r) => r + 1)}
    />
  );
}
