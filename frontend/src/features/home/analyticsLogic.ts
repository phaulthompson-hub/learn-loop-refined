// Pure helpers for the analytics page: URL state, KPI definitions and formatting, chart labels, filtering.
import { formatDuration, formatNumber, formatShortDate } from '../../lib/format';
import { masteryLevel } from '../../lib/mastery';
import type { ConceptRow, KpiKey, LearnerRow, RangeDays } from './types';

export const RANGES: RangeDays[] = [7, 30, 90];
export const DEFAULT_RANGE: RangeDays = 30;

export type AnalyticsTab = 'overview' | 'learners';
export type AnalyticsState = { days: RangeDays; courseId: number | null; tab: AnalyticsTab };

/** Read `?days=&course=&tab=` leniently: anything invalid falls back to the defaults. */
export function parseAnalyticsSearch(search: URLSearchParams): AnalyticsState {
  const days = Number(search.get('days'));
  const course = Number(search.get('course'));
  return {
    days: (RANGES as number[]).includes(days) ? (days as RangeDays) : DEFAULT_RANGE,
    courseId: Number.isInteger(course) && course > 0 ? course : null,
    tab: search.get('tab') === 'learners' ? 'learners' : 'overview',
  };
}

/** Serialise state back to a query string, omitting defaults so shared URLs stay short. */
export function analyticsSearch(state: AnalyticsState): string {
  const params = new URLSearchParams();
  if (state.days !== DEFAULT_RANGE) params.set('days', String(state.days));
  if (state.courseId !== null) params.set('course', String(state.courseId));
  if (state.tab !== 'overview') params.set('tab', state.tab);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export type KpiDef = { key: KpiKey; label: string; higherIsBetter: boolean; unit: string; hint: string };

export const KPI_DEFS: KpiDef[] = [
  { key: 'mastery', label: 'Average mastery', higherIsBetter: true, unit: 'pts', hint: 'Across concepts in scope' },
  { key: 'answers', label: 'Questions answered', higherIsBetter: true, unit: '', hint: 'Adaptive quiz answers' },
  { key: 'accuracy', label: 'Quiz accuracy', higherIsBetter: true, unit: 'pts', hint: 'Share answered correctly' },
  { key: 'reviews', label: 'Cards reviewed', higherIsBetter: true, unit: '', hint: 'Flashcard reviews' },
  { key: 'retention', label: 'Recall rate', higherIsBetter: true, unit: 'pts', hint: 'Reviews graded good or easy' },
  { key: 'minutes', label: 'Study time', higherIsBetter: true, unit: 'min', hint: 'Logged study sessions' },
  { key: 'mastered_concepts', label: 'Concepts mastered', higherIsBetter: true, unit: '', hint: 'At 85% or above' },
  { key: 'active_days', label: 'Active days', higherIsBetter: true, unit: '', hint: 'Days with any practice' },
];

export function formatKpi(key: KpiKey, value: number): string {
  if (key === 'minutes') return formatDuration(value);
  if (key === 'mastery' || key === 'accuracy' || key === 'retention') return `${value.toFixed(1)}%`;
  return formatNumber(value);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short x-axis labels: weekday names for a week, day + month otherwise. */
export function axisLabel(date: string, days: number): string {
  if (days <= 7) return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return formatShortDate(date);
}

export type LevelFilter = 'all' | 'needs review' | 'learning' | 'proficient' | 'mastered';

export function filterConcepts(rows: readonly ConceptRow[], text: string, level: LevelFilter): ConceptRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (level !== 'all' && row.level !== level) return false;
    const haystack = `${row.name} ${row.course.title}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** CSS class for a mastery heat cell; `null` means the learner has not started that course. */
export function masteryHeatClass(value: number | null): string {
  if (value === null) return 'mh-none';
  return `mh-${masteryLevel(value).replace(' ', '-')}`;
}

export type LearnerSort = 'mastery' | 'name' | 'answers';

export function sortLearners(rows: readonly LearnerRow[], sort: LearnerSort): LearnerRow[] {
  const byName = (a: LearnerRow, b: LearnerRow) => a.name.localeCompare(b.name);
  return [...rows].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'answers') return b.answers - a.answers || byName(a, b);
    // Learners without any course progress go last.
    return (b.average_mastery ?? -1) - (a.average_mastery ?? -1) || byName(a, b);
  });
}

/** Per-course column average over learners who have started it. */
export function courseAverage(rows: readonly LearnerRow[], courseId: number): number | null {
  const values = rows.map((row) => row.cells.find((c) => c.course_id === courseId)?.mastery).filter((v): v is number => typeof v === 'number');
  if (!values.length) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/** A comparison sentence for the page subtitle: "13 Feb – 14 Mar vs the 30 days before". */
export function rangeCaption(range: { start: string; end: string; days: number }): string {
  return `${formatShortDate(range.start)} – ${formatShortDate(range.end)}, compared with the ${range.days} days before`;
}
