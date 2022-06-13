// Planner, goals and study-time shapes. Mirrors backend/app/schemas/planner.py and goals.py.

export type EventKind = 'study' | 'review' | 'exam' | 'deadline' | 'live';
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly';

export type CourseRef = { id: number; title: string; color: string };
export type CourseOption = CourseRef & { status?: string };

export type PlannerEvent = {
  id: number;
  workspace_id: number;
  title: string;
  kind: EventKind;
  course: CourseRef | null;
  owner: { id: number; name: string; avatar_color: string };
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  notes: string;
  recurrence: Recurrence;
  recurrence_until: string | null;
  shared: boolean;
  created_at: string;
  can_edit: boolean;
};

/** One concrete occurrence of a (possibly recurring) event. */
export type Occurrence = { key: string; index: number; starts_at: string; ends_at: string; event: PlannerEvent };

export type OccurrencePage = { items: Occurrence[]; total: number; start: string; end: string };

export type Conflict = { event_id: number; title: string; kind: EventKind; starts_at: string; ends_at: string; index: number };

export type EventSaved = { event: PlannerEvent; conflicts: Conflict[] };

export type EventInput = {
  title: string;
  kind: EventKind;
  course_id: number | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  notes: string;
  recurrence: Recurrence;
  recurrence_until: string | null;
  shared: boolean;
};

export type EventFilters = { kinds: EventKind[]; courseId: number | null; scope: 'all' | 'mine' | 'shared' };

export type GoalKind = 'daily_answers' | 'weekly_reviews' | 'study_minutes' | 'course_mastery';
export type GoalPeriod = 'day' | 'week' | 'once';
export type GoalStatus = 'on_track' | 'at_risk' | 'done' | 'overdue';

export type GoalProgress = {
  current: number;
  target: number;
  percent: number;
  remaining: number;
  expected: number;
  status: GoalStatus;
  unit: string;
  period_label: string;
  period_start: string;
  period_end: string | null;
  days_left: number | null;
};

export type Goal = {
  id: number;
  workspace_id: number;
  title: string;
  kind: GoalKind;
  period: GoalPeriod;
  target: number;
  course: CourseRef | null;
  due_date: string | null;
  archived: boolean;
  created_at: string;
  progress: GoalProgress;
};

export type GoalList = { items: Goal[]; total: number; counts: Record<GoalStatus, number> };

export type GoalInput = {
  title: string;
  kind: GoalKind;
  period: GoalPeriod;
  target: number;
  course_id: number | null;
  due_date: string | null;
};

export type StudyActivity = 'quiz' | 'flashcards' | 'reading' | 'manual';

export type StudyLog = { id: number; minutes: number; activity: StudyActivity; note: string; course: CourseRef | null; logged_at: string };

export type StudyLogPage = { items: StudyLog[]; total: number; page: number; page_size: number; total_minutes: number };

export type StudyLogInput = { minutes: number; activity: StudyActivity; note: string; course_id: number | null; logged_at: string };

export type StudySummary = {
  start: string;
  weeks: { start: string; minutes: number; days: { date: string; minutes: number }[] }[];
  by_course: { course_id: number | null; title: string; color: string | null; minutes: number }[];
  total_minutes: number;
  active_days: number;
  average_per_active_day: number;
  today_minutes: number;
  daily_goal_minutes: number;
};

export type HeatmapDay = { date: string; answers: number; reviews: number; minutes: number; score: number; level: number; future: boolean };

export type Streak = {
  current: number;
  longest: number;
  active_today: boolean;
  active_days_last_30: number;
  week_starts_on: number;
  heatmap: {
    start: string;
    end: string;
    weeks: number;
    days: HeatmapDay[];
    max_score: number;
    active_days: number;
    totals: { answers: number; reviews: number; minutes: number };
  };
};
