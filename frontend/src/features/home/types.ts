// Response shapes of /workspaces/{id}/home, /analytics and /activity (see backend/app/schemas).

export type PersonBrief = { id: number; name: string; avatar_color: string };
export type CourseBrief = { id: number; title: string; color: string };
export type Comparison = { value: number; previous: number; change: number; percent: number | null };

export type ActivityItem = {
  id: number;
  workspace_id: number;
  actor: PersonBrief | null;
  verb: string;
  object_type: string;
  object_id: number | null;
  summary: string;
  link: string;
  detail: string;
  created_at: string;
};

export type ActivityPage = {
  items: ActivityItem[];
  total: number;
  has_more: boolean;
  next_before_id: number | null;
  facets: { actors: PersonBrief[]; object_types: string[] };
};

export type AgendaItem = {
  event_id: number;
  title: string;
  kind: 'study' | 'review' | 'exam' | 'deadline' | 'live' | string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  shared: boolean;
  mine: boolean;
  recurring: boolean;
  status: 'past' | 'now' | 'upcoming';
  course: CourseBrief | null;
};

export type NextConcept = { concept_id: number | null; concept: string | null; mastery: number | null; reason: string };

export type ContinueCourse = {
  id: number;
  title: string;
  subject: string;
  color: string;
  mastery: number;
  concepts: number;
  mastered_concepts: number;
  progress: number;
  accuracy: number;
  attempts: number;
  pinned: boolean;
  last_opened_at: string | null;
  next: NextConcept;
};

export type Focus = { course: CourseBrief; concept_id: number; concept: string; mastery: number; level: string; reason: string };

export type TaskItem = {
  id: number;
  number: number;
  key: string;
  title: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | string;
  due_date: string | null;
  overdue: boolean;
  due_in_days: number | null;
  course: CourseBrief | null;
};

export type GoalItem = {
  id: number;
  title: string;
  kind: string;
  period: string;
  target: number;
  current: number;
  percent: number;
  status: 'done' | 'on_track' | 'at_risk' | 'overdue' | string;
  unit: string;
  period_label: string;
  course: CourseBrief | null;
};

export type WeekDay = { date: string; answers: number; reviews: number; minutes: number };

export type Onboarding = { courses: number; enrolled: number; decks: number; events: number; goals: number; can_create_courses: boolean };

export type Home = {
  greeting: { first_name: string; part_of_day: 'morning' | 'afternoon' | 'evening' | 'night'; today: string; now: string };
  streak: { current: number; longest: number; active_today: boolean; active_days_last_30: number };
  flashcards: { due: number; new: number; total: number };
  agenda: AgendaItem[];
  continue_learning: ContinueCourse[];
  focus: Focus | null;
  tasks: { items: TaskItem[]; total_open: number; overdue: number };
  goals: GoalItem[];
  week: { answers: Comparison; accuracy: Comparison; reviews: Comparison; minutes: Comparison; days: WeekDay[] };
  activity: ActivityItem[];
  onboarding: Onboarding;
};

export type RangeDays = 7 | 30 | 90;

export type KpiKey = 'answers' | 'accuracy' | 'reviews' | 'retention' | 'minutes' | 'mastery' | 'mastered_concepts' | 'active_days';

export type DailyPoint = { date: string; correct: number; incorrect: number; reviews: number; minutes: number; mastery: number };

export type CourseBreakdown = CourseBrief & {
  concepts: number;
  mastered_concepts: number;
  mastery: number;
  mastery_change: number;
  attempts: number;
  accuracy: number;
  reviews: number;
  minutes: number;
};

export type ConceptRow = {
  id: number;
  name: string;
  course: CourseBrief;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery: number;
  level: string;
  unlocked: boolean;
  last_practiced: string | null;
};

export type TimeSlice = { key: string; label: string; minutes: number; color: string | null };

export type LeaderboardRow = PersonBriefRow & { rank: number; answers: number; correct: number; accuracy: number; is_me: boolean };
type PersonBriefRow = { user_id: number; name: string; avatar_color: string };

export type Analytics = {
  range: { days: RangeDays; start: string; end: string; previous_start: string; previous_end: string; course_id: number | null };
  courses_in_scope: CourseBrief[];
  kpis: Record<KpiKey, Comparison>;
  daily: DailyPoint[];
  courses: CourseBreakdown[];
  concepts: ConceptRow[];
  weakest: ConceptRow[];
  flashcards: {
    reviews: number;
    retention: number | null;
    grades: { again: number; hard: number; good: number; easy: number };
    due_now: number;
    forecast: { date: string; count: number }[];
  };
  time: { total: number; by_course: TimeSlice[]; by_activity: TimeSlice[] };
  leaderboard: LeaderboardRow[];
  can_view_learners: boolean;
};

export type LearnerCell = { course_id: number; enrolled: boolean; mastery: number | null; mastered_concepts: number };

export type LearnerRow = PersonBriefRow & {
  role: string;
  answers: number;
  accuracy: number;
  last_active: string | null;
  average_mastery: number | null;
  cells: LearnerCell[];
};

export type Learners = { days: RangeDays; courses: CourseBrief[]; learners: LearnerRow[] };
