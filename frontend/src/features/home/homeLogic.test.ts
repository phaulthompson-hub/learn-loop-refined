import { describe, expect, it } from 'vitest';
import {
  agendaTime,
  daySummary,
  deltaInfo,
  dueBadge,
  goalProgressText,
  goalStatus,
  greetingTitle,
  needsOnboarding,
  nowMarkerIndex,
  onboardingSteps,
  streakCopy,
  weekdayInitial,
} from './homeLogic';
import type { AgendaItem, Home, Onboarding } from './types';

const comparison = (value: number, previous: number, percent: number | null = null) => ({
  value,
  previous,
  change: value - previous,
  percent,
});

const agendaItem = (status: AgendaItem['status'], all_day = false) => ({ status, all_day });

describe('greeting', () => {
  it('uses the part of day and first name', () => {
    expect(greetingTitle('morning', 'Alex')).toBe('Good morning, Alex');
    expect(greetingTitle('evening', 'Sam')).toBe('Good evening, Sam');
    expect(greetingTitle('night', 'Maya')).toBe('Burning the midnight oil, Maya?');
  });

  it('summarises the day', () => {
    const home = {
      agenda: [
        { ...agendaItem('past') },
        { ...agendaItem('upcoming') },
        { ...agendaItem('now') },
      ] as AgendaItem[],
      flashcards: { due: 16, new: 3, total: 40 },
      tasks: { items: [{ due_in_days: 0 }, { due_in_days: 3 }], total_open: 2, overdue: 0 } as Home['tasks'],
    };
    expect(daySummary(home)).toBe('2 sessions still ahead today · 16 cards due · 1 task due today');
  });

  it('prefers overdue tasks over tasks due today and handles a clear day', () => {
    const tasks = { items: [{ due_in_days: 0 }], total_open: 3, overdue: 2 } as Home['tasks'];
    expect(daySummary({ agenda: [], flashcards: { due: 0, new: 0, total: 0 }, tasks })).toBe('2 tasks overdue');
    const empty = { items: [], total_open: 0, overdue: 0 };
    expect(daySummary({ agenda: [], flashcards: { due: 0, new: 0, total: 0 }, tasks: empty })).toMatch(/clear day/);
    expect(daySummary({ agenda: [agendaItem('past')] as AgendaItem[], flashcards: { due: 0, new: 0, total: 0 }, tasks: empty })).toBe(
      'Today’s sessions are done',
    );
  });

  it('writes streak copy for each situation', () => {
    expect(streakCopy({ current: 0, longest: 4, active_today: false, active_days_last_30: 0 })).toMatch(/start a streak/);
    expect(streakCopy({ current: 5, longest: 9, active_today: false, active_days_last_30: 5 })).toBe('Study today to keep your 5-day streak alive.');
    expect(streakCopy({ current: 9, longest: 9, active_today: true, active_days_last_30: 9 })).toMatch(/longest streak yet/);
    expect(streakCopy({ current: 3, longest: 9, active_today: true, active_days_last_30: 9 })).toBe('Best so far: 9 days.');
  });
});

describe('deltaInfo', () => {
  it('describes a rise as good by default', () => {
    const info = deltaInfo(comparison(23, 13, 76.9));
    expect(info).toMatchObject({ text: '+10', tone: 'up', good: true });
    expect(info.title).toBe('Up from 13 last week (+77%)');
  });

  it('marks falls as bad unless lower is better, and adds units', () => {
    expect(deltaInfo(comparison(69.6, 84.6), { unit: 'pts' })).toMatchObject({ text: '−15 pts', tone: 'down', good: false });
    expect(deltaInfo(comparison(2, 5), { higherIsBetter: false })).toMatchObject({ tone: 'down', good: true });
  });

  it('treats zero change as flat and omits the percentage when there was no baseline', () => {
    expect(deltaInfo(comparison(4, 4))).toEqual({ text: '±0', tone: 'flat', good: null, title: 'Same as last week' });
    expect(deltaInfo(comparison(4, 0), { period: 'the previous 30 days' }).title).toBe('Up from 0 the previous 30 days');
  });
});

