import { describe, expect, it } from 'vitest';
import { parseDate } from '../../lib/dates';
import {
  emptyGoalForm,
  emptyStudyLog,
  goalAmount,
  goalFormToPayload,
  paceHint,
  studyLogToPayload,
  suggestedTitle,
  validateGoalForm,
  validateStudyLog,
  withKind,
  type GoalFormState,
  type StudyLogFormState,
} from './goalForm';
import type { Goal, GoalProgress } from './types';

const TODAY = parseDate('2022-03-14T09:00:00');
const COURSES = [{ id: 3, title: 'Statistics', color: '#2563eb' }];

const goalForm = (overrides: Partial<GoalFormState> = {}): GoalFormState => ({ ...emptyGoalForm(), title: 'Daily answers', ...overrides });

describe('goal kinds', () => {
  it('picks each kind’s natural period and a default target', () => {
    expect(emptyGoalForm('daily_answers')).toMatchObject({ period: 'day', target: '8' });
    expect(emptyGoalForm('weekly_reviews')).toMatchObject({ period: 'week', target: '40' });
    expect(emptyGoalForm('course_mastery')).toMatchObject({ period: 'once', target: '80' });
  });

  it('switching kind resets the period, target and a stray due date', () => {
    const mastery = { ...emptyGoalForm('course_mastery'), dueDate: '2022-04-04' };
    const minutes = withKind(mastery, 'study_minutes');
    expect(minutes).toMatchObject({ kind: 'study_minutes', period: 'day', target: '30', dueDate: '' });
    expect(withKind(minutes, 'study_minutes', 'week')).toMatchObject({ period: 'week', target: '180' });
    expect(withKind(minutes, 'study_minutes', 'once').period).toBe('day'); // not allowed for minutes
  });

  it('suggests readable titles', () => {
    expect(suggestedTitle(emptyGoalForm('daily_answers'), COURSES)).toBe('Answer 8 questions a day');
    expect(suggestedTitle(withKind(emptyGoalForm(), 'study_minutes', 'week'), COURSES)).toBe('3 hours of study a week');
    expect(suggestedTitle({ ...emptyGoalForm('study_minutes'), target: '45' }, COURSES)).toBe('45 minutes of study a day');
    expect(suggestedTitle({ ...emptyGoalForm('course_mastery'), courseId: '3' }, COURSES)).toBe('Reach 80% in Statistics');
  });
});

describe('validateGoalForm', () => {
  it('accepts a sensible goal', () => {
    expect(validateGoalForm(goalForm(), TODAY)).toEqual({});
  });

  it.each([
    [{ title: 'x' }, 'title'],
    [{ target: '' }, 'target'],
    [{ target: '0' }, 'target'],
    [{ target: '201' }, 'target'],
    [{ target: '2.5' }, 'target'],
    [{ kind: 'study_minutes', period: 'week', target: '10' }, 'target'],
  ] as [Partial<GoalFormState>, string][])('rejects %o on %s', (overrides, field) => {
    expect(Object.keys(validateGoalForm(goalForm(overrides), TODAY))).toEqual([field]);
  });

  it('requires a course and a future due date for mastery goals', () => {
    const mastery = { ...emptyGoalForm('course_mastery'), title: 'Stats', dueDate: '2022-03-13' };
    expect(validateGoalForm(mastery, TODAY)).toEqual({
      courseId: 'Choose the course this goal is for.',
      dueDate: 'The due date cannot be in the past.',
    });
    expect(validateGoalForm({ ...mastery, courseId: '3', dueDate: '2022-03-14', target: '72.5' }, TODAY)).toEqual({});
  });

  it('keeps an unchanged past due date valid when editing', () => {
    const mastery = { ...emptyGoalForm('course_mastery'), title: 'Stats', courseId: '3', dueDate: '2022-02-27' };
    expect(validateGoalForm(mastery, TODAY, '2022-02-27')).toEqual({});
  });

  it('builds the API payload', () => {
    expect(goalFormToPayload({ ...emptyGoalForm('course_mastery'), title: ' Stats ', courseId: '3', dueDate: '2022-04-04' })).toEqual({
      title: 'Stats',
      kind: 'course_mastery',
      period: 'once',
      target: 80,
      course_id: 3,
      due_date: '2022-04-04',
    });
    expect(goalFormToPayload(goalForm({ dueDate: '2022-04-04' })).due_date).toBeNull();
  });
});

