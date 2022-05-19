import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, CheckCircle2, Keyboard, PartyPopper, RotateCcw, XCircle } from 'lucide-react';
import { useUser } from '../../app/auth';
import { EmptyState, ErrorBanner, Loading, MasteryBar } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { formatDelta } from '../../lib/mastery';
import { courseApi } from './api';
import { MasteryRing } from './components/MasteryRing';
import { useCourse } from './courseContext';
import { optionForKey, quizLength, roundHeadline, summariseRound } from './quiz';
import type { AnswerResult, Question } from './types';

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

function RoundSummary({ results, courseId, onRestart }: { results: AnswerResult[]; courseId: number; onRestart: () => void }) {
  const summary = summariseRound(results);
  const last = results.at(-1);
  return (
    <section className="panel quiz-summary" aria-labelledby="summary-title">
      <div className="quiz-summary-head">
        <MasteryRing value={summary.accuracy} size={96} label="Round score" caption="correct" />
        <div>
          <p className="eyebrow">Round complete</p>
          <h2 id="summary-title">{roundHeadline(summary)}</h2>
          <p className="muted">
            {summary.correct} of {summary.total} correct · net mastery {formatDelta(0, summary.netChange)} points
          </p>
        </div>
      </div>
      {summary.newlyMastered.length > 0 && (
        <p className="quiz-celebrate">
          <PartyPopper /> You mastered {summary.newlyMastered.join(', ')}!
        </p>
      )}
      <table className="data-table quiz-changes">
        <caption className="sr-only">Mastery change per concept</caption>
        <thead>
          <tr>
            <th>Concept</th>
            <th style={{ textAlign: 'center' }}>Answers</th>
            <th style={{ textAlign: 'right' }}>Before</th>
            <th style={{ textAlign: 'right' }}>After</th>
            <th style={{ textAlign: 'right' }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {summary.concepts.map((c) => (
            <tr key={c.conceptId}>
              <td>{c.name}</td>
              <td style={{ textAlign: 'center' }}>
                {c.correct}/{c.answers}
              </td>
              <td style={{ textAlign: 'right' }}>{Math.round(c.before)}%</td>
              <td style={{ textAlign: 'right' }}>{Math.round(c.after)}%</td>
              <td style={{ textAlign: 'right' }} className={c.after >= c.before ? 'ok' : 'bad'}>
                {formatDelta(c.before, c.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {last && (
        <p className="recommendation">
          <b>Next focus:</b> {last.recommendation.concept ?? 'Everything is mastered'} — {last.recommendation.reason}
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={onRestart} data-autofocus>
          <RotateCcw /> New round
        </button>
        <Link className="secondary" to={`/courses/${courseId}`}>
          Back to the knowledge map
        </Link>
      </div>
    </section>
  );
}

export function QuizPage() {
  const { course, reload: reloadCourse } = useCourse();
  const user = useUser();
  const count = quizLength(user.quiz_length);
  const [round, setRound] = useState(1);
  const { data: questions, error, loading, reload } = useLoader(() => courseApi.quiz(course.id, count), `quiz:${course.id}:${count}:${round}`);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [results, setResults] = useState<AnswerResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  const question: Question | undefined = questions?.[index];
  const result = results[index] as AnswerResult | undefined;
  const finished = !!questions && questions.length > 0 && index >= questions.length;

  const submit = async (option: number) => {
    if (!question || result || busy) return;
    setBusy(true);
    setSelected(option);
    setSubmitError(null);
    try {
      const answer = await courseApi.answer(course.id, question, option);
      setResults((previous) => [...previous, answer]);
      reloadCourse();
    } catch (err) {
      setSelected(null);
      setSubmitError(err instanceof Error ? err.message : 'Could not submit your answer');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setIndex((i) => i + 1);
    setSelected(null);
  };

  const restart = () => {
    setRound((r) => r + 1);
    setIndex(0);
    setSelected(null);
    setResults([]);
  };

  useEffect(() => {
    if (result) nextButton.current?.focus();
  }, [result]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || !question) return;
      if (result) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          next();
        }
        return;
      }
      const option = optionForKey(event.key, question.options.length);
      if (option !== null) {
        event.preventDefault();
        void submit(option);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!course.concepts.length) {
    return (
      <EmptyState icon={<BookOpenCheck />} title="Nothing to quiz yet">
        <p>This course has no concepts. Add learning material first.</p>
      </EmptyState>
    );
  }
  if (loading && !questions) return <Loading label="Preparing your adaptive quiz…" />;
  if (error && !questions) return <ErrorBanner message={error} onRetry={reload} />;
  if (!questions) return null;
  if (finished) return <RoundSummary results={results} courseId={course.id} onRestart={restart} />;
  if (!question) return null;

  return (
    <section className="panel quiz" aria-labelledby="quiz-prompt">
      <div className="quiz-top">
        <span className="muted">
          Round {round} · Question {index + 1} of {questions.length}
        </span>
        <ol className="quiz-dots" aria-label="Round progress">
          {questions.map((q, i) => {
            const answered = results[i];
            const state = answered ? (answered.correct ? 'correct' : 'wrong') : i === index ? 'current' : 'pending';
            return <li key={q.id} className={`dot-${state}`} aria-label={`Question ${i + 1}: ${state}`} />;
          })}
        </ol>
      </div>
      <p className="eyebrow">{question.concept}</p>
      <h2 id="quiz-prompt">{question.prompt}</h2>
      {submitError && <ErrorBanner message={submitError} />}
      <div className="options" role="group" aria-label="Answer options">
        {question.options.map((option, i) => {
          const state = result ? (i === result.correct_index ? 'correct' : i === selected ? 'wrong' : 'dim') : i === selected ? 'pending' : '';
          return (
            <button type="button" key={i} className={cx('option', state)} disabled={!!result || busy} onClick={() => void submit(i)} aria-keyshortcuts={String(i + 1)}>
              <span className="option-index">{i + 1}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      {result ? (
        <div className={`feedback ${result.correct ? 'ok' : 'bad'}`} role="status">
          {result.correct ? <CheckCircle2 /> : <XCircle />}
          <div className="feedback-body">
            <b>{result.correct ? 'Correct!' : `Not quite — the answer was option ${result.correct_index + 1}.`}</b>
            <p>
              {result.concept}: {Math.round(result.previous_mastery)}% → <b>{Math.round(result.mastery)}%</b>{' '}
              <span className={result.correct ? 'ok' : 'bad'}>({formatDelta(result.previous_mastery, result.mastery)})</span>
            </p>
            <MasteryBar value={result.mastery} label={`${result.concept} mastery after this answer`} />
            <p className="muted">
              Next focus: {result.recommendation.concept ?? 'Everything is mastered'} · {result.recommendation.reason}
            </p>
          </div>
          <button ref={nextButton} type="button" className="primary small" onClick={next}>
            {index + 1 < questions.length ? 'Next question' : 'See results'} <ArrowRight />
          </button>
        </div>
      ) : (
        <p className="quiz-hint muted">
          <Keyboard /> Press <kbd>1</kbd>–<kbd>{question.options.length}</kbd> to answer, then <kbd>Enter</kbd> for the next question.
        </p>
      )}
    </section>
  );
}
