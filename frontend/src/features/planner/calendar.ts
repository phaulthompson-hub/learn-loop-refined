// Pure calendar maths for the planner: grids, ranges, grouping, the week-view overlap layout and
// recurrence previews. Everything works in UTC (see lib/dates.ts), like the API.
import { addDays, addMonths, dayKey, parseDate, startOfDay, startOfMonth, startOfWeek, weekday } from '../../lib/dates';
import { formatDate, formatMonth, formatShortDate, formatTime } from '../../lib/format';
import type { EventKind, Occurrence, Recurrence } from './types';

export type CalendarView = 'month' | 'week' | 'agenda';

export const VIEWS: CalendarView[] = ['month', 'week', 'agenda'];
export const AGENDA_DAYS = 14;
/** Visible hours of the week view's time grid. */
export const GRID_START_HOUR = 7;
export const GRID_END_HOUR = 22;
/** Shortest block the week view draws, so a 5-minute event is still clickable. */
export const MIN_BLOCK_MINUTES = 20;

export const KINDS: EventKind[] = ['study', 'review', 'exam', 'deadline', 'live'];
export const KIND_LABELS: Record<EventKind, string> = {
  study: 'Study session',
  review: 'Review block',
  exam: 'Exam',
  deadline: 'Deadline',
  live: 'Live session',
};

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekdays: 'Every weekday (Mon–Fri)',
  weekly: 'Every week',
};

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const shortWeekday = (day: Date) => WEEKDAY_NAMES[weekday(day)].slice(0, 3);

/** Short weekday headers starting at the user's first day of the week (0 = Monday). */
export function weekdayLabels(weekStartsOn: number): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_NAMES[(weekStartsOn + i) % 7].slice(0, 3));
}

/** Six rows of seven days covering the anchor's month, as shown by the month grid. */
export function monthMatrix(anchor: Date, weekStartsOn: number): Date[][] {
  const first = startOfWeek(startOfMonth(anchor), weekStartsOn);
  return Array.from({ length: 6 }, (_, row) => Array.from({ length: 7 }, (_, col) => addDays(first, row * 7 + col)));
}

export function weekDays(anchor: Date, weekStartsOn: number): Date[] {
  const first = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The [start, end) window a view needs from the API. */
export function viewRange(view: CalendarView, anchor: Date, weekStartsOn: number): { start: Date; end: Date } {
  if (view === 'month') {
    const matrix = monthMatrix(anchor, weekStartsOn);
    return { start: matrix[0][0], end: addDays(matrix[5][6], 1) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor, weekStartsOn);
    return { start, end: addDays(start, 7) };
  }
  const start = startOfDay(anchor);
  return { start, end: addDays(start, AGENDA_DAYS) };
}

/** Move the anchor one page back (-1) or forward (+1) in the current view. */
export function shiftAnchor(view: CalendarView, anchor: Date, step: number): Date {
  if (view === 'month') return addMonths(startOfMonth(anchor), step);
  return addDays(startOfDay(anchor), step * (view === 'week' ? 7 : AGENDA_DAYS));
}

function spanTitle(first: Date, last: Date): string {
  const year = last.getUTCFullYear();
  if (first.getUTCFullYear() !== year) return `${formatDate(first)} – ${formatDate(last)}`;
  if (first.getUTCMonth() === last.getUTCMonth()) return `${first.getUTCDate()} – ${formatShortDate(last)} ${year}`;
  return `${formatShortDate(first)} – ${formatShortDate(last)} ${year}`;
}

export function rangeTitle(view: CalendarView, anchor: Date, weekStartsOn: number): string {
  if (view === 'month') return formatMonth(anchor);
  const { start, end } = viewRange(view, anchor, weekStartsOn);
  return spanTitle(start, addDays(end, -1));
}

/** Does [start, end) touch the given UTC day? Zero-length items count on the day they start. */
export function coversDay(start: Date, end: Date, day: Date): boolean {
  const from = startOfDay(day).getTime();
  const to = from + 86_400_000;
  if (start.getTime() === end.getTime()) return start.getTime() >= from && start.getTime() < to;
  return start.getTime() < to && end.getTime() > from;
}

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.event.all_day !== b.event.all_day) return a.event.all_day ? -1 : 1;
  return a.starts_at.localeCompare(b.starts_at) || a.event.title.localeCompare(b.event.title) || a.key.localeCompare(b.key);
}

/** Occurrences per `YYYY-MM-DD`, with multi-day items repeated on every day they cover. */
export function occurrencesByDay(items: readonly Occurrence[], days: readonly Date[]): Map<string, Occurrence[]> {
  const byDay = new Map<string, Occurrence[]>(days.map((day) => [dayKey(day), []]));
  for (const item of items) {
    const start = parseDate(item.starts_at);
    const end = parseDate(item.ends_at);
    for (const day of days) {
      if (coversDay(start, end, day)) byDay.get(dayKey(day))!.push(item);
    }
  }
  byDay.forEach((list) => list.sort(compareOccurrences));
  return byDay;
}

// ---------- Week view layout ----------

export type TimedBlock = { key: string; start: Date; end: Date };
export type PlacedBlock = {
  key: string;
  /** Offset and size as percentages of the visible grid height. */
  top: number;
  height: number;
  /** Column inside its overlap cluster, and how many columns that cluster uses. */
  column: number;
  columns: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