describe('progress wording', () => {
  const progress = (overrides: Partial<GoalProgress>): GoalProgress => ({
    current: 5,
    target: 8,
    percent: 63,
    remaining: 3,
    expected: 3,
    status: 'on_track',
    unit: 'answers',
    period_label: 'Today',
    period_start: '2022-03-14T00:00:00',
    period_end: '2022-03-15T00:00:00',
    days_left: 0,
    ...overrides,
  });
  const goal = (kind: Goal['kind'], period: Goal['period'], overrides: Partial<GoalProgress>) => ({ kind, period, progress: progress(overrides) });

  it('formats amounts per kind', () => {
    expect(goalAmount({ kind: 'course_mastery' }, 57.6)).toBe('58%');
    expect(goalAmount({ kind: 'weekly_reviews' }, 1200)).toBe('1,200');
  });

  it('says what is left and by when', () => {
    expect(paceHint(goal('daily_answers', 'day', {}))).toBe('3 more answers today');
    expect(paceHint(goal('study_minutes', 'week', { remaining: 160, unit: 'minutes', days_left: 6 }))).toBe('160 more minutes in 7 days');
    expect(paceHint(goal('course_mastery', 'once', { remaining: 18.4, days_left: 21 }))).toBe('18% to go in 22 days');
    expect(paceHint(goal('course_mastery', 'once', { remaining: 18.4, days_left: null }))).toBe('18% to go');
  });

  it('celebrates or flags finished periods', () => {
    expect(paceHint(goal('daily_answers', 'day', { status: 'done' }))).toBe('Done for this period.');
    expect(paceHint(goal('course_mastery', 'once', { status: 'done' }))).toBe('Goal reached. Nice work!');
    expect(paceHint(goal('course_mastery', 'once', { status: 'overdue', remaining: 12 }))).toBe('The due date passed with 12% to go.');
  });
});

describe('study logs', () => {
  const log = (overrides: Partial<StudyLogFormState> = {}): StudyLogFormState => ({ ...emptyStudyLog(TODAY), ...overrides });

  it('defaults to now and 30 minutes', () => {
    expect(emptyStudyLog(TODAY)).toMatchObject({ minutes: '30', date: '2022-03-14', time: '09:00' });
    expect(validateStudyLog(log(), TODAY)).toEqual({});
  });

  it.each([
    [{ minutes: '0' }, 'minutes'],
    [{ minutes: '601' }, 'minutes'],
    [{ minutes: '12.5' }, 'minutes'],
    [{ time: '09:30' }, 'time'],
    [{ date: '2022-03-15', time: '08:00' }, 'time'],
    [{ date: '2021-11-29' }, 'date'],
    [{ date: '' }, 'date'],
    [{ note: 'x'.repeat(256) }, 'note'],
  ] as [Partial<StudyLogFormState>, string][])('rejects %o on %s', (overrides, field) => {
    expect(Object.keys(validateStudyLog(log(overrides), TODAY))).toEqual([field]);
  });

  it('caps a day at 24 hours including earlier logs', () => {
    expect(validateStudyLog(log({ minutes: '100' }), TODAY, 1400).minutes).toBe('That day already has 1400 minutes logged.');
    expect(validateStudyLog(log({ minutes: '40' }), TODAY, 1400)).toEqual({});
  });

  it('builds the API payload', () => {
    expect(studyLogToPayload(log({ minutes: '45', courseId: '3', note: ' Chapter 4 ', date: '2022-03-13', time: '18:30', activity: 'reading' }))).toEqual({
      minutes: 45,
      activity: 'reading',
      note: 'Chapter 4',
      course_id: 3,
      logged_at: '2022-03-13T18:30:00',
    });
  });
});
