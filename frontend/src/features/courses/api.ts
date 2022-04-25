import { http, query } from '../../lib/http';
import type { CatalogFilters } from './catalog';
import { catalogQuery } from './catalog';
import type {
  AnswerResult,
  Attempt,
  Concept,
  Course,
  CourseActivity,
  CourseInput,
  CourseLearners,
  CoursePage,
  CourseSummary,
  CourseUpdate,
  ProgressReset,
  Question,
  SourceDetail,
  SourceRef,
  TutorReply,
} from './types';

export const courseApi = {
  list: (workspaceId: number, filters: CatalogFilters, pageSize: number) =>
    http.get<CoursePage>(`/workspaces/${workspaceId}/courses${query(catalogQuery(filters, pageSize))}`),
  /** Subjects and tag facets for the whole workspace (used by the wizard and settings form). */
  facets: (workspaceId: number) =>
    http.get<CoursePage>(`/workspaces/${workspaceId}/courses${query({ status: 'all', page_size: 1 })}`).then((page) => page.facets),
  create: (workspaceId: number, input: CourseInput & { text: string }) => http.post<Course>(`/workspaces/${workspaceId}/courses`, input),
  upload: (workspaceId: number, input: CourseInput, file: File) => {
    const form = new FormData();
    form.append('title', input.title);
    form.append('description', input.description);
    form.append('subject', input.subject);
    form.append('difficulty', input.difficulty);
    form.append('tags', input.tags.join(','));
    form.append('status', input.status);
    form.append('color', input.color);
    form.append('file', file);
    return http.upload<Course>(`/workspaces/${workspaceId}/courses/upload`, form);
  },

  get: (id: number) => http.get<Course>(`/courses/${id}`),
  update: (id: number, changes: CourseUpdate) => http.patch<Course>(`/courses/${id}`, changes),
  remove: (id: number) => http.delete(`/courses/${id}`),
  duplicate: (id: number, title?: string) => http.post<Course>(`/courses/${id}/duplicate`, title ? { title } : undefined),
  setPinned: (id: number, pinned: boolean) => http.put<CourseSummary>(`/courses/${id}/enrollment`, { pinned }),
  leave: (id: number) => http.delete(`/courses/${id}/enrollment`),
  markOpened: (id: number) => http.post<void>(`/courses/${id}/opened`),
  learners: (id: number) => http.get<CourseLearners>(`/courses/${id}/learners`),
  activity: (id: number, days = 14) => http.get<CourseActivity>(`/courses/${id}/activity${query({ days })}`),
  resetProgress: (id: number) => http.post<ProgressReset>(`/courses/${id}/reset-progress`),

  source: (courseId: number, sourceId: number) => http.get<SourceDetail>(`/courses/${courseId}/sources/${sourceId}`),
  addSource: (courseId: number, name: string, text: string) => http.post<SourceRef>(`/courses/${courseId}/sources`, { name, text }),
  removeSource: (courseId: number, sourceId: number) => http.delete(`/courses/${courseId}/sources/${sourceId}`),
  updateConcept: (courseId: number, conceptId: number, changes: { name?: string; summary?: string }) =>
    http.patch<Concept>(`/courses/${courseId}/concepts/${conceptId}`, changes),
  reorderConcepts: (courseId: number, conceptIds: number[]) =>
    http.put<Concept[]>(`/courses/${courseId}/concepts/order`, { concept_ids: conceptIds }),

  quiz: (id: number, count: number) => http.get<Question[]>(`/courses/${id}/quiz${query({ count })}`),
  answer: (id: number, question: Question, selected: number) =>
    http.post<AnswerResult>(`/courses/${id}/answers`, { question_id: question.id, concept_id: question.concept_id, selected }),
  attempts: (id: number, limit = 8) => http.get<Attempt[]>(`/courses/${id}/attempts${query({ limit })}`),
  tutor: (id: number, message: string) => http.post<TutorReply>(`/courses/${id}/tutor`, { message }),
};
