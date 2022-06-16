// Event form state, client validation (mirrors backend/app/schemas/planner.py) and payload mapping.
import { addDays, dayKey, parseDate, weekday } from '../../lib/dates';
import { formatTime } from '../../lib/format';
import type { EventInput, EventKind, PlannerEvent, Recurrence } from './types';

export const TITLE_MIN = 2;
export const TITLE_MAX = 160;
export const LOCATION_MAX = 160;
export const NOTES_MAX = 2000;
export const MAX_TIMED_MINUTES = 12 * 60;
export const MAX_ALL_DAY_DAYS = 14;
export const MAX_SERIES_DAYS = 366;
/** Kinds that notify the whole workspace when shared, so sharing them needs the instructor role. */
export const ANNOUNCED_KINDS: EventKind[] = ['exam', 'live'];

export type EventFormState = {
  title: string;
  kind: EventKind;
  courseId: string;
  date: string; // YYYY-MM-DD, first day
  endDate: string; // YYYY-MM-DD, last day (all-day events only)
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  allDay: boolean;
  recurrence: Recurrence;
  until: string; // YYYY-MM-DD or ''
  location: string;
  notes: string;
  shared: boolean;
};

export type EventFormErrors = Partial<Record<'title' | 'endTime' | 'endDate' | 'until' | 'recurrence' | 'location' | 'notes' | 'shared', string>>;

const pad = (value: number) => String(value).padStart(2, '0');
export const timeFromMinutes = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

export function minutesFromTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** A blank form for `day`, starting at `startMinutes` (default 18:00) and lasting an hour. */
export function emptyEventForm(day: Date, startMinutes = 18 * 60, allDay = false): EventFormState {
  const start = Math.min(startMinutes, 23 * 60);
  return {
    title: '',
    kind: 'study',
    courseId: '',
    date: dayKey(day),
    endDate: dayKey(day),
    startTime: timeFromMinutes(start),
    endTime: timeFromMinutes(Math.min(start + 60, 24 * 60 - 1)),
    allDay,
    recurrence: 'none',
    until: '',
    location: '',
    notes: '',
    shared: false,
  };
}

export function formFromEvent(event: PlannerEvent): EventFormState {
  const start = parseDate(event.starts_at);
  const end = parseDate(event.ends_at);
  return {
    title: event.title,
    kind: event.kind,
    courseId: event.course ? String(event.course.id) : '',
    date: dayKey(start),
    endDate: dayKey(event.all_day ? addDays(end, -1) : end),
    startTime: formatTime(start),
    endTime: formatTime(end),
    allDay: event.all_day,
    recurrence: event.recurrence,
    until: event.recurrence_until ?? '',
    location: event.location,
    notes: event.notes,
    shared: event.shared,
  };
}

/** Length of a timed event in minutes, or null when a time is missing or malformed. */
export function durationMinutes(form: Pick<EventFormState, 'startTime' | 'endTime'>): number | null {
  const start = minutesFromTime(form.startTime);
  const end = minutesFromTime(form.endTime);
  return start === null || end === null ? null : end - start;
}

export function allDaySpan(form: Pick<EventFormState, 'date' | 'endDate'>): number {
  return Math.round((parseDate(form.endDate).getTime() - parseDate(form.date).getTime()) / 86_400_000) + 1;
}

export function validateEventForm(form: EventFormState, { canAnnounce }: { canAnnounce: boolean }): EventFormErrors {
  const errors: EventFormErrors = {};
  const title = form.title.trim().length;
  if (title < TITLE_MIN) errors.title = `Give the event a title of at least ${TITLE_MIN} characters.`;
  else if (title > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters.`;

  if (form.allDay) {
    const span = allDaySpan(form);
    if (!form.endDate || span < 1) errors.endDate = 'The last day cannot be before the first day.';
    else if (span > MAX_ALL_DAY_DAYS) errors.endDate = `All-day events can span at most ${MAX_ALL_DAY_DAYS} days.`;
  } else {
    const minutes = durationMinutes(form);
    if (minutes === null) errors.endTime = 'Choose a start and end time.';
    else if (minutes <= 0) errors.endTime = 'The end time must be after the start time.';
    else if (minutes > MAX_TIMED_MINUTES) errors.endTime = 'Events can last at most 12 hours.';
  }

  if (form.recurrence !== 'none') {
    if (form.allDay && allDaySpan(form) > 1) errors.recurrence = 'Only single-day all-day events can repeat.';
    else if (form.recurrence === 'weekdays' && weekday(parseDate(form.date)) >= 5) errors.recurrence = 'A weekday series must start on a weekday.';
    if (form.until) {
      const days = Math.round((parseDate(form.until).getTime() - parseDate(form.date).getTime()) / 86_400_000);
      if (days < 0) errors.until = 'The repeat end date must be on or after the first day.';
      else if (days > MAX_SERIES_DAYS) errors.until = 'A series can repeat for at most one year.';
    }
  }

  if (form.location.trim().length > LOCATION_MAX) errors.location = `Keep the location under ${LOCATION_MAX} characters.`;
  if (form.notes.trim().length > NOTES_MAX) errors.notes = `Notes can be at most ${NOTES_MAX} characters.`;
  if (form.shared && ANNOUNCED_KINDS.includes(form.kind) && !canAnnounce) {
    errors.shared = 'Only instructors can share exams and live sessions with the workspace.';
  }
  return errors;
}

export function formToPayload(form: EventFormState): EventInput {
  const startsAt = form.allDay ? `${form.date}T00:00:00` : `${form.date}T${form.startTime}:00`;
  const endsAt = form.allDay ? `${dayKey(addDays(parseDate(form.endDate), 1))}T00:00:00` : `${form.date}T${form.endTime}:00`;
  return {
    title: form.title.trim(),
    kind: form.kind,
    course_id: form.courseId ? Number(form.courseId) : null,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: form.allDay,
    location: form.location.trim(),
    notes: form.notes.trim(),
    recurrence: form.recurrence,
    recurrence_until: form.recurrence !== 'none' && form.until ? form.until : null,
    shared: form.shared,
  };
}
