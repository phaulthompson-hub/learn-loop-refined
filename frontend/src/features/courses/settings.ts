// Pure helpers for course permissions and the settings form (dirty tracking, reordering).
import { roleAtLeast } from '../../app/roles';
import type { Me, Role } from '../../app/types';
import type { Course, CourseDetails, CourseUpdate } from './types';

type Owned = { owner_id: number | null; workspace_id: number };

export function roleIn(me: Me | null, workspaceId: number): Role | null {
  return me?.workspaces.find((w) => w.id === workspaceId)?.role ?? null;
}

/** Mirrors `can_edit` in routers/courses.py: the owner or any instructor+ of the workspace. */
export function canEditCourse(course: Owned, userId: number, role: Role | null): boolean {
  return course.owner_id === userId || roleAtLeast(role, 'instructor');
}

/** Deleting needs ownership or the admin role. */
export function canDeleteCourse(course: Owned, userId: number, role: Role | null): boolean {
  return course.owner_id === userId || roleAtLeast(role, 'admin');
}

export function detailsOf(course: Course): CourseDetails {
  return {
    title: course.title,
    description: course.description,
    subject: course.subject,
    difficulty: course.difficulty,
    tags: [...course.tags],
    color: course.color,
  };
}

/** Only the fields that differ from the saved course (after trimming), ready for PATCH. */
export function changedDetails(saved: CourseDetails, draft: CourseDetails): CourseUpdate {
  const changes: CourseUpdate = {};
  for (const key of ['title', 'description', 'subject'] as const) {
    if (draft[key].trim() !== saved[key]) changes[key] = draft[key].trim();
  }
  if (draft.difficulty !== saved.difficulty) changes.difficulty = draft.difficulty;
  if (draft.color.toLowerCase() !== saved.color.toLowerCase()) changes.color = draft.color;
  if (draft.tags.join(',') !== saved.tags.join(',')) changes.tags = draft.tags;
  return changes;
}

export const isDirty = (saved: CourseDetails, draft: CourseDetails) => Object.keys(changedDetails(saved, draft)).length > 0;

/** A copy of `items` with the item at `index` moved by `delta` places (clamped to the list). */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = Math.min(items.length - 1, Math.max(0, index + delta));
  const copy = [...items];
  if (index < 0 || index >= items.length || target === index) return copy;
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** Type-to-confirm for destructive actions: the exact title, ignoring surrounding spaces. */
export const confirmsTitle = (typed: string, title: string) => typed.trim() === title.trim();
