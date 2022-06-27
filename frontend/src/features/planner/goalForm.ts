// Goal and study-log forms: per-kind rules (mirroring backend/app/schemas/goals.py), validation and payloads.
import { daysBetween, dayKey, parseDate, toApiDateTime } from '../../lib/dates';
import { formatNumber, plural } from '../../lib/format';
import type { CourseOption, Goal, GoalInput, GoalKind, GoalPeriod, GoalStatus, StudyActivity, StudyLogInput } from './types';

export const GOAL_TITLE_MIN = 2;
export const GOAL_TITLE_MAX = 120;
export const MAX_LOG_MINUTES = 600;
export const MINUTES_PER_DAY = 24 * 60;
export const LOG_HISTORY_DAYS = 90;
export const NOTE_MAX = 255;

export const GOAL_KINDS: GoalKind[] = ['daily_answers', 'weekly_reviews', 'study_minutes', 'course_mastery'];

export const GOAL_KIND_META: Record<GoalKind, { label: string; unit: string; help: string }> = {
  daily_answers: { label: 'Quiz answers', unit: 'answers', help: 'Questions answered in this workspace’s courses each day.' },
  weekly_reviews: { label: 'Flashcard reviews', unit: 'reviews', help: 'Cards reviewed each week (your week start applies).' },
  study_minutes: { label: 'Study time', unit: 'minutes', help: 'Minutes you log, per day or per week.' },
  course_mastery: { label: 'Course mastery', unit: '% mastery', help: 'Average mastery across a course’s concepts, by a date.' },
};

export const ALLOWED_PERIODS: Record<GoalKind, GoalPeriod[]> = {
  daily_answers: ['day'],
  weekly_reviews: ['week'],
  study_minutes: ['day', 'week'],
  course_mastery: ['once'],
};

export const TARGET_LIMITS: Record<string, [number, number]> = {
  'daily_answers:day': [1, 200],
  'weekly_reviews:week': [1, 2000],
  'study_minutes:day': [5, 600],
  'study_minutes:week': [15, 4200],
  'course_mastery:once': [1, 100],
};

export const PERIOD_LABELS: Record<GoalPeriod, string> = { day: 'Every day', week: 'Every week', once: 'One-off' };

export const STATUS_META: Record<GoalStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  on_track: { label: 'On track', tone: 'info' },
  at_risk: { label: 'At risk', tone: 'warn' },
  done: { label: 'Done', tone: 'ok' },
  overdue: { label: 'Overdue', tone: 'bad' },
};

export const ACTIVITY_LABELS: Record<StudyActivity, string> = {
  quiz: 'Quiz practice',
  flashcards: 'Flashcards',
  reading: 'Reading',
  manual: 'Other study',
};

export type GoalFormState = { title: string; kind: GoalKind; period: GoalPeriod; target: string; courseId: string; dueDate: string };
export type GoalFormErrors = Partial<Record<'title' | 'target' | 'courseId' | 'dueDate', string>>;

const DEFAULT_TARGETS: Record<string, number> = {
  'daily_answers:day': 8,
  'weekly_reviews:week': 40,
  'study_minutes:day': 30,
  'study_minutes:week': 180,
  'course_mastery:once': 80,
};

export const targetLimits = (kind: GoalKind, period: GoalPeriod): [number, number] => TARGET_LIMITS[`${kind}:${period}`];

export function emptyGoalForm(kind: GoalKind = 'daily_answers'): GoalFormState {
  const period = ALLOWED_PERIODS[kind][0];
  return { title: '', kind, period, target: String(DEFAULT_TARGETS[`${kind}:${period}`]), courseId: '', dueDate: '' };
}

/** Switch kind (or period), keeping the title but resetting the target to a sensible default. */
export function withKind(form: GoalFormState, kind: GoalKind, period?: GoalPeriod): GoalFormState {
  const nextPeriod = period && ALLOWED_PERIODS[kind].includes(period) ? period : ALLOWED_PERIODS[kind][0];
  return {
    ...form,
    kind,
    period: nextPeriod,
    target: String(DEFAULT_TARGETS[`${kind}:${nextPeriod}`]),
    dueDate: nextPeriod === 'once' ? form.dueDate : '',
  };
}

export function formFromGoal(goal: Goal): GoalFormState {
  return {
    title: goal.title,
    kind: goal.kind,
    period: goal.period,
    target: String(goal.target),
    courseId: goal.course ? String(goal.course.id) : '',
    dueDate: goal.due_date ?? '',
  };
}

/** A title suggestion such as "8 answers a day" or "Reach 80% in Statistics". */
export function suggestedTitle(form: GoalFormState, courses: readonly CourseOption[]): string {
  const target = Number(form.target) || 0;
  const course = courses.find((c) => String(c.id) === form.courseId);
  switch (form.kind) {
    case 'daily_answers':
      return `Answer ${target} questions a day`;
    case 'weekly_reviews':
      return `${target} flashcard reviews a week`;
    case 'study_minutes': {
      const amount = target % 60 === 0 && target >= 60 ? `${target / 60} ${target === 60 ? 'hour' : 'hours'}` : `${target} minutes`;
      return `${amount} of study ${form.period === 'day' ? 'a day' : 'a week'}`;
    }
    case 'course_mastery':
      return course ? `Reach ${target}% in ${course.title}` : `Reach ${target}% mastery`;
  }
}

