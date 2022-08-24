// Pure presentation logic for the Home dashboard (copy, badges, deltas, onboarding), unit-tested in node.
import { formatDuration, formatNumber, formatShortDate, formatTime, plural } from '../../lib/format';
import type { AgendaItem, Comparison, GoalItem, Home, Onboarding, TaskItem } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'brand';

export function greetingTitle(part: Home['greeting']['part_of_day'], firstName: string): string {
  if (part === 'night') return `Burning the midnight oil, ${firstName}?`;
  return `Good ${part}, ${firstName}`;
}

/** One line under the greeting, e.g. "2 sessions today · 16 cards due · 1 task due today". */
export function daySummary(home: Pick<Home, 'agenda' | 'flashcards' | 'tasks'>): string {
  const parts: string[] = [];
  const upcoming = home.agenda.filter((item) => item.status !== 'past').length;
  if (home.agenda.length) parts.push(upcoming ? `${plural(upcoming, 'session')} still ahead today` : 'Today’s sessions are done');
  if (home.flashcards.due) parts.push(`${plural(home.flashcards.due, 'card')} due`);
  const dueToday = home.tasks.items.filter((t) => t.due_in_days === 0).length;
  if (home.tasks.overdue) parts.push(`${plural(home.tasks.overdue, 'task')} overdue`);
  else if (dueToday) parts.push(`${plural(dueToday, 'task')} due today`);
  return parts.length ? parts.join(' · ') : 'A clear day. A good moment to get ahead.';
}

export function streakCopy(streak: Home['streak']): string {
  if (streak.current === 0) return 'Answer a question or review a card to start a streak.';
  if (!streak.active_today) return `Study today to keep your ${streak.current}-day streak alive.`;
  if (streak.current >= streak.longest && streak.current > 1) return 'Your longest streak yet. Keep it glowing.';
  return `Best so far: ${plural(streak.longest, 'day')}.`;
}

export type DeltaInfo = { text: string; tone: 'up' | 'down' | 'flat'; good: boolean | null; title: string };

/**
 * Describe a period-over-period change. `unit` is appended to the absolute change ("pts" for percentages),
 * and `higherIsBetter` decides whether a rise is shown as good.
 */
export function deltaInfo(comparison: Comparison, { unit = '', higherIsBetter = true, period = 'last week' } = {}): DeltaInfo {
  const { change, percent, previous } = comparison;
  const magnitude = Math.abs(Math.round(change * 10) / 10);
  const suffix = unit ? ` ${unit}` : '';
  if (magnitude === 0) return { text: '±0', tone: 'flat', good: null, title: `Same as ${period}` };
  const up = change > 0;
  const relative = percent === null ? '' : ` (${up ? '+' : '−'}${Math.abs(Math.round(percent))}%)`;
  return {
    text: `${up ? '+' : '−'}${formatNumber(magnitude)}${suffix}`,
    tone: up ? 'up' : 'down',
    good: up === higherIsBetter,
    title: `${up ? 'Up' : 'Down'} from ${formatNumber(previous)}${suffix} ${period}${relative}`,
  };
}

export type DueBadge = { text: string; tone: Tone };

export function dueBadge(task: Pick<TaskItem, 'due_date' | 'due_in_days'>): DueBadge {
  if (task.due_date === null || task.due_in_days === null) return { text: 'No due date', tone: 'muted' };
  const days = task.due_in_days;
  if (days < 0) return { text: `${plural(-days, 'day')} overdue`, tone: 'bad' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  if (days === 1) return { text: 'Tomorrow', tone: 'info' };
  if (days < 7) return { text: `In ${days} days`, tone: 'info' };
  return { text: formatShortDate(task.due_date), tone: 'muted' };
}

export const PRIORITY_TONE: Record<string, Tone> = { urgent: 'bad', high: 'warn', medium: 'info', low: 'muted' };

export function agendaTime(item: Pick<AgendaItem, 'all_day' | 'starts_at' | 'ends_at'>): string {
  if (item.all_day) return 'All day';
  return `${formatTime(item.starts_at)}–${formatTime(item.ends_at)}`;
}

/** Where the "now" marker sits in a sorted agenda: before the first timed item that has not finished. */
export function nowMarkerIndex(items: Pick<AgendaItem, 'all_day' | 'status'>[]): number {
  const index = items.findIndex((item) => !item.all_day && item.status !== 'past');
  return index === -1 ? items.length : index;
}

export const GOAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  done: { label: 'Done', tone: 'ok' },
  on_track: { label: 'On track', tone: 'info' },
  at_risk: { label: 'Behind pace', tone: 'warn' },
  overdue: { label: 'Overdue', tone: 'bad' },
};

export function goalStatus(status: string): { label: string; tone: Tone } {
  return GOAL_STATUS[status] ?? { label: status.replace(/_/g, ' '), tone: 'muted' };
}

/** "45 min of 3 h", "12 of 40 reviews", "62% of 80%". */
export function goalProgressText(goal: Pick<GoalItem, 'current' | 'target' | 'unit' | 'kind'>): string {
  if (goal.kind === 'study_minutes') return `${formatDuration(goal.current)} of ${formatDuration(goal.target)}`;
  if (goal.kind === 'course_mastery') return `${Math.round(goal.current)}% of ${Math.round(goal.target)}%`;
  return `${formatNumber(goal.current)} of ${formatNumber(goal.target)} ${goal.unit}`.trim();
}

export type OnboardingStep = { key: string; title: string; description: string; done: boolean; to: string; cta: string };

export function onboardingSteps(onboarding: Onboarding): OnboardingStep[] {
  return [
    {
      key: 'course',
      title: onboarding.can_create_courses ? 'Create or join a course' : 'Join a course',
      description: onboarding.can_create_courses
        ? 'Upload notes or a PDF and LearnLoop builds an adaptive concept path.'
        : 'Browse the courses in this workspace and enrol in one to start practising.',
      done: onboarding.enrolled > 0,
      to: onboarding.can_create_courses && onboarding.courses === 0 ? '/courses/new' : '/courses',
      cta: onboarding.can_create_courses && onboarding.courses === 0 ? 'Create a course' : 'Browse courses',
    },
    {
      key: 'deck',
      title: 'Add a flashcard deck',
      description: 'Spaced repetition brings each card back right before you would forget it.',
      done: onboarding.decks > 0,
      to: '/decks',
      cta: 'Open decks',
    },
    {
      key: 'plan',
      title: 'Plan a study session',
      description: 'Put a recurring block in your calendar so learning happens on schedule.',
      done: onboarding.events > 0,
      to: '/planner',
      cta: 'Open planner',
    },
  ];
}

/** The checklist shows until every step is done. */
export const needsOnboarding = (onboarding: Onboarding) => onboardingSteps(onboarding).some((step) => !step.done);

/** Day-of-week initials for the weekly sparkline strip ("M", "T"…). */
export function weekdayInitial(date: string): string {
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${date}T00:00:00Z`).getUTCDay()];
}
