import { http, query, type Page } from '../../lib/http';
import type { Backlink, ConceptOption, CourseOption, Note, NoteDraft, NoteFilters, NotePage, NoteTitle, TagCount } from './types';

export const NOTES_PAGE_SIZE = 30;

/** Map the list pane's filters onto the API's query parameters. */
export function listParams(filters: NoteFilters, page = 1, pageSize = NOTES_PAGE_SIZE) {
  return {
    q: filters.q.trim() || undefined,
    tag: filters.tag,
    course_id: filters.courseId,
    archived: filters.tab === 'archived' ? true : undefined,
    author: filters.tab === 'shared' ? 'others' : 'me',
    // Without an explicit sort the API ranks by relevance while searching.
    sort: filters.q.trim() && filters.sort === 'updated_at' ? undefined : filters.sort === 'title' ? 'title' : `-${filters.sort}`,
    page,
    page_size: pageSize,
  };
}

export const notesApi = {
  list: (workspaceId: number, filters: NoteFilters, page = 1, pageSize = NOTES_PAGE_SIZE) =>
    http.get<NotePage>(`/workspaces/${workspaceId}/notes${query(listParams(filters, page, pageSize))}`),
  tags: (workspaceId: number) => http.get<TagCount[]>(`/workspaces/${workspaceId}/notes/tags`),
  titles: (workspaceId: number) => http.get<NoteTitle[]>(`/workspaces/${workspaceId}/notes/titles`),
  get: (id: number) => http.get<Note>(`/notes/${id}`),
  create: (workspaceId: number, draft: NoteDraft & { shared?: boolean }) => http.post<Note>(`/workspaces/${workspaceId}/notes`, draft),
  update: (id: number, patch: Partial<NoteDraft> & { shared?: boolean }) => http.patch<Note>(`/notes/${id}`, patch),
  remove: (id: number) => http.delete(`/notes/${id}`),
  pin: (id: number, pinned: boolean) => (pinned ? http.post<Note>(`/notes/${id}/pin`) : http.delete<Note>(`/notes/${id}/pin`)),
  archive: (id: number, archived: boolean) => http.post<Note>(`/notes/${id}/${archived ? 'archive' : 'restore'}`),
  duplicate: (id: number) => http.post<Note>(`/notes/${id}/duplicate`),
  backlinks: (id: number) => http.get<Backlink[]>(`/notes/${id}/backlinks`),
};

export const courseOptions = (workspaceId: number) =>
  http.get<Page<CourseOption>>(`/workspaces/${workspaceId}/courses${query({ status: 'all', sort: 'title', page_size: 100 })}`).then((page) => page.items);

export const conceptOptions = (courseId: number) =>
  http.get<{ concepts: ConceptOption[] }>(`/courses/${courseId}`).then((course) => course.concepts.map(({ id, name }) => ({ id, name })));
