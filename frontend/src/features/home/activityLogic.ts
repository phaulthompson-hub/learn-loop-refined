// Pure helpers for the activity feed: day grouping, verb metadata and cursor-page merging.
import { daysBetween, dayKey, parseDate } from '../../lib/dates';
import { formatLongDate, humanize } from '../../lib/format';
import type { ActivityItem } from './types';

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Group newest-first items under "Today", "Yesterday" or a long date, keeping their order. */
export function groupByDay<T extends { created_at: string }>(items: readonly T[], now: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const key = dayKey(item.created_at);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(item.created_at, now), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function dayLabel(value: string, now: Date): string {
  const diff = daysBetween(parseDate(value), now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatLongDate(value);
}

export type VerbKind = 'course' | 'publish' | 'archive' | 'mastery' | 'quiz' | 'member' | 'deck' | 'review' | 'task' | 'event' | 'goal' | 'note' | 'other';

export type VerbMeta = { kind: VerbKind; label: string };

const EXACT: Record<string, VerbMeta> = {
  'course.created': { kind: 'course', label: 'New course' },
  'course.published': { kind: 'publish', label: 'Published' },
  'course.active': { kind: 'publish', label: 'Published' },
  'course.archived': { kind: 'archive', label: 'Archived' },
  'course.draft': { kind: 'archive', label: 'Unpublished' },
  'course.deleted': { kind: 'archive', label: 'Deleted' },
  'concept.mastered': { kind: 'mastery', label: 'Mastered' },
  'quiz.completed': { kind: 'quiz', label: 'Practice' },
  'member.joined': { kind: 'member', label: 'Joined' },
};

const BY_OBJECT: Record<string, VerbMeta> = {
  deck: { kind: 'deck', label: 'Flashcards' },
  card: { kind: 'review', label: 'Review' },
  flashcard: { kind: 'review', label: 'Review' },
  review: { kind: 'review', label: 'Review' },
  task: { kind: 'task', label: 'Board' },
  event: { kind: 'event', label: 'Planner' },
  goal: { kind: 'goal', label: 'Goal' },
  note: { kind: 'note', label: 'Notes' },
  member: { kind: 'member', label: 'Members' },
  invitation: { kind: 'member', label: 'Members' },
  course: { kind: 'course', label: 'Course' },
};

/** Icon kind and badge label for a feed verb such as `task.moved`; unknown verbs fall back to their object. */
export function verbMeta(verb: string, objectType = ''): VerbMeta {
  if (EXACT[verb]) return EXACT[verb];
  const prefix = verb.split('.')[0];
  return BY_OBJECT[prefix] ?? BY_OBJECT[objectType] ?? { kind: 'other', label: humanize(prefix || objectType || 'update') };
}

const OBJECT_LABELS: Record<string, string> = {
  course: 'Courses',
  concept: 'Concepts',
  deck: 'Flashcards',
  task: 'Board tasks',
  event: 'Calendar',
  goal: 'Goals',
  note: 'Notes',
  member: 'Members',
  invitation: 'Invitations',
};

export const objectTypeLabel = (type: string) => OBJECT_LABELS[type] ?? humanize(type);

/** Append an older cursor page, skipping anything already shown (e.g. after a new entry shifted the feed). */
export function appendPage<T extends { id: number }>(existing: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...page.filter((item) => !seen.has(item.id))];
}

/** The actor's name, or a neutral label for system entries. */
export const actorName = (item: Pick<ActivityItem, 'actor'>) => item.actor?.name ?? 'LearnLoop';
