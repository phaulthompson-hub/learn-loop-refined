import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useToast } from '../../../app/toast';
import { flashcardsApi } from '../api';
import { STATUS_LABELS, STATUS_TONES } from '../decks';
import { previewIntervals } from '../scheduler';
import { durationSeconds, gradeForKey, sessionProgress, sessionReducer, startSession, summarize } from '../session';
import type { Grade, ReviewCard, SessionResult } from '../types';
import { FlipCard } from './FlipCard';
import { GradeBar } from './GradeBar';
import { SessionSummary } from './SessionSummary';

type ReviewSessionProps = {
  cards: ReviewCard[];
  title: string;
  workspaceId: number;
  deckId: number | null;
  exitTo: string;
  onStudyMore: () => void;
};

/** Keys typed into form fields or used to press a focused control must not grade cards. */
function ignoresShortcuts(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return (key === ' ' || key === 'Enter') && target.closest('button, a') !== null;
}

/** The distraction-free study loop: one card at a time, Space to flip, 1-4 to grade, forgotten cards come back. */
export function ReviewSession({ cards, title, workspaceId, deckId, exitTo, onStudyMore }: ReviewSessionProps) {
  const toast = useToast();
  const [state, dispatch] = useReducer(sessionReducer, cards, startSession);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logged, setLogged] = useState<SessionResult | null>(null);
  const startedAt = useRef<number | null>(null);
  const card = state.queue[0];
  const progress = sessionProgress(state);

  const flip = useCallback(() => {
    startedAt.current ??= performance.now();
    dispatch({ type: 'flip' });
  }, []);

  const grade = useCallback(
    async (value: Grade) => {
      if (!card || !state.flipped || busy) return;
      setBusy(true);
      try {
        const result = await flashcardsApi.review(card.id, value);
        const elapsedMs = performance.now() - (startedAt.current ?? performance.now());
        dispatch({ type: 'answered', grade: value, result, elapsedMs });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save that answer');
      } finally {
        setBusy(false);
      }
    },
    [busy, card, state.flipped, toast],
  );

  useEffect(() => {
    if (state.phase !== 'studying') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ignoresShortcuts(event.target, event.key)) return;
      const value = gradeForKey(event.key);
      if (event.key === ' ' || event.key === 'Enter') flip();
      else if (value !== null && state.flipped) void grade(value);
      else if (event.key.toLowerCase() === 'h') dispatch({ type: 'hint' });
      else if (event.key === 'Escape') dispatch({ type: 'end' });
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flip, grade, state.flipped, state.phase]);

  const summary = summarize(state.answers);

  const finish = async () => {
    setSaving(true);
    try {
      const result = await flashcardsApi.finishSession(workspaceId, {
        deck_id: deckId,
        reviewed: summary.reviewed,
        again: summary.forgotten,
        duration_seconds: durationSeconds(state.elapsedMs),
      });
      setLogged(result);
      toast.success(`Nice work: ${result.minutes} min logged`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log this session');
    } finally {
      setSaving(false);
    }
  };

  if (state.phase === 'done' || !card) {
    return (
      <div className="fc-study">
        <SessionSummary
          summary={summary}
          elapsedMs={state.elapsedMs}
          remaining={state.queue.length}
          saving={saving}
          logged={logged}
          exitTo={exitTo}
          onFinish={finish}
          onStudyMore={onStudyMore}
        />
      </div>
    );
  }

  return (
    <div className="fc-study">
      <header className="fc-study-head">
        <Link to={exitTo} className="icon-only" aria-label="Leave the session">
          <X />
        </Link>
        <div className="fc-study-title">
          <b>{title}</b>
          <span className="muted">
            {progress.done} of {progress.total} answered
          </span>
        </div>
        <button type="button" className="ghost small" onClick={() => dispatch({ type: 'end' })}>
          End session <kbd>Esc</kbd>
        </button>
      </header>
      <div className="fc-progress" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <i style={{ width: `${progress.percent}%` }} />
      </div>
      <ul className="fc-study-counts" aria-label="Cards left">
        <li className="is-review">
          <b>{progress.review}</b> to review
        </li>
        <li className="is-learning">
          <b>{progress.relearning}</b> relearning
        </li>
        <li className="is-new">
          <b>{progress.fresh}</b> new
        </li>
      </ul>
      <FlipCard
        key={`${card.id}-${progress.done}`}
        front={card.front}
        back={card.back}
        hint={card.hint}
        flipped={state.flipped}
        onFlip={flip}
        hintShown={state.hintShown}
        onToggleHint={() => dispatch({ type: 'hint' })}
        meta={
          <>
            <span className="color-dot" style={{ background: card.course_color }} />
            <span>{card.deck_name}</span>
            <span className={`badge ${STATUS_TONES[card.status]}`}>{card.status === 'young' || card.status === 'mature' ? 'Review' : STATUS_LABELS[card.status]}</span>
            {card.concept_name && <span className="tag">{card.concept_name}</span>}
          </>
        }
      />
      <GradeBar flipped={state.flipped} previews={previewIntervals(card)} busy={busy} onFlip={flip} onGrade={(value) => void grade(value)} />
      <p className="fc-shortcuts muted" aria-hidden="true">
        <kbd>Space</kbd> flip · <kbd>1</kbd>–<kbd>4</kbd> grade · <kbd>H</kbd> hint · <kbd>Esc</kbd> end
      </p>
    </div>
  );
}
