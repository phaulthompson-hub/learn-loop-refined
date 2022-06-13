// Planner and goals API client. Mirrors backend/app/routers/planner.py and goals.py.
import { API_URL, ApiError, errorMessage, http, query, type Page } from '../../lib/http';
import { getToken } from '../../lib/storage';
import type {
  CourseOption,
  Conflict,
  EventFilters,
  EventInput,
  EventSaved,
  Goal,
  GoalInput,
  GoalList,
  OccurrencePage,
  Streak,
  StudyLog,
  StudyLogInput,
  StudyLogPage,
  StudySummary,
} from './types';

const ws = (workspaceId: number) => `/workspaces/${workspaceId}`;

/** Translate the UI filters into the events endpoint's query parameters. */
export function filterParams(filters: EventFilters) {
  return {
    kind: filters.kinds.length ? filters.kinds.join(',') : undefined,
    course_id: filters.courseId ?? undefined,
    mine: filters.scope === 'mine' ? true : undefined,
    shared: filters.scope === 'shared' ? true : undefined,
  };
}

export const plannerApi = {
  events: (workspaceId: number, start: string, end: string, filters: EventFilters) =>
    http.get<OccurrencePage>(`${ws(workspaceId)}/events${query({ start, end, ...filterParams(filters) })}`),
  create: (workspaceId: number, input: EventInput) => http.post<EventSaved>(`${ws(workspaceId)}/events`, input),
  update: (eventId: number, input: Partial<EventInput>) => http.patch<EventSaved>(`/events/${eventId}`, input),
  remove: (eventId: number) => http.delete(`/events/${eventId}`),
  conflicts: (eventId: number) => http.get<Conflict[]>(`/events/${eventId}/conflicts`),
  courses: (workspaceId: number) =>
    http.get<Page<CourseOption>>(`${ws(workspaceId)}/courses${query({ status: 'active', page_size: 100, sort: 'title' })}`),

  /** The iCalendar file needs the bearer token, so it is fetched as a blob rather than linked directly. */
  async exportIcs(workspaceId: number, mineOnly: boolean): Promise<Blob> {
    const token = getToken();
    const response = await fetch(`${API_URL}${ws(workspaceId)}/events.ics${query({ mine: mineOnly || undefined })}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (!response) throw new ApiError(errorMessage(null, 0), 0);
    if (!response.ok) throw new ApiError(errorMessage(await response.json().catch(() => null), response.status), response.status);
    return response.blob();
  },
};

export const goalsApi = {
  list: (workspaceId: number, state: 'active' | 'archived') => http.get<GoalList>(`${ws(workspaceId)}/goals${query({ state })}`),
  create: (workspaceId: number, input: GoalInput) => http.post<Goal>(`${ws(workspaceId)}/goals`, input),
  update: (goalId: number, input: Partial<GoalInput>) => http.patch<Goal>(`/goals/${goalId}`, input),
  archive: (goalId: number) => http.post<Goal>(`/goals/${goalId}/archive`),
  restore: (goalId: number) => http.post<Goal>(`/goals/${goalId}/restore`),
  remove: (goalId: number) => http.delete(`/goals/${goalId}`),

  streak: (workspaceId: number) => http.get<Streak>(`${ws(workspaceId)}/streak`),
  summary: (workspaceId: number, weeks = 4) => http.get<StudySummary>(`${ws(workspaceId)}/study-logs/summary${query({ weeks })}`),
  logs: (workspaceId: number, pageSize = 50) => http.get<StudyLogPage>(`${ws(workspaceId)}/study-logs${query({ page_size: pageSize })}`),
  logTime: (workspaceId: number, input: StudyLogInput) => http.post<StudyLog>(`${ws(workspaceId)}/study-logs`, input),
  removeLog: (logId: number) => http.delete(`/study-logs/${logId}`),
};

/** Save a blob under `filename` via a temporary object URL. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
