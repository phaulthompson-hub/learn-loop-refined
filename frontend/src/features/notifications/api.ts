import { http, query } from '../../lib/http';
import type { AppNotification, BulkResult, NotificationKind, NotificationPage } from './types';

export type NotificationFilters = {
  unread?: boolean;
  kind?: NotificationKind | null;
  workspace_id?: number | null;
  before_id?: number | null;
  limit?: number;
};

export const notificationsApi = {
  list: (filters: NotificationFilters = {}) => http.get<NotificationPage>(`/notifications${query({ ...filters, unread: filters.unread || undefined })}`),
  unreadCount: () => http.get<{ unread: number }>('/notifications/unread-count'),
  setRead: (id: number, read: boolean) => http.patch<AppNotification>(`/notifications/${id}`, { read }),
  markAllRead: (workspaceId?: number) => http.post<BulkResult>(`/notifications/read-all${query({ workspace_id: workspaceId })}`),
  remove: (id: number) => http.delete(`/notifications/${id}`),
  clearRead: () => http.delete<BulkResult>('/notifications/read'),
};
