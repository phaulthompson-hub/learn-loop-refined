// Client mirror of backend/app/services/scheduler.py (SM-2 with four grades). The review screen uses it
// to label the grade buttons and to requeue forgotten cards without another round trip; the API stays
// the source of truth for the stored schedule. Keep both files in sync (scheduler.test.ts pins the numbers).
import type { CardStatus, Grade, IntervalPreview } from './types';

export const AGAIN = 0;
export const HARD = 1;
export const GOOD = 2;
export const EASY = 3;
export const GRADES: readonly Grade[] = [AGAIN, HARD, GOOD, EASY];
export const GRADE_LABELS: Record<Grade, string> = { 0: 'again', 1: 'hard', 2: 'good', 3: 'easy' };

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
const EASE_CHANGE: Record<Grade, number> = { 0: -0.2, 1: -0.15, 2: 0, 3: 0.15 };
const FIRST_INTERVALS: Record<Exclude<Grade, 0>, number> = { 1: 1, 2: 1, 3: 4 };
const SECOND_INTERVALS: Record<Exclude<Grade, 0>, number> = { 1: 3, 2: 6, 3: 8 };
const HARD_FACTOR = 1.2;
const EASY_BONUS = 1.3;
export const MAX_INTERVAL_DAYS = 365;
export const RELEARN_MINUTES = 10;
export const MATURE_DAYS = 21;

export type Schedule = { ease: number; interval_days: number; repetitions: number; lapses: number };

export const NEW_SCHEDULE: Schedule = { ease: DEFAULT_EASE, interval_days: 0, repetitions: 0, lapses: 0 };

/** Same as the backend's `round_half_up` (and `Math.round`), applied at a number of decimals. */
export function roundHalfUp(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.floor(value * factor + 0.5) / factor;
}

export function isGrade(value: number): value is Grade {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function nextEase(ease: number, grade: Grade): number {
  return Math.max(MIN_EASE, roundHalfUp(ease + EASE_CHANGE[grade], 2));
}

/** Days until the next review after answering `grade` (0 means "again in a few minutes"). */
export function nextInterval(state: Schedule, grade: Grade): number {
  if (grade === AGAIN) return 0;
  let days: number;
  if (state.repetitions === 0) days = FIRST_INTERVALS[grade];
  else if (state.repetitions === 1) days = SECOND_INTERVALS[grade];
  else {
    const current = Math.max(state.interval_days, 1);
    const hard = Math.max(current + 1, roundHalfUp(current * HARD_FACTOR));
    const good = Math.max(hard + 1, roundHalfUp(current * state.ease));
    const easy = Math.max(good + 1, roundHalfUp(current * state.ease * EASY_BONUS));
    days = grade === HARD ? hard : grade === GOOD ? good : easy;
  }
  return Math.min(days, MAX_INTERVAL_DAYS);
}

export function nextSchedule(state: Schedule, grade: Grade): Schedule {
  const ease = nextEase(state.ease, grade);
  if (grade === AGAIN) {
    // Forgetting a learned card is a lapse; failing a brand-new card is not.
    return { ease, interval_days: 0, repetitions: 0, lapses: state.lapses + (state.repetitions > 0 ? 1 : 0) };
  }
  return { ease, interval_days: nextInterval(state, grade), repetitions: state.repetitions + 1, lapses: state.lapses };
}

/** Short label for a grade button: "10m", "1d", "6d", "1.5mo", "1y". */
export function formatInterval(days: number): string {
  if (days <= 0) return `${RELEARN_MINUTES}m`;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${roundHalfUp(days / 30, 1)}mo`;
  return `${roundHalfUp(days / 365, 1)}y`;
}

export function previewIntervals(state: Schedule): IntervalPreview[] {
  return GRADES.map((grade) => {
    const days = nextInterval(state, grade);
    return { grade, label: GRADE_LABELS[grade], interval_days: days, display: formatInterval(days) };
  });
}

export function cardStatus(state: Schedule | null): CardStatus {
  if (!state) return 'new';
  if (state.repetitions === 0 || state.interval_days < 1) return 'learning';
  return state.interval_days >= MATURE_DAYS ? 'mature' : 'young';
}

