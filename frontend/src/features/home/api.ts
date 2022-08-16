import { http, query } from '../../lib/http';
import type { ActivityPage, Analytics, Home, Learners, RangeDays } from './types';

export type ActivityFilters = { actor_id?: number | null; object_type?: string | null; before_id?: number | null; limit?: number };

export const homeApi = {
  home: (workspaceId: number) => http.get<Home>(`/workspaces/${workspaceId}/home`),
  analytics: (workspaceId: number, days: RangeDays, courseId: number | null) =>
    http.get<Analytics>(`/workspaces/${workspaceId}/analytics${query({ days, course_id: courseId })}`),
  learners: (workspaceId: number, days: RangeDays) => http.get<Learners>(`/workspaces/${workspaceId}/analytics/learners${query({ days })}`),
  activity: (workspaceId: number, filters: ActivityFilters = {}) =>
    http.get<ActivityPage>(`/workspaces/${workspaceId}/activity${query(filters)}`),
};
