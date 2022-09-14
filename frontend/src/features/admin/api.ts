// API client for account settings, workspace administration, members and invitations.
import type { Me, Role, User } from '../../app/types';
import { http, jsonBody, query, request } from '../../lib/http';
import type {
  InvitationAccepted,
  InvitationFilter,
  Invitation,
  InvitationPage,
  InvitationPreview,
  InviteInput,
  InviteSummary,
  Member,
  MemberPage,
  PreferencesInput,
  ProfileInput,
  SessionInfo,
  WorkspaceDetail,
  WorkspaceInput,
} from './types';

const ws = (workspaceId: number) => `/workspaces/${workspaceId}`;

export const accountApi = {
  updateProfile: (input: Partial<ProfileInput>) => http.patch<User>('/me/profile', input),
  updatePreferences: (input: Partial<PreferencesInput>) => http.patch<User>('/me/preferences', input),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<{ signed_out_sessions: number }>('/me/password', { current_password: currentPassword, new_password: newPassword }),
  sessions: () => http.get<SessionInfo[]>('/me/sessions'),
  revokeSession: (sessionId: number) => http.delete(`/me/sessions/${sessionId}`),
  revokeOtherSessions: () => http.post<{ revoked: number }>('/me/sessions/revoke-others'),
  deactivate: (password: string) => http.post<void>('/me/deactivate', { password }),
};

export const workspaceApi = {
  create: (input: WorkspaceInput) => http.post<WorkspaceDetail>('/workspaces', input),
  get: (workspaceId: number) => http.get<WorkspaceDetail>(ws(workspaceId)),
  update: (workspaceId: number, input: Partial<WorkspaceInput>) => http.patch<WorkspaceDetail>(ws(workspaceId), input),
  remove: (workspaceId: number, confirmName: string) =>
    request<void>(ws(workspaceId), jsonBody('DELETE', { confirm_name: confirmName })),
  leave: (workspaceId: number) => http.post<Me>(`${ws(workspaceId)}/leave`),
};

export const memberApi = {
  list: (workspaceId: number) => http.get<MemberPage>(`${ws(workspaceId)}/members${query({ page_size: 100 })}`),
  changeRole: (workspaceId: number, userId: number, role: Role) =>
    http.patch<Member>(`${ws(workspaceId)}/members/${userId}`, { role }),
  remove: (workspaceId: number, userId: number) => http.delete(`${ws(workspaceId)}/members/${userId}`),
};

export const invitationApi = {
  list: (workspaceId: number, status: InvitationFilter = 'all') =>
    http.get<InvitationPage>(`${ws(workspaceId)}/invitations${query({ status, page_size: 100 })}`),
  create: (workspaceId: number, input: InviteInput) => http.post<InviteSummary>(`${ws(workspaceId)}/invitations`, input),
  revoke: (workspaceId: number, invitationId: number) =>
    http.post<Invitation>(`${ws(workspaceId)}/invitations/${invitationId}/revoke`),
  resend: (workspaceId: number, invitationId: number) =>
    http.post<Invitation>(`${ws(workspaceId)}/invitations/${invitationId}/resend`),
  preview: (token: string) => http.get<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
  accept: (token: string) => http.post<InvitationAccepted>(`/invitations/${encodeURIComponent(token)}/accept`),
};
