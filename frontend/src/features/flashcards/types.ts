// Shapes returned by backend/app/routers/flashcards.py (see schemas/flashcards.py).
import type { Page } from '../../lib/http';

export type CardStatus = 'new' | 'learning' | 'young' | 'mature';

/** 0 again, 1 hard, 2 good, 3 easy. */
export type Grade = 0 | 1 | 2 | 3;

export type DeckSummary = {
  id: number;
  workspace_id: number;
  course_id: number;
  course_title: string;
  course_color: string;
  name: string;
  description: string;
  created_by_id: number | null;
  created_by_name: string | null;
  created_at: string;
  card_count: number;
  due: number;
  new: number;
  learning: number;
  young: number;
  mature: number;
  mastery: number;
  retention: number | null;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  can_edit: boolean;
};

export type DeckCourse = { id: number; title: string; color: string; decks: number; can_edit: boolean };

export type DueTotals = { due: number; new: number; total: number };

export type DeckPage = Page<DeckSummary> & { courses: DeckCourse[]; totals: DueTotals };

export type ConceptBrief = { id: number; name: string; summary: string; card_count: number };

export type DeckDetail = DeckSummary & { concepts: ConceptBrief[] };

export type DeckInput = { course_id: number; name: string; description: string };

export type Card = {
  id: number;
  deck_id: number;
  concept_id: number | null;
  concept_name: string | null;
  front: string;
  back: string;
  hint: string;
  position: number;
  created_at: string;
  status: CardStatus;
  due_at: string | null;
  interval_days: number;
  ease: number | null;
  repetitions: number;
  lapses: number;
  reviews: number;
  last_reviewed_at: string | null;
};

export type CardPage = Page<Card> & { counts: Record<CardStatus, number> };

export type CardInput = { front: string; back: string; hint: string; concept_id: number | null };

export type ImportedLine = { line: number; front: string; back: string; hint: string };
export type RejectedLine = { line: number; text: string; reason: string };
export type ImportResult = { accepted: ImportedLine[]; rejected: RejectedLine[]; created: number };

export type GenerateResult = { created: Card[]; skipped: number };

export type IntervalPreview = { grade: Grade; label: string; interval_days: number; display: string };

export type ReviewCard = {
  id: number;
  deck_id: number;
  deck_name: string;
  course_id: number;
  course_title: string;
  course_color: string;
  front: string;
  back: string;
  hint: string;
  concept_name: string | null;
  status: CardStatus;
  due_at: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  previews: IntervalPreview[];
};

export type ReviewQueue = {
  cards: ReviewCard[];
  due: number;
  new: number;
  new_limit: number;
  new_allowance: number;
  next_due_at: string | null;
};

export type ReviewResult = {
  card_id: number;
  grade: Grade;
  status: CardStatus;
  ease: number;
  interval_before: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  due_at: string;
  display: string;
};

export type SessionInput = { deck_id: number | null; reviewed: number; again: number; duration_seconds: number };

export type SessionResult = { study_log_id: number; course_id: number | null; minutes: number; reviewed: number; accuracy: number };

export type ForecastDay = { date: string; due: number };
export type DailyReviews = { date: string; reviews: number; again: number };

export type ReviewStats = {
  total_cards: number;
  due_today: number;
  new_available: number;
  new_allowance: number;
  reviewed_today: number;
  again_today: number;
  retention_30d: number | null;
  reviews_30d: number;
  learning: number;
  young: number;
  mature: number;
  streak: number;
  next_due_at: string | null;
  forecast: ForecastDay[];
  history: DailyReviews[];
};
