import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { cx } from '../../../lib/cx';

type FlipCardProps = {
  front: string;
  back: string;
  hint?: string;
  flipped: boolean;
  /** Clicking the card surface flips it (keyboard users use the Show answer button or Space). */
  onFlip?: () => void;
  hintShown?: boolean;
  onToggleHint?: () => void;
  /** Small line above the question, e.g. course and deck. */
  meta?: ReactNode;
  size?: 'lg' | 'sm';
};

/** A two-sided card that turns over in 3D. The hidden side is removed from the accessibility tree. */
export function FlipCard({ front, back, hint, flipped, onFlip, hintShown = false, onToggleHint, meta, size = 'lg' }: FlipCardProps) {
  return (
    <div className={cx('fc-flip', `fc-flip-${size}`, flipped && 'is-flipped', onFlip && 'is-clickable')} onClick={onFlip}>
      <div className="fc-flip-inner">
        <section className="fc-face fc-face-front" aria-hidden={flipped}>
          {meta && <div className="fc-face-meta">{meta}</div>}
          <p className="fc-face-text">{front || <span className="muted">The question appears here</span>}</p>
          {hint && onToggleHint && (
            <div className="fc-hint">
              {hintShown ? (
                <p>
                  <Lightbulb /> {hint}
                </p>
              ) : (
                <button
                  type="button"
                  className="ghost small"
                  tabIndex={flipped ? -1 : 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleHint();
                  }}
                >
                  <Lightbulb /> Show hint
                </button>
              )}
            </div>
          )}
          {hint && !onToggleHint && (
            <p className="fc-hint muted">
              <Lightbulb /> {hint}
            </p>
          )}
        </section>
        <section className="fc-face fc-face-back" aria-hidden={!flipped} aria-live="polite">
          <p className="fc-face-question">{front}</p>
          <p className="fc-face-text">{back || <span className="muted">The answer appears here</span>}</p>
        </section>
      </div>
    </div>
  );
}