export function validateGoalForm(form: GoalFormState, today: Date, previousDueDate: string | null = null): GoalFormErrors {
  const errors: GoalFormErrors = {};
  const title = form.title.trim().length;
  if (title < GOAL_TITLE_MIN) errors.title = `Give the goal a title of at least ${GOAL_TITLE_MIN} characters.`;
  else if (title > GOAL_TITLE_MAX) errors.title = `Keep the title under ${GOAL_TITLE_MAX} characters.`;

  const [low, high] = targetLimits(form.kind, form.period);
  const target = Number(form.target);
  if (form.target.trim() === '' || Number.isNaN(target)) errors.target = 'Enter a target.';
  else if (target < low || target > high) errors.target = `The target must be between ${low} and ${high}.`;
  else if (form.kind !== 'course_mastery' && !Number.isInteger(target)) errors.target = 'Use a whole number.';

  if (form.kind === 'course_mastery' && !form.courseId) errors.courseId = 'Choose the course this goal is for.';
  if (form.dueDate && form.dueDate !== previousDueDate && daysBetween(today, parseDate(form.dueDate)) < 0) {
    errors.dueDate = 'The due date cannot be in the past.';
  }
  return errors;
}

export function goalFormToPayload(form: GoalFormState): GoalInput {
  return {
    title: form.title.trim(),
    kind: form.kind,
    period: form.period,
    target: Number(form.target),
    course_id: form.courseId ? Number(form.courseId) : null,
    due_date: form.period === 'once' && form.dueDate ? form.dueDate : null,
  };
}

/** A goal quantity for display: "62%" for mastery, "1,200" otherwise. */
export function goalAmount(goal: Pick<Goal, 'kind'>, value: number): string {
  return goal.kind === 'course_mastery' ? `${Math.round(value)}%` : formatNumber(Math.round(value));
}

/** One line about what is left, e.g. "3 more answers today" or "18% to go in 22 days". */
export function paceHint(goal: Pick<Goal, 'kind' | 'period' | 'progress'>): string {
  const { progress } = goal;
  if (progress.status === 'done') return goal.period === 'once' ? 'Goal reached. Nice work!' : 'Done for this period.';
  const left = goalAmount(goal, progress.remaining);
  if (progress.status === 'overdue') return `The due date passed with ${left} to go.`;
  const unit = goal.kind === 'course_mastery' ? 'to go' : `more ${progress.unit}`;
  const when = progress.days_left === null ? '' : progress.days_left === 0 ? ' today' : ` in ${plural(progress.days_left + 1, 'day')}`;
  return `${left} ${unit}${when}`;
}

// ---------- Study logs ----------

export type StudyLogFormState = { minutes: string; activity: StudyActivity; courseId: string; date: string; time: string; note: string };
export type StudyLogErrors = Partial<Record<'minutes' | 'date' | 'time' | 'note', string>>;

export function emptyStudyLog(now: Date): StudyLogFormState {
  return { minutes: '30', activity: 'manual', courseId: '', date: dayKey(now), time: toApiDateTime(now).slice(11, 16), note: '' };
}

export function studyLogMoment(form: Pick<StudyLogFormState, 'date' | 'time'>): Date {
  return parseDate(`${form.date}T${form.time || '00:00'}:00`);
}

/** `loggedThatDay`: minutes already logged on the chosen day (the server caps a day at 24 hours). */
export function validateStudyLog(form: StudyLogFormState, now: Date, loggedThatDay = 0): StudyLogErrors {
  const errors: StudyLogErrors = {};
  const minutes = Number(form.minutes);
  if (form.minutes.trim() === '' || !Number.isInteger(minutes)) errors.minutes = 'Enter whole minutes.';
  else if (minutes < 1 || minutes > MAX_LOG_MINUTES) errors.minutes = `Log between 1 and ${MAX_LOG_MINUTES} minutes at a time.`;
  else if (loggedThatDay + minutes > MINUTES_PER_DAY) errors.minutes = `That day already has ${loggedThatDay} minutes logged.`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = 'Choose a date.';
  else if (!/^\d{2}:\d{2}$/.test(form.time)) errors.time = 'Choose a time.';
  else {
    const moment = studyLogMoment(form);
    if (moment.getTime() > now.getTime()) errors.time = 'Study time cannot be logged in the future.';
    else if (daysBetween(moment, now) > LOG_HISTORY_DAYS) errors.date = `You can log time for the last ${LOG_HISTORY_DAYS} days.`;
  }
  if (form.note.trim().length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} characters.`;
  return errors;
}

export function studyLogToPayload(form: StudyLogFormState): StudyLogInput {
  return {
    minutes: Number(form.minutes),
    activity: form.activity,
    note: form.note.trim(),
    course_id: form.courseId ? Number(form.courseId) : null,
    logged_at: toApiDateTime(studyLogMoment(form)),
  };
}
