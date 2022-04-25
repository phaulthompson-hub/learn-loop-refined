import type { Role } from '../../app/types';
import type { Page } from '../../lib/http';
import type { MasteryLevel } from '../../lib/mastery';

export type Difficulty = 'intro' | 'intermediate' | 'advanced';
export type CourseStatus = 'draft' | 'active' | 'archived';

/** One course in the catalogue, as seen by the current user (mastery, pin and enrolment are personal). */
export type CourseSummary = {
  id: number;
  workspace_id: number;
  title: string;
  description: string;
  subject: string;
  difficulty: Difficulty;
  status: CourseStatus;
  color: string;
  tags: string[];
  owner_id: number | null;
  created_at: string;
  updated_at: string;
  concepts: number;
  mastered_concepts: number;
  sources: number;
  attempts: number;
  accuracy: number;
  mastery: number;
  learners: number;
  enrolled: boolean;
  pinned: boolean;
  last_opened_at: string | null;
};

export type CourseFacets = {
  subjects: string[];
  tags: string[];
  statuses: Record<CourseStatus, number>;
  difficulties: Record<Difficulty, number>;
};

export type CoursePage = Page<CourseSummary> & { facets: CourseFacets };

export type Concept = {
  id: number;
  name: string;
  summary: string;
  mastery: number;
  order_index: number;
  prerequisite_id: number | null;
  level: MasteryLevel;
  unlocked: boolean;
};

export type SourceRef = { id: number; name: string; characters: number; words: number; created_at: string };

export type SourceDetail = SourceRef & { course_id: number; content: string };

export type Recommendation = { concept_id: number | null; concept: string | null; mastery: number | null; reason: string };

/** A full course: shared content plus the current user's progress through it. */
export type Course = Omit<CourseSummary, 'concepts' | 'sources' | 'last_opened_at'> & {
  concept_count: number;
  source_count: number;
  concepts: Concept[];
  sources: SourceRef[];
  recommendation: Recommendation;
};

export type CourseDetails = {
  title: string;
  description: string;
  subject: string;
  difficulty: Difficulty;
  tags: string[];
  color: string;
};

export type CourseInput = CourseDetails & { status: 'draft' | 'active' };

export type CourseUpdate = Partial<CourseDetails & { status: CourseStatus }>;

export type Question = { id: string; concept_id: number; concept: string; prompt: string; options: string[] };

export type AnswerResult = {
  correct: boolean;
  correct_index: number;
  concept_id: number;
  concept: string;
  previous_mastery: number;
  mastery: number;
  recommendation: Recommendation;
};

export type Attempt = {
  id: number;
  concept_id: number;
  concept_name: string;
  correct: boolean;
  mastery_before: number;
  mastery_after: number;
  created_at: string;
};

export type TutorMode = 'demo' | 'openai' | 'fallback';

export type TutorReply = { answer: string; citations: string[]; follow_up: string; mode: TutorMode };

export type ActivityDay = { date: string; answers: number; correct: number };

export type CourseActivity = { days: ActivityDay[]; answers: number; correct: number; accuracy: number; active_days: number };

export type LearnerProgress = {
  user_id: number;
  name: string;
  email: string;
  avatar_color: string;
  role: Role;
  enrolled: boolean;
  enrolled_at: string | null;
  mastery: number;
  mastered_concepts: number;
  attempts: number;
  accuracy: number;
  last_active_at: string | null;
  concepts: { concept_id: number; mastery: number }[];
};

export type CourseLearners = {
  items: LearnerProgress[];
  total: number;
  concepts: { id: number; name: string }[];
  average_mastery: number;
  active_last_7_days: number;
};

export type ProgressReset = { attempts_cleared: number; concepts_cleared: number; course: Course };
