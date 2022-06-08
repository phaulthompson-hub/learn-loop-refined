import { useState } from 'react';
import { useNow } from '../../../app/clock';
import { Modal } from '../../../components/Modal';
import { formatDate, relativeDay, relativeTime } from '../../../lib/format';
import { STATUS_HINTS, STATUS_LABELS, STATUS_TONES } from '../decks';
import { formatInterval } from '../scheduler';
import type { Card } from '../types';
import { FlipCard } from './FlipCard';

/** Read-only look at one card and the viewer's schedule for it. */
export function CardPreviewModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const now = useNow();
  const [flipped, setFlipped] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  return (
    <Modal title="Card" description={card.concept_name ? `Concept: ${card.concept_name}` : undefined} onClose={onClose}>
      <div className="stack">
        <FlipCard front={card.front} back={card.back} hint={card.hint} flipped={flipped} onFlip={() => setFlipped((f) => !f)} hintShown={hintShown} onToggleHint={() => setHintShown((h) => !h)} />
        <button type="button" className="secondary" onClick={() => setFlipped((f) => !f)} data-autofocus>
          {flipped ? 'Show question' : 'Show answer'}
        </button>
        <dl className="fc-card-facts">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`badge ${STATUS_TONES[card.status]}`} title={STATUS_HINTS[card.status]}>
                {STATUS_LABELS[card.status]}
              </span>
            </dd>
          </div>
          <div>
            <dt>Next review</dt>
            <dd>{card.due_at ? relativeDay(card.due_at, now) : 'When you study it'}</dd>
          </div>
          <div>
            <dt>Interval</dt>
            <dd>{card.status === 'new' ? '—' : formatInterval(card.interval_days)}</dd>
          </div>
          <div>
            <dt>Reviews</dt>
            <dd>
              {card.reviews}
              {card.lapses > 0 && <small className="muted"> · {card.lapses} forgotten</small>}
            </dd>
          </div>
          <div>
            <dt>Ease</dt>
            <dd>{card.ease === null ? '—' : card.ease.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Last studied</dt>
            <dd title={card.last_reviewed_at ? formatDate(card.last_reviewed_at) : undefined}>{card.last_reviewed_at ? relativeTime(card.last_reviewed_at, now) : 'Never'}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
