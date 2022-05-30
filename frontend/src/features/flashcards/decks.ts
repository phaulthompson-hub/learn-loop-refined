// Pure helpers for the deck and card screens: filtering, grouping, sorting, form validation and labels.
import { groupBy, matchesQuery, sortBy } from '../../lib/table';
import { BACK_MAX, FRONT_MAX, HINT_MAX, normaliseFront } from './importParser';
import type { Card, CardInput, CardStatus, DeckSummary } from './types';

export const DECK_NAME_MIN = 2;
export const DECK_NAME_MAX = 120;
export const DECK_DESCRIPTION_MAX = 500;

export type DeckSort = 'course' | 'due' | 'name' | 'mastery';

export const DECK_SORTS: { value: DeckSort; label: string }[] = [
  { value: 'course', label: 'Course' },
  { value: 'due', label: 'Most due' },
  { value: 'name', label: 'Name' },
  { value: 'mastery', label: 'Least mastered' },
];

export type DeckFilter = { query: string; courseId: number | null };

export function filterDecks(decks: readonly DeckSummary[], { query, courseId }: DeckFilter): DeckSummary[] {
  return decks.filter((d) => (courseId === null || d.course_id === courseId) && matchesQuery(query, d.name, d.description, d.course_title));
}

export function sortDecks(decks: readonly DeckSummary[], sort: DeckSort): DeckSummary[] {
  const byName = sortBy(decks, (d) => d.name, 'asc');
  if (sort === 'due') return sortBy(byName, (d) => d.due + d.new / 1000, 'desc');
  if (sort === 'mastery') return sortBy(byName, (d) => d.mastery, 'asc');
  if (sort === 'course') return sortBy(byName, (d) => d.course_title, 'asc');
  return byName;
}

export type DeckGroup = { courseId: number; title: string; color: string; decks: DeckSummary[]; due: number };

/** Keep the incoming order of decks, grouped under their course (courses in order of first appearance). */
export function groupDecksByCourse(decks: readonly DeckSummary[]): DeckGroup[] {
  return [...groupBy(decks, (d) => d.course_id).values()].map((items) => ({
    courseId: items[0].course_id,
    title: items[0].course_title,
    color: items[0].course_color,
    decks: items,
    due: items.reduce((sum, d) => sum + d.due, 0),
  }));
}

export type StudyAction = { label: string; kind: 'due' | 'new' | 'done' };

/** What the "Study" button on a deck should say. New cards count only while today's allowance lasts. */
export function studyAction(deck: Pick<DeckSummary, 'due' | 'new'>, newAllowance = Infinity): StudyAction {
  if (deck.due > 0) return { label: `Review ${deck.due}`, kind: 'due' };
  const fresh = Math.min(deck.new, newAllowance);
  if (fresh > 0) return { label: `Learn ${fresh} new`, kind: 'new' };
  return { label: 'Caught up', kind: 'done' };
}

export const STATUS_LABELS: Record<CardStatus, string> = { new: 'New', learning: 'Learning', young: 'Young', mature: 'Mature' };
export const STATUS_TONES: Record<CardStatus, string> = { new: 'info', learning: 'bad', young: 'warn', mature: 'ok' };
export const STATUS_HINTS: Record<CardStatus, string> = {
  new: 'Never reviewed',
  learning: 'Forgotten recently, being relearned',
  young: 'Interval under three weeks',
  mature: 'Interval of three weeks or more',
};

export type CardFilter = { query: string; status: CardStatus | 'all' };

export function filterCards(cards: readonly Card[], { query, status }: CardFilter): Card[] {
  return cards.filter((c) => (status === 'all' || c.status === status) && matchesQuery(query, c.front, c.back, c.hint, c.concept_name));
}

export function countStatuses(cards: readonly Card[]): Record<CardStatus | 'all', number> {
  const counts = { all: cards.length, new: 0, learning: 0, young: 0, mature: 0 };
  for (const card of cards) counts[card.status] += 1;
  return counts;
}

export type DeckFormErrors = Partial<Record<'course' | 'name' | 'description', string>>;

export function validateDeck(input: { courseId: number | null; name: string; description: string }, existingNames: readonly string[] = []): DeckFormErrors {
  const errors: DeckFormErrors = {};
  const name = input.name.trim();
  if (input.courseId === null) errors.course = 'Choose the course this deck belongs to.';
  if (name.length < DECK_NAME_MIN) errors.name = `Name must be at least ${DECK_NAME_MIN} characters.`;
  else if (name.length > DECK_NAME_MAX) errors.name = `Name must be at most ${DECK_NAME_MAX} characters.`;
  else if (existingNames.some((existing) => existing.toLowerCase() === name.toLowerCase())) errors.name = 'This course already has a deck with that name.';
  if (input.description.trim().length > DECK_DESCRIPTION_MAX) errors.description = `Description must be at most ${DECK_DESCRIPTION_MAX} characters.`;
  return errors;
}

export type CardFormErrors = Partial<Record<'front' | 'back' | 'hint', string>>;

/** Mirrors CardCreate on the API, plus the duplicate-front check the API answers with 409. */
export function validateCard(input: CardInput, siblings: readonly Pick<Card, 'id' | 'front'>[] = [], editingId: number | null = null): CardFormErrors {
  const errors: CardFormErrors = {};
  const front = input.front.trim();
  const back = input.back.trim();
  if (!front) errors.front = 'Write the question or prompt.';
  else if (front.length > FRONT_MAX) errors.front = `Front must be at most ${FRONT_MAX} characters.`;
  else if (siblings.some((c) => c.id !== editingId && normaliseFront(c.front) === normaliseFront(front))) errors.front = 'This deck already has a card with the same front.';
  if (!back) errors.back = 'Write the answer.';
  else if (back.length > BACK_MAX) errors.back = `Back must be at most ${BACK_MAX} characters.`;
  if (input.hint.trim().length > HINT_MAX) errors.hint = `Hint must be at most ${HINT_MAX} characters.`;
  return errors;
}

export const hasErrors = (errors: object) => Object.keys(errors).length > 0;