describe('dueBadge', () => {
  it.each([
    [{ due_date: null, due_in_days: null }, 'No due date', 'muted'],
    [{ due_date: '2022-03-12', due_in_days: -2 }, '2 days overdue', 'bad'],
    [{ due_date: '2022-03-13', due_in_days: -1 }, '1 day overdue', 'bad'],
    [{ due_date: '2022-03-14', due_in_days: 0 }, 'Due today', 'warn'],
    [{ due_date: '2022-03-15', due_in_days: 1 }, 'Tomorrow', 'info'],
    [{ due_date: '2022-03-18', due_in_days: 4 }, 'In 4 days', 'info'],
    [{ due_date: '2022-03-31', due_in_days: 17 }, '31 Mar', 'muted'],
  ])('%j → %s', (task, text, tone) => {
    expect(dueBadge(task)).toEqual({ text, tone });
  });
});

describe('agenda', () => {
  it('formats times and all-day events', () => {
    expect(agendaTime({ all_day: false, starts_at: '2022-03-14T07:30:00', ends_at: '2022-03-14T08:00:00' })).toBe('07:30–08:00');
    expect(agendaTime({ all_day: true, starts_at: '2022-03-14T00:00:00', ends_at: '2022-03-15T00:00:00' })).toBe('All day');
  });

  it('places the now marker before the first unfinished timed event', () => {
    expect(nowMarkerIndex([agendaItem('upcoming', true), agendaItem('past'), agendaItem('now'), agendaItem('upcoming')])).toBe(2);
    expect(nowMarkerIndex([agendaItem('past'), agendaItem('past')])).toBe(2);
    expect(nowMarkerIndex([agendaItem('upcoming')])).toBe(0);
    expect(nowMarkerIndex([])).toBe(0);
  });
});

describe('goals', () => {
  it('maps statuses to labels and tones', () => {
    expect(goalStatus('at_risk')).toEqual({ label: 'Behind pace', tone: 'warn' });
    expect(goalStatus('done').tone).toBe('ok');
    expect(goalStatus('paused')).toEqual({ label: 'paused', tone: 'muted' });
  });

  it('formats progress by goal kind', () => {
    expect(goalProgressText({ kind: 'study_minutes', current: 45, target: 180, unit: 'minutes' })).toBe('45 min of 3 h');
    expect(goalProgressText({ kind: 'course_mastery', current: 61.7, target: 80, unit: '%' })).toBe('62% of 80%');
    expect(goalProgressText({ kind: 'weekly_reviews', current: 12, target: 40, unit: 'reviews' })).toBe('12 of 40 reviews');
  });
});

describe('onboarding', () => {
  const empty: Onboarding = { courses: 0, enrolled: 0, decks: 0, events: 0, goals: 0, can_create_courses: true };

  it('sends course creators to the new-course form in an empty workspace', () => {
    const [course, deck, plan] = onboardingSteps(empty);
    expect(course).toMatchObject({ title: 'Create or join a course', to: '/courses/new', done: false });
    expect(deck).toMatchObject({ to: '/decks', done: false });
    expect(plan).toMatchObject({ to: '/planner', done: false });
  });

  it('sends learners to the catalogue', () => {
    const [course] = onboardingSteps({ ...empty, courses: 3, can_create_courses: false });
    expect(course).toMatchObject({ title: 'Join a course', to: '/courses', cta: 'Browse courses' });
  });

  it('is shown until every step is done', () => {
    expect(needsOnboarding(empty)).toBe(true);
    expect(needsOnboarding({ ...empty, enrolled: 1, decks: 2 })).toBe(true);
    expect(needsOnboarding({ ...empty, enrolled: 1, decks: 2, events: 1 })).toBe(false);
  });
});

describe('weekdayInitial', () => {
  it('uses UTC weekdays', () => {
    expect(weekdayInitial('2022-03-14')).toBe('M');
    expect(weekdayInitial('2022-03-13')).toBe('S');
    expect(weekdayInitial('2022-03-17')).toBe('T');
  });
});
