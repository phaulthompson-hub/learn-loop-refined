// Display formatting shared by every page. All date output is in UTC with a fixed English locale,
// so the same data renders the same text on every machine.
import { daysBetween, parseDate } from './dates';

const LOCALE = 'en-GB';
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const longWeekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

export const formatDate = (value: string | Date) => dateFmt.format(parseDate(value));
export const formatShortDate = (value: string | Date) => shortDateFmt.format(parseDate(value));
export const formatWeekday = (value: string | Date) => weekdayFmt.format(parseDate(value));
export const formatLongDate = (value: string | Date) => longWeekdayFmt.format(parseDate(value));
export const formatMonth = (value: string | Date) => monthFmt.format(parseDate(value));
export const formatTime = (value: string | Date) => timeFmt.format(parseDate(value));
export const formatDateTime = (value: string | Date) => `${formatShortDate(value)}, ${formatTime(value)}`;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else a date; future values read "in 2 days". */
export function relativeTime(value: string | Date, now: Date): string {
  const date = parseDate(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);
  if (abs < 60) return 'just now';
  if (abs < 3600) return wrap(`${Math.floor(abs / 60)} min`);
  const days = daysBetween(future ? now : date, future ? date : now);
  if (abs < 86_400 && days === 0) return wrap(`${Math.floor(abs / 3600)} h`);
  if (days === 1) return future ? 'tomorrow' : 'yesterday';
  if (days < 7) return wrap(`${days} days`);
  if (days < 30) return wrap(`${Math.floor(days / 7)} wk`);
  return formatDate(date);
}

/** "Today", "Tomorrow", "Yesterday", or a short weekday date. */
export function relativeDay(value: string | Date, now: Date): string {
  const diff = daysBetween(now, parseDate(value));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatWeekday(value);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatPercent = (value: number, digits = 0) => `${value.toFixed(digits)}%`;

export const formatNumber = (value: number) => new Intl.NumberFormat(LOCALE).format(value);

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** "in_progress" -> "In progress" */
export const humanize = (value: string) => capitalize(value.replace(/[_-]+/g, ' '));
