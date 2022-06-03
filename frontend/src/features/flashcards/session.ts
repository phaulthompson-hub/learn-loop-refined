// State machine for one review session. Pure, so the flow (flip, grade, relearn forgotten cards, finish)
// is unit-tested without rendering. The component only performs the API call and dispatches its result.
import { AGAIN, cardStatus, isGrade, previewIntervals, type Schedule } from './scheduler';
import type { Grade, ReviewCard, ReviewResult } from './types';

export type Answer = { cardId: number; grade: Grade; intervalDays: number; dueAt: string };

export type SessionState = {
  /** Cards still to answer; the first one is on screen. */
  queue: ReviewCard[];
  flipped: boolean;
  hintShown: boolean;
  answers: Answer[];
  /** Milliseconds between the first interaction and the latest answer. */
  elapsedMs: number;
  phase: 'studying' | 'done';
};

export type SessionAction =
  | { type: 'flip' }
  | { type: 'hint' }
  | { type: 'answered'; grade: Grade; result: ReviewResult; elapsedMs: number }
  | { type: 'end' };

export function startSession(cards: ReviewCard[]): SessionState {
  return { queue: cards, flipped: false, hintShown: false, answers: [], elapsedMs: 0, phase: cards.length ? 'studying' : 'done' };
}

/** The card as it looks after the server rescheduled it, so a forgotten card can be shown again later. */
export function relearnCard(card: ReviewCard, result: ReviewResult): ReviewCard {
  const schedule: Schedule = {
    ease: result.ease,
    interval_days: result.interval_days,
    repetitions: result.repetitions,
    lapses: result.lapses,
  };
  return { ...card, ...schedule, status: cardStatus(schedule), due_at: result.due_at, previews: previewIntervals(schedule) };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (state.phase === 'done') return state;
  switch (action.type) {
    case 'flip':
      return { ...state, flipped: !state.flipped };
    case 'hint':
      return { ...state, hintShown: !state.hintShown };
    case 'end':
      return { ...state, phase: 'done', flipped: false };
    case 'answered': {
      const [card, ...rest] = state.queue;
      if (!card || card.id !== action.result.card_id) return state;
      // Forgotten cards go to the back of the queue and must be recalled before the session ends.
      const queue = action.grade === AGAIN ? [...rest, relearnCard(card, action.result)] : rest;
      const answer: Answer = { cardId: card.id, grade: action.grade, intervalDays: action.result.interval_days, dueAt: action.result.due_at };
      return {
        queue,
        flipped: false,
        hintShown: false,
        answers: [...state.answers, answer],
        elapsedMs: Math.max(state.elapsedMs, action.elapsedMs),
        phase: queue.length ? 'studying' : 'done',
      };
    }
  }
}

export type SessionProgress = { done: number; total: number; percent: number; fresh: number; relearning: number; review: number };

export function sessionProgress(state: SessionState): SessionProgress {
  const done = state.answers.length;
  const total = done + state.queue.length;
  return {
    done,
    total,
    percent: total ? Math.round((100 * done) / total) : 100,
    fresh: state.queue.filter((c) => c.status === 'new').length,
    relearning: state.queue.filter((c) => c.status === 'learning').length,
    review: state.queue.filter((c) => c.status === 'young' || c.status === 'mature').length,
  };
}

export type SessionSummary = {
  /** Distinct cards answered at least once. */
  reviewed: number;
  /** Distinct cards answered "again" at least once. */
  forgotten: number;
  answers: number;
  /** Share of reviewed cards recalled without an "again" (matches the API's session accuracy). */
  accuracy: number | null;
  gradeCounts: Record<Grade, number>;
  /** Earliest next review among the cards studied, once each card's final answer is in. */
  nextDueAt: string | null;
};

export function summarize(answers: readonly Answer[]): SessionSummary {
  const finalDue = new Map<number, string>();
  const forgotten = new Set<number>();
  const gradeCounts: Record<Grade, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const answer of answers) {
    finalDue.set(answer.cardId, answer.dueAt);
    gradeCounts[answer.grade] += 1;
    if (answer.grade === AGAIN) forgotten.add(answer.cardId);
  }
  const reviewed = finalDue.size;
  const dues = [...finalDue.values()].sort();
  return {
    reviewed,
    forgotten: forgotten.size,
    answers: answers.length,
    accuracy: reviewed ? Math.round((1000 * (reviewed - forgotten.size)) / reviewed) / 10 : null,
    gradeCounts,
    nextDueAt: dues[0] ?? null,
  };
}

/** Keyboard shortcuts: 1-4 grade the flipped card (1 = again ... 4 = easy). */
export function gradeForKey(key: string): Grade | null {
  const value = Number(key) - 1;
  return /^[1-4]$/.test(key) && isGrade(value) ? value : null;
}

/** Whole seconds for the session log; at least one so a quick session still counts. */
export function durationSeconds(elapsedMs: number): number {
  return Math.max(1, Math.round(elapsedMs / 1000));
}

/** The minutes the API will log for this session (rounded half up, at least 1, at most 4 hours). */
export function sessionMinutes(elapsedMs: number): number {
  return Math.min(240, Math.max(1, Math.floor(durationSeconds(elapsedMs) / 60 + 0.5)));
}

export function formatElapsed(elapsedMs: number): string {
  const seconds = durationSeconds(elapsedMs);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
}
