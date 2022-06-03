import { describe, expect, it } from 'vitest';
import { previewIntervals } from './scheduler';
import {
  durationSeconds,
  formatElapsed,
  gradeForKey,
  sessionMinutes,
  sessionProgress,
  sessionReducer,
  startSession,
  summarize,
  type SessionState,
} from './session';
import type { Grade, ReviewCard, ReviewResult } from './types';

function card(id: number, overrides: Partial<ReviewCard> = {}): ReviewCard {
  const schedule = { ease: 2.5, interval_days: 6, repetitions: 2, lapses: 0 };
  return {
    id,
    deck_id: 1,
    deck_name: 'ML Essentials',
    course_id: 1,
    course_title: 'Intro to ML',
    course_color: '#1d6d45',
    front: `Question ${id}`,
    back: `Answer ${id}`,
    hint: '',
    concept_name: null,
    status: 'young',
    due_at: '2022-03-14T08:00:00',
    ...schedule,
    previews: previewIntervals(schedule),
    ...overrides,
  };
}

function result(cardId: number, grade: Grade, interval = grade === 0 ? 0 : 15): ReviewResult {
  return {
    card_id: cardId,
    grade,
    status: grade === 0 ? 'learning' : 'young',
    ease: grade === 0 ? 2.3 : 2.5,
    interval_before: 6,
    interval_days: interval,
    repetitions: grade === 0 ? 0 : 3,
    lapses: grade === 0 ? 1 : 0,
    due_at: grade === 0 ? '2022-03-14T09:10:00' : `2022-03-${String(14 + interval).padStart(2, '0')}T09:00:00`,
    display: grade === 0 ? '10m' : `${interval}d`,
  };
}

const answer = (state: SessionState, grade: Grade, elapsedMs = 1000) =>
  sessionReducer(sessionReducer(state, { type: 'flip' }), { type: 'answered', grade, result: result(state.queue[0].id, grade), elapsedMs });

describe('sessionReducer', () => {
  it('flips, grades and moves on to the next card', () => {
    let state = startSession([card(1), card(2)]);
    state = sessionReducer(state, { type: 'flip' });
    expect(state.flipped).toBe(true);
    state = sessionReducer(state, { type: 'answered', grade: 2, result: result(1, 2), elapsedMs: 4000 });
    expect(state.queue.map((c) => c.id)).toEqual([2]);
    expect(state.flipped).toBe(false);
    expect(state.answers).toEqual([{ cardId: 1, grade: 2, intervalDays: 15, dueAt: '2022-03-29T09:00:00' }]);
    expect(state.elapsedMs).toBe(4000);
    expect(state.phase).toBe('studying');
  });

  it('sends forgotten cards to the back of the queue as relearning cards', () => {
    let state = answer(startSession([card(1), card(2)]), 0);
    expect(state.queue.map((c) => c.id)).toEqual([2, 1]);
    const relearning = state.queue[1];
    expect(relearning.status).toBe('learning');
    expect(relearning.lapses).toBe(1);
    // The requeued card is labelled with the client scheduler: "good" now means one day.
    expect(relearning.previews.map((p) => p.display)).toEqual(['10m', '1d', '1d', '4d']);
    state = answer(state, 2);
    state = answer(state, 2);
    expect(state.phase).toBe('done');
    expect(state.answers.map((a) => a.cardId)).toEqual([1, 2, 1]);
  });

  it('ignores answers for a card that is not on screen', () => {
    const state = startSession([card(1), card(2)]);
    expect(sessionReducer(state, { type: 'answered', grade: 2, result: result(2, 2), elapsedMs: 10 })).toBe(state);
  });

  it('can be ended early and then ignores further actions', () => {
    const ended = sessionReducer(answer(startSession([card(1), card(2)]), 3), { type: 'end' });
    expect(ended.phase).toBe('done');
    expect(sessionReducer(ended, { type: 'flip' })).toBe(ended);
  });

  it('resets the hint for each card', () => {
    let state = sessionReducer(startSession([card(1), card(2)]), { type: 'hint' });
    expect(state.hintShown).toBe(true);
    state = answer(state, 2);
    expect(state.hintShown).toBe(false);
  });

  it('starts finished when there is nothing to study', () => {
    expect(startSession([]).phase).toBe('done');
  });
});

describe('sessionProgress', () => {
  it('counts answered cards against everything still queued', () => {
    const state = answer(startSession([card(1), card(2, { status: 'new' }), card(3)]), 0);
    expect(sessionProgress(state)).toEqual({ done: 1, total: 4, percent: 25, fresh: 1, relearning: 1, review: 1 });
  });
});

describe('summarize', () => {
  it('reports distinct cards, first-time recall and the earliest next review', () => {
    let state = startSession([card(1), card(2), card(3)]);
    state = answer(state, 0);
    state = answer(state, 3);
    state = answer(state, 1);
    state = answer(state, 2);
    const summary = summarize(state.answers);
    expect(summary).toMatchObject({ reviewed: 3, forgotten: 1, answers: 4, accuracy: 66.7 });
    expect(summary.gradeCounts).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
    expect(summary.nextDueAt).toBe('2022-03-29T09:00:00');
  });

  it('has no accuracy before any answer', () => {
    expect(summarize([])).toMatchObject({ reviewed: 0, accuracy: null, nextDueAt: null });
  });
});

describe('keyboard and time helpers', () => {
  it.each([
    ['1', 0],
    ['2', 1],
    ['3', 2],
    ['4', 3],
    ['0', null],
    ['5', null],
    ['12', null],
    [' ', null],
  ])('maps key %j to grade %s', (key, grade) => {
    expect(gradeForKey(key)).toBe(grade);
  });

  it('rounds durations like the API logs them', () => {
    expect(durationSeconds(200)).toBe(1);
    expect(durationSeconds(89_600)).toBe(90);
    expect(sessionMinutes(89_000)).toBe(1);
    expect(sessionMinutes(90_000)).toBe(2);
    expect(sessionMinutes(10 * 60 * 60 * 1000)).toBe(240);
    expect(formatElapsed(42_000)).toBe('42 s');
    expect(formatElapsed(185_000)).toBe('3 min 05 s');
  });
});
