import { describe, expect, it } from 'vitest';
import {
  analyticsSearch,
  axisLabel,
  courseAverage,
  filterConcepts,
  formatKpi,
  masteryHeatClass,
  parseAnalyticsSearch,
  rangeCaption,
  sortLearners,
} from './analyticsLogic';
import type { ConceptRow, LearnerRow } from './types';

const params = (text: string) => new URLSearchParams(text);

describe('URL state', () => {
  it('reads valid values', () => {
    expect(parseAnalyticsSearch(params('days=7&course=3&tab=learners'))).toEqual({ days: 7, courseId: 3, tab: 'learners' });
  });

  it('falls back to defaults for anything invalid', () => {
    expect(parseAnalyticsSearch(params('days=14&course=abc&tab=admin'))).toEqual({ days: 30, courseId: null, tab: 'overview' });
    expect(parseAnalyticsSearch(params('course=-2'))).toMatchObject({ courseId: null });
    expect(parseAnalyticsSearch(params('course=1.5'))).toMatchObject({ courseId: null });
  });

  it('omits defaults when serialising and round-trips', () => {
    expect(analyticsSearch({ days: 30, courseId: null, tab: 'overview' })).toBe('');
    const text = analyticsSearch({ days: 90, courseId: 4, tab: 'learners' });
    expect(text).toBe('?days=90&course=4&tab=learners');
    expect(parseAnalyticsSearch(params(text.slice(1)))).toEqual({ days: 90, courseId: 4, tab: 'learners' });
  });
});

describe('formatting', () => {
  it('formats KPIs by kind', () => {
    expect(formatKpi('minutes', 95)).toBe('1 h 35 min');
    expect(formatKpi('accuracy', 72.94)).toBe('72.9%');
    expect(formatKpi('answers', 1204)).toBe('1,204');
  });

  it('labels axes with weekdays for a week and dates otherwise', () => {
    expect(axisLabel('2022-03-14', 7)).toBe('Mon');
    expect(axisLabel('2022-03-14', 30)).toBe('14 Mar');
  });

  it('captions the range', () => {
    expect(rangeCaption({ start: '2022-02-13', end: '2022-03-14', days: 30 })).toBe('13 Feb – 14 Mar, compared with the 30 days before');
  });

  it('maps mastery to heat classes', () => {
    expect(masteryHeatClass(null)).toBe('mh-none');
    expect(masteryHeatClass(20)).toBe('mh-needs-review');
    expect(masteryHeatClass(50)).toBe('mh-learning');
    expect(masteryHeatClass(60)).toBe('mh-proficient');
    expect(masteryHeatClass(85)).toBe('mh-mastered');
  });
});

const concept = (name: string, course: string, level: string): ConceptRow => ({
  id: name.length,
  name,
  course: { id: 1, title: course, color: '#000' },
  attempts: 0,
  correct: 0,
  accuracy: 0,
  mastery: 50,
  level,
  unlocked: true,
  last_practiced: null,
});

describe('filterConcepts', () => {
  const rows = [concept('Gradient Descent', 'Machine Learning', 'learning'), concept('Joins', 'SQL', 'mastered'), concept('Median', 'Statistics', 'learning')];

  it('matches every word against the concept and course names', () => {
    expect(filterConcepts(rows, 'machine gradient', 'all').map((r) => r.name)).toEqual(['Gradient Descent']);
    expect(filterConcepts(rows, 'SQL', 'all').map((r) => r.name)).toEqual(['Joins']);
  });

  it('filters by level', () => {
    expect(filterConcepts(rows, '', 'learning')).toHaveLength(2);
    expect(filterConcepts(rows, 'joins', 'learning')).toEqual([]);
  });
});

const learner = (name: string, average: number | null, answers: number, cells: [number, number | null][] = []): LearnerRow => ({
  user_id: name.length,
  name,
  avatar_color: '#000',
  role: 'learner',
  answers,
  accuracy: 0,
  last_active: null,
  average_mastery: average,
  cells: cells.map(([course_id, mastery]) => ({ course_id, mastery, enrolled: mastery !== null, mastered_concepts: 0 })),
});

describe('learners', () => {
  const rows = [learner('Sam', 59, 20), learner('Priya', null, 3), learner('Alex', 72, 48), learner('Jonas', 59, 9)];

  it('sorts by mastery with ties broken by name and unstarted learners last', () => {
    expect(sortLearners(rows, 'mastery').map((r) => r.name)).toEqual(['Alex', 'Jonas', 'Sam', 'Priya']);
  });

  it('sorts by activity and by name', () => {
    expect(sortLearners(rows, 'answers').map((r) => r.name)).toEqual(['Alex', 'Sam', 'Jonas', 'Priya']);
    expect(sortLearners(rows, 'name').map((r) => r.name)).toEqual(['Alex', 'Jonas', 'Priya', 'Sam']);
  });

  it('averages a course column over learners who started it', () => {
    const table = [learner('A', 1, 0, [[1, 50], [2, null]]), learner('B', 1, 0, [[1, 65], [2, null]])];
    expect(courseAverage(table, 1)).toBe(57.5);
    expect(courseAverage(table, 2)).toBeNull();
  });
});
