// Client-side rules for notes, mirroring backend/app/schemas/notes.py, plus the draft bookkeeping
// that autosave relies on (what changed since the last successful save).
import type { Note, NoteDraft } from './types';

export const TITLE_MAX = 160;
export const BODY_MAX = 50_000;
export const TAG_MAX = 24;
export const MAX_TAGS = 10;

export type DraftErrors = Partial<Record<'title' | 'body' | 'tags', string>>;

/** "#Machine Learning " -> "machine-learning" (same rule as the API). */
export function normaliseTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join('-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

/**
 * Add comma-separated tags typed into the tag input. Duplicates are ignored; tags that are too long
 * or beyond the limit are rejected with a message, and valid ones are still added.
 */
export function addTags(existing: string[], raw: string): { tags: string[]; error: string | null } {
  const tags = [...existing];
  let error: string | null = null;
  for (const part of raw.split(',')) {
    const tag = normaliseTag(part);
    if (!tag || tags.includes(tag)) continue;
    if (tag.length > TAG_MAX) error = `Tags can be at most ${TAG_MAX} characters.`;
    else if (tags.length >= MAX_TAGS) error = `A note can have at most ${MAX_TAGS} tags.`;
    else tags.push(tag);
  }
  return { tags, error };
}

export function validateDraft(draft: NoteDraft): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = 'Give the note a title.';
  else if (title.length > TITLE_MAX) errors.title = `Titles can be at most ${TITLE_MAX} characters (${title.length} now).`;
  if (draft.body.length > BODY_MAX) errors.body = `Notes can be at most ${BODY_MAX.toLocaleString('en-GB')} characters.`;
  if (draft.tags.length > MAX_TAGS) errors.tags = `A note can have at most ${MAX_TAGS} tags.`;
  return errors;
}

export const hasErrors = (errors: DraftErrors) => Object.keys(errors).length > 0;

export function draftFromNote(note: Note): NoteDraft {
  return { title: note.title, body: note.body, tags: note.tags, course_id: note.course?.id ?? null, concept_id: note.concept?.id ?? null };
}

export function emptyDraft(title = '', courseId: number | null = null): NoteDraft {
  return { title, body: '', tags: [], course_id: courseId, concept_id: null };
}

/** The fields of `draft` that differ from `saved`, ready to PATCH. Titles are compared trimmed. */
export function diffDraft(saved: NoteDraft, draft: NoteDraft): Partial<NoteDraft> {
  const patch: Partial<NoteDraft> = {};
  if (draft.title.trim() !== saved.title.trim()) patch.title = draft.title.trim();
  if (draft.body !== saved.body) patch.body = draft.body;
  if (draft.tags.join(',') !== saved.tags.join(',')) patch.tags = draft.tags;
  if (draft.course_id !== saved.course_id) patch.course_id = draft.course_id;
  if (draft.concept_id !== saved.concept_id || (patch.course_id !== undefined && draft.concept_id === null)) patch.concept_id = draft.concept_id;
  return patch;
}

export const isDirty = (saved: NoteDraft, draft: NoteDraft) => Object.keys(diffDraft(saved, draft)).length > 0;
