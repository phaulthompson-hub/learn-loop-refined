import { describe, expect, it } from 'vitest';
import { dayKey, parseDate } from '../../lib/dates';
import {
  coversDay,
  describeRecurrence,
  layoutDay,
  minutesAtOffset,
  monthMatrix,
  occurrencesByDay,
  rangeTitle,
  recurrencePreview,
  shiftAnchor,
  timeLabel,
  viewRange,
  weekDays,
  weekdayLabels,
  type TimedBlock,
} from './calendar';
import type { Occurrence, PlannerEvent } from './types';

const MONDAY = parseDate('2022-03-14');
const keys = (dates: Date[]) => dates.map(dayKey);

function occurrence(key: string, start: string, end: string, overrides: Partial<PlannerEvent> = {}): Occurrence {
  const event: PlannerEvent = {
    id: Number(key.split(':')[0]),
    workspace_id: 1,
    title: key,
    kind: 'study',
    course: null,
    owner: { id: 1, name: 'Alex Rivera', avatar_color: '#1d6d45' },
    starts_at: start,
    ends_at: end,
    all_day: false,
    location: '',
    notes: '',
    recurrence: 'none',
    recurrence_until: null,
    shared: false,
    created_at: start,
    can_edit: true,
    ...overrides,
  };
  return { key, index: 0, starts_at: start, ends_at: end, event };
}

const block = (key: string, from: string, to: string): TimedBlock => ({
  key,
  start: parseDate(`2022-03-16T${from}:00`),
  end: parseDate(`2022-03-16T${to}:00`),
});

describe('grids and ranges', () => {
  it('builds a six-week month matrix starting on the preferred weekday', () => {
    const matrix = monthMatrix(MONDAY, 0);
    expect(matrix).toHaveLength(6);
    expect(matrix.every((row) => row.length === 7)).toBe(true);
    expect(dayKey(matrix[0][0])).toBe('2022-02-28'); // the Monday before 1 March (a Tuesday)
    expect(dayKey(matrix[5][6])).toBe('2022-04-10');
    expect(dayKey(monthMatrix(MONDAY, 6)[0][0])).toBe('2022-02-27'); // Sunday start: the Sunday before 1 March
    expect(dayKey(monthMatrix(parseDate('2022-05-14'), 6)[0][0])).toBe('2022-05-01'); // Sunday start: 1 May (a Sunday) itself
  });

  it('lists the days of the week around the anchor', () => {
    expect(keys(weekDays(parseDate('2022-03-17'), 0))).toEqual([
      '2022-03-14',
      '2022-03-15',
      '2022-03-16',
      '2022-03-17',
      '2022-03-18',
      '2022-03-19',
      '2022-03-20',
    ]);
    expect(dayKey(weekDays(parseDate('2022-03-17'), 6)[0])).toBe('2022-03-13');
  });

  it('orders weekday headers from the week start', () => {
    expect(weekdayLabels(0)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(6)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('asks the API for exactly the visible window', () => {
    const month = viewRange('month', MONDAY, 0);
    expect([dayKey(month.start), dayKey(month.end)]).toEqual(['2022-02-28', '2022-04-11']);
    const week = viewRange('week', parseDate('2022-03-17T15:00:00'), 0);
    expect([dayKey(week.start), dayKey(week.end)]).toEqual(['2022-03-14', '2022-03-21']);
    const agenda = viewRange('agenda', parseDate('2022-03-14T09:00:00'), 0);
    expect([dayKey(agenda.start), dayKey(agenda.end)]).toEqual(['2022-03-14', '2022-03-28']);
  });

  it('pages by month, week or fortnight', () => {
    expect(dayKey(shiftAnchor('month', parseDate('2022-01-31'), 1))).toBe('2022-02-01');
    expect(dayKey(shiftAnchor('month', MONDAY, -3))).toBe('2021-12-01');
    expect(dayKey(shiftAnchor('week', MONDAY, -1))).toBe('2022-03-07');
    expect(dayKey(shiftAnchor('agenda', MONDAY, 1))).toBe('2022-03-28');
  });

  it('titles each view', () => {
    expect(rangeTitle('month', MONDAY, 0)).toBe('March 2022');
    expect(rangeTitle('week', MONDAY, 0)).toBe('14 – 20 Mar 2022');
    expect(rangeTitle('week', parseDate('2022-03-31'), 0)).toBe('28 Mar – 3 Apr 2022');
    expect(rangeTitle('week', parseDate('2021-12-31'), 0)).toBe('27 Dec 2021 – 2 Jan 2022');
  });
});

describe('grouping occurrences by day', () => {
  it('treats ranges as half-open and counts zero-length items on their start day', () => {
    const day = parseDate('2022-03-16');
    expect(coversDay(parseDate('2022-03-15T23:00:00'), parseDate('2022-03-16T00:00:00'), day)).toBe(false);
    expect(coversDay(parseDate('2022-03-15T23:00:00'), parseDate('2022-03-16T00:30:00'), day)).toBe(true);
    expect(coversDay(parseDate('2022-03-16T12:00:00'), parseDate('2022-03-16T12:00:00'), day)).toBe(true);
  });

  it('repeats multi-day items and sorts all-day items first', () => {
    const days = weekDays(MONDAY, 0);
    const items = [
      occurrence('1:0', '2022-03-16T15:00:00', '2022-03-16T16:30:00'),
      occurrence('2:0', '2022-03-16T07:30:00', '2022-03-16T08:00:00'),
      occurrence('3:0', '2022-03-16T00:00:00', '2022-03-18T00:00:00', { all_day: true }),
    ];
    const byDay = occurrencesByDay(items, days);
    expect(byDay.get('2022-03-16')!.map((o) => o.key)).toEqual(['3:0', '2:0', '1:0']);
    expect(byDay.get('2022-03-17')!.map((o) => o.key)).toEqual(['3:0']);
    expect(byDay.get('2022-03-18')).toEqual([]);
    expect(byDay.size).toBe(7);
  });
});

