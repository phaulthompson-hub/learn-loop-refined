import type { Person } from '../../app/types';
import type { Page } from '../../lib/http';
import type { Snippet } from '../search/types';

export type CourseRef = { id: number; title: string; color: string };
export type ConceptRef = { id: number; name: string };

export type NoteSummary = {
  id: number;
  workspace_id: number;
  title: string;
  excerpt: Snippet;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  shared: boolean;
  mine: boolean;
  author: Person;
  course: CourseRef | null;
  concept: ConceptRef | null;
  words: number;
  created_at: string;
  updated_at: string;
};

export type NoteLink = { target: string; label: string; heading: string | null; note_id: number | null; resolved: boolean };

export type Note = NoteSummary & { body: string; links: NoteLink[]; backlinks: number; can_edit: boolean };

export type NoteCounts = { mine: number; shared: number; archived: number };

export type NotePage = Page<NoteSummary> & { counts: NoteCounts };

export type Backlink = { id: number; title: string; mine: boolean; author: Person; updated_at: string; context: Snippet };

export type TagCount = { tag: string; count: number };

export type NoteTitle = { id: number; title: string; mine: boolean; updated_at: string };

export type NoteTab = 'mine' | 'shared' | 'archived';

export type NoteSort = 'updated_at' | 'created_at' | 'title';

export type NoteFilters = { tab: NoteTab; q: string; tag: string | null; courseId: number | null; sort: NoteSort };

/** The editable part of a note, as held by the editor and sent to the API. */
export type NoteDraft = { title: string; body: string; tags: string[]; course_id: number | null; concept_id: number | null };

/** Minimal course shape for the course/concept pickers (from the courses API). */
export type CourseOption = { id: number; title: string; color: string; status: string };
export type ConceptOption = { id: number; name: string };
