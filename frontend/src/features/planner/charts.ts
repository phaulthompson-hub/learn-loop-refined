// Geometry and labels for the goals page visuals: activity heatmap, progress rings and minute bars.
import { parseDate } from '../../lib/dates';
import { formatDuration, formatWeekday, plural } from '../../lib/format';
import type { HeatmapDay } from './types';

/** Split the heatmap's days (which start on the user's week start) into week columns of seven. */
export function heatmapColumns(days: readonly HeatmapDay[]): HeatmapDay[][] {
  const columns: HeatmapDay[][] = [];
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7));
  return columns;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Month names above the first column in which that month appears (GitHub-style). */
export function monthLabels(columns: readonly HeatmapDay[][]): { column: number; label: string }[] {
  const labels: { column: number; label: string }[] = [];
  let previous = -1;
  columns.forEach((column, index) => {
    const month = parseDate(column[0].date).getUTCMonth();
    if (month !== previous) {
      // Skip a label squeezed into the very first column when the next month starts right after.
      const next = columns[index + 1];
      const crowded = index === 0 && next && parseDate(next[0].date).getUTCMonth() !== month;
      if (!crowded) labels.push({ column: index, label: MONTHS[month] });
      previous = month;
    }
  });
  return labels;
}

export function heatmapTitle(day: HeatmapDay): string {
  const when = formatWeekday(day.date);
  if (day.future) return `${when}: still ahead`;
  if (day.score === 0) return `${when}: no activity`;
  const parts = [
    day.answers && plural(day.answers, 'answer'),
    day.reviews && plural(day.reviews, 'review'),
    day.minutes && formatDuration(day.minutes),
  ].filter(Boolean);
  return `${when}: ${parts.join(', ')}`;
}

/** stroke-dasharray / offset for an SVG progress ring of `radius` filled to `percent`. */
export function ringGeometry(percent: number, radius: number): { circumference: number; offset: number } {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  return { circumference, offset: circumference * (1 - clamped / 100) };
}

/** Round a chart maximum up to a readable step (15/30/60-minute multiples) so gridlines land on round values. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 60;
  const step = value <= 60 ? 15 : value <= 240 ? 30 : 60;
  return Math.ceil(value / step) * step;
}

/** Evenly spaced gridline values from 0 to `max` (inclusive). */
export function gridlines(max: number, count = 3): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((max / count) * i));
}
