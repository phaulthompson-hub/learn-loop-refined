import { describe, expect, it } from 'vitest';
import {
  AGAIN,
  EASY,
  GOOD,
  GRADES,
  HARD,
  MIN_EASE,
  NEW_SCHEDULE,
  cardStatus,
  formatInterval,
  nextEase,
  nextInterval,
  nextSchedule,
  previewIntervals,
  roundHalfUp,
  type Schedule,
} from './scheduler';
import type { Grade } from './types';

const learned = (interval_days: number, ease = 2.5, repetitions = 3, lapses = 0): Schedule => ({ ease, interval_days, repetitions, lapses });

const answerAll = (grades: Grade[], state: Schedule = NEW_SCHEDULE) => grades.reduce(nextSchedule, state);

// Produced by backend/app/services/scheduler.py: [ease, interval, repetitions, intervals for grades 0-3].
// If the backend rules change, regenerate this table; the two implementations must agree exactly.
const BACKEND_INTERVALS: [number, number, number, number[]][] = [
  [2.5, 0, 0, [0, 1, 1, 4]],
  [2.5, 1, 1, [0, 3, 6, 8]],
  [1.3, 1, 2, [0, 2, 3, 4]],
  [1.3, 12, 4, [0, 14, 16, 20]],
  [1.3, 300, 8, [0, 360, 365, 365]],
  [1.55, 5, 3, [0, 6, 8, 10]],
  [1.55, 37, 5, [0, 44, 57, 75]],
  [1.55, 150, 6, [0, 180, 233, 302]],
  [2.15, 3, 2, [0, 4, 6, 8]],
  [2.15, 5, 3, [0, 6, 11, 14]],
  [2.15, 37, 5, [0, 44, 80, 103]],
  [2.15, 150, 6, [0, 180, 323, 365]],
  [2.5, 5, 3, [0, 6, 13, 16]],
  [2.5, 37, 5, [0, 44, 93, 120]],
  [2.85, 3, 2, [0, 4, 9, 11]],
  [2.85, 12, 4, [0, 14, 34, 44]],
  [2.85, 37, 5, [0, 44, 105, 137]],
];

const BACKEND_EASES: [number, number[]][] = [
  [1.3, [1.3, 1.3, 1.3, 1.45]],
  [1.55, [1.35, 1.4, 1.55, 1.7]],
  [2.15, [1.95, 2.0, 2.15, 2.3]],
  [2.5, [2.3, 2.35, 2.5, 2.65]],
  [2.85, [2.65, 2.7, 2.85, 3.0]],
];

describe('parity with the backend scheduler', () => {
  it.each(BACKEND_INTERVALS)('ease %s, interval %s, repetitions %s', (ease, interval, repetitions, expected) => {
    const state = learned(interval, ease, repetitions, 1);
    expect(GRADES.map((grade) => nextSchedule(state, grade).interval_days)).toEqual(expected);
  });

  it.each(BACKEND_EASES)('ease %s moves to %j', (ease, expected) => {
    expect(GRADES.map((grade) => nextEase(ease, grade))).toEqual(expected);
  });

  it.each([
    [0, '10m'],
    [1, '1d'],
    [29, '29d'],
    [30, '1mo'],
    [44, '1.5mo'],
    [59, '2mo'],
    [100, '3.3mo'],
    [364, '12.1mo'],
    [365, '1y'],
    [400, '1.1y'],
    [547, '1.5y'],
    [730, '2y'],
  ])('formats %s days as %s', (days, label) => {
    expect(formatInterval(days)).toBe(label);
  });
});

describe('ease', () => {
  it('never drops below the minimum', () => {
    expect(answerAll(Array(12).fill(AGAIN)).ease).toBe(MIN_EASE);
    expect(nextEase(1.35, HARD)).toBe(MIN_EASE);
  });

  it('rounds to two decimals like the API', () => {
    expect(nextEase(2.15, EASY)).toBe(2.3);
    expect(answerAll([EASY, EASY, EASY]).ease).toBe(2.95);
  });
});

describe('intervals', () => {
  it('follows 1 day, 6 days, then multiplies by ease', () => {
    const intervals: number[] = [];
    let state = NEW_SCHEDULE;
    for (let i = 0; i < 5; i += 1) {
      state = nextSchedule(state, GOOD);
      intervals.push(state.interval_days);
    }
    expect(intervals).toEqual([1, 6, 15, 38, 95]);
  });

  it('rounds halves up, unlike banker’s rounding', () => {
    expect(nextInterval(learned(5), GOOD)).toBe(13);
    expect(roundHalfUp(0.125, 2)).toBe(0.13);
  });

  it('keeps every better grade at least a day further out', () => {
    for (const ease of [1.3, 1.9, 2.5, 3.1]) {
      for (const interval of [1, 2, 4, 9, 30, 90]) {
        const state = learned(interval, ease);
        const [hard, good, easy] = ([HARD, GOOD, EASY] as const).map((g) => nextInterval(state, g));
        expect(hard).toBeGreaterThan(interval);
        expect(good).toBeGreaterThan(hard);
        if (easy < 365) expect(easy).toBeGreaterThan(good);
      }
    }
  });
});

describe('lapses', () => {
  it('counts forgetting a learned card and restarts the ladder', () => {
    const lapsed = nextSchedule(learned(15, 2.5, 4, 1), AGAIN);
    expect(lapsed).toEqual({ ease: 2.3, interval_days: 0, repetitions: 0, lapses: 2 });
    expect(nextSchedule(lapsed, GOOD).interval_days).toBe(1);
  });

  it('does not count failing a brand-new card', () => {
    expect(nextSchedule(NEW_SCHEDULE, AGAIN).lapses).toBe(0);
  });
});

describe('previews and status', () => {
  it('labels all four buttons with what answering would schedule', () => {
    const state = answerAll([GOOD, HARD, EASY]);
    const previews = previewIntervals(state);
    expect(previews.map((p) => p.label)).toEqual(['again', 'hard', 'good', 'easy']);
    previews.forEach((p) => expect(nextSchedule(state, p.grade).interval_days).toBe(p.interval_days));
    expect(previewIntervals(learned(10)).map((p) => p.display)).toEqual(['10m', '12d', '25d', '1.1mo']);
  });

  it.each([
    [null, 'new'],
    [nextSchedule(NEW_SCHEDULE, AGAIN), 'learning'],
    [learned(20), 'young'],
    [learned(21), 'mature'],
  ] as const)('classifies %j as %s', (state, status) => {
    expect(cardStatus(state)).toBe(status);
  });
});
