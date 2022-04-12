// Date helpers. The API sends naive UTC timestamps ("2022-03-14T09:00:00"); every helper here treats
// them as UTC and formats in UTC, so screens do not depend on the viewer's time zone.
export const DAY_MS = 86_400_000;

/** Parse an API timestamp or `YYYY-MM-DD` date as UTC. */
export function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

/** `YYYY-MM-DD` for a date, in UTC. */
export function dayKey(value: string | Date): string {
  return parseDate(value).toISOString().slice(0, 10);
}

/** Naive UTC ISO string without the trailing Z, the format the API expects for datetimes. */
export function toApiDateTime(value: Date): string {
  return value.toISOString().slice(0, 19);
}

export function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

export function addMonths(value: Date, months: number): Date {
  const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(value.getUTCDate(), lastDay));
  return result;
}

/** Monday-based by default (0 = Monday … 6 = Sunday), matching the API's `week_starts_on`. */
export function weekday(value: Date): number {
  return (value.getUTCDay() + 6) % 7;
}

export function startOfWeek(value: Date, weekStartsOn = 0): Date {
  const day = startOfDay(value);
  return addDays(day, -((weekday(day) - weekStartsOn + 7) % 7));
}

export function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}
