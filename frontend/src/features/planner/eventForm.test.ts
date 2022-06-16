import { describe, expect, it } from 'vitest';
import { parseDate } from '../../lib/dates';
import { durationMinutes, emptyEventForm, formFromEvent, formToPayload, minutesFromTime, validateEventForm, type EventFormState } from './eventForm';
import type { PlannerEvent } from './types';

const base = (overrides: Partial<EventFormState> = {}): EventFormState => ({
  ...emptyEventForm(parseDate('2022-03-17'), 10 * 60),
  title: 'Focus block',
  ...overrides,
});
const learner = { canAnnounce: false };

describe('emptyEventForm', () => {
  it('starts a one-hour block at the chosen slot', () => {
    const form = emptyEventForm(parseDate('2022-03-16'), 15 * 60 + 30);
    expect([form.date, form.startTime, form.endTime, form.allDay]).toEqual(['2022-03-16', '15:30', '16:30', false]);
  });

  it('never runs past midnight', () => {
    expect(emptyEventForm(parseDate('2022-03-16'), 23 * 60 + 30).endTime).toBe('23:59');
  });
});

describe('validateEventForm', () => {
  it('accepts a valid timed event', () => {
    expect(validateEventForm(base(), learner)).toEqual({});
  });

  it.each([
    [{ title: ' a ' }, 'title'],
    [{ title: 'x'.repeat(161) }, 'title'],
    [{ endTime: '09:00' }, 'endTime'],
    [{ endTime: '10:00' }, 'endTime'],
    [{ startTime: '07:00', endTime: '19:30' }, 'endTime'],
    [{ endTime: '' }, 'endTime'],
    [{ allDay: true, endDate: '2022-03-16' }, 'endDate'],
    [{ allDay: true, endDate: '2022-03-31' }, 'endDate'],
    [{ allDay: true, endDate: '2022-03-18', recurrence: 'weekly' }, 'recurrence'],
    [{ date: '2022-03-19', recurrence: 'weekdays' }, 'recurrence'],
    [{ recurrence: 'daily', until: '2022-03-16' }, 'until'],
    [{ recurrence: 'weekly', until: '2023-03-30' }, 'until'],
    [{ location: 'x'.repeat(161) }, 'location'],
    [{ notes: 'x'.repeat(2001) }, 'notes'],
    [{ kind: 'live', shared: true }, 'shared'],
  ] as [Partial<EventFormState>, string][])('rejects %o on %s', (overrides, field) => {
    expect(Object.keys(validateEventForm(base(overrides), learner))).toEqual([field]);
  });

  it('lets instructors share exams and learners share study sessions', () => {
    expect(validateEventForm(base({ kind: 'exam', shared: true }), { canAnnounce: true })).toEqual({});
    expect(validateEventForm(base({ kind: 'study', shared: true }), learner)).toEqual({});
  });

  it('allows a 12-hour block and a 14-day all-day span exactly', () => {
    expect(validateEventForm(base({ startTime: '07:00', endTime: '19:00' }), learner)).toEqual({});
    expect(validateEventForm(base({ allDay: true, endDate: '2022-03-30' }), learner)).toEqual({});
  });

  it('ignores the until date when the event does not repeat', () => {
    expect(validateEventForm(base({ recurrence: 'none', until: '2020-01-01' }), learner)).toEqual({});
  });
});

describe('payload mapping', () => {
  it('sends timed events as naive UTC datetimes', () => {
    const payload = formToPayload(base({ title: '  Focus block  ', courseId: '4', location: ' Desk ' }));
    expect(payload).toMatchObject({
      title: 'Focus block',
      course_id: 4,
      starts_at: '2022-03-17T10:00:00',
      ends_at: '2022-03-17T11:00:00',
      location: 'Desk',
      recurrence_until: null,
    });
  });

  it('sends all-day events with an exclusive end at the next midnight', () => {
    const payload = formToPayload(base({ allDay: true, endDate: '2022-03-18' }));
    expect([payload.starts_at, payload.ends_at, payload.all_day]).toEqual(['2022-03-17T00:00:00', '2022-03-19T00:00:00', true]);
  });

  it('keeps the until date only for repeating events', () => {
    expect(formToPayload(base({ recurrence: 'weekly', until: '2022-04-28' })).recurrence_until).toBe('2022-04-28');
    expect(formToPayload(base({ recurrence: 'none', until: '2022-04-28' })).recurrence_until).toBeNull();
  });

  it('round-trips a stored all-day event without growing it', () => {
    const event = {
      title: 'Quiz closes',
      kind: 'deadline',
      course: { id: 2, title: 'Statistics', color: '#2563eb' },
      starts_at: '2022-03-18T00:00:00',
      ends_at: '2022-03-19T00:00:00',
      all_day: true,
      location: '',
      notes: '',
      recurrence: 'none',
      recurrence_until: null,
      shared: true,
    } as PlannerEvent;
    const form = formFromEvent(event);
    expect([form.date, form.endDate, form.courseId]).toEqual(['2022-03-18', '2022-03-18', '2']);
    const payload = formToPayload(form);
    expect([payload.starts_at, payload.ends_at]).toEqual([event.starts_at, event.ends_at]);
  });

  it('reads times defensively', () => {
    expect(minutesFromTime('07:45')).toBe(465);
    expect(minutesFromTime('24:00')).toBeNull();
    expect(minutesFromTime('7:45')).toBeNull();
    expect(durationMinutes({ startTime: '15:00', endTime: '16:30' })).toBe(90);
  });
});
