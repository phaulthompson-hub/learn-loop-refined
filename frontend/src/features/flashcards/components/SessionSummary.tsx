import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Layers, RotateCcw, Trophy } from 'lucide-react';
import { useNow } from '../../../app/clock';
import { formatDateTime, plural, relativeTime } from '../../../lib/format';
import { GRADES, GRADE_LABELS } from '../scheduler';
import { formatElapsed, sessionMinutes, type SessionSummary as Summary } from '../session';
import type { SessionResult } from '../types';

type SessionSummaryProps = {
  summary: Summary;
  elapsedMs: number;
  /** Cards left in the queue when the session was ended early. */
  remaining: number;
  saving: boolean;
  logged: SessionResult | null;
  exitTo: string;
  onFinish: () => void;
  onStudyMore: () => void;
};

export function SessionSummary({ summary, elapsedMs, remaining, saving, logged, exitTo, onFinish, onStudyMore }: SessionSummaryProps) {
  const now = useNow();
  const minutes = sessionMinutes(elapsedMs);
  if (!summary.reviewed) {
    return (
      <section className="fc-summary panel">
        <h2>No cards reviewed</h2>
        <p className="muted">You ended the session before answering a card, so nothing was logged.</p>
        <div className="actions center">
          <button type="button" className="primary" onClick={onStudyMore}>
            <RotateCcw /> Start again
          </button>
          <Link className="secondary" to={exitTo}>
            Back to decks
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="fc-summary panel" aria-labelledby="fc-summary-title">
      <div className="hero-icon">
        <Trophy />
      </div>
      <h2 id="fc-summary-title">{remaining ? 'Session ended' : 'Session complete'}</h2>
      <p className="muted">
        {remaining ? `${plural(remaining, 'card')} stay in your queue for later.` : 'Every card in this session has been scheduled.'}
      </p>
      <dl className="fc-summary-stats">
        <div>
          <dt>
            <Layers /> Cards
          </dt>
          <dd>{summary.reviewed}</dd>
        </div>
        <div>
          <dt>
            <CheckCircle2 /> Recalled
          </dt>
          <dd>{summary.accuracy === null ? '—' : `${summary.accuracy}%`}</dd>
        </div>
        <div>
          <dt>
            <Clock /> Time
          </dt>
          <dd>{formatElapsed(elapsedMs)}</dd>
        </div>
        <div>
          <dt>Next review</dt>
          <dd title={summary.nextDueAt ? formatDateTime(summary.nextDueAt) : undefined}>
            {summary.nextDueAt ? relativeTime(summary.nextDueAt, now) : '—'}
          </dd>
        </div>
      </dl>
      <div className="fc-summary-grades" aria-label="Answers by grade">
        {GRADES.map((grade) => (
          <span key={grade} className={`fc-summary-grade fc-grade-${GRADE_LABELS[grade]}`} style={{ flexGrow: summary.gradeCounts[grade] }}>
            {summary.gradeCounts[grade] > 0 && `${GRADE_LABELS[grade]} ${summary.gradeCounts[grade]}`}
          </span>
        ))}
      </div>
      {logged ? (
        <p className="fc-summary-logged" role="status">
          <CheckCircle2 /> Logged {plural(logged.minutes, 'minute')} of flashcard practice.
        </p>
      ) : (
        <p className="muted">Finishing adds {plural(minutes, 'minute')} to your study time and shares the session with your workspace.</p>
      )}
      <div className="actions center">
        {!logged && (
          <button type="button" className="primary" disabled={saving} onClick={onFinish}>
            {saving ? 'Saving…' : `Finish & log ${minutes} min`}
          </button>
        )}
        <button type="button" className="secondary" onClick={onStudyMore}>
          <RotateCcw /> Check for more
        </button>
        <Link className="ghost" to={exitTo}>
          Back to decks
        </Link>
      </div>
    </section>
  );
}
